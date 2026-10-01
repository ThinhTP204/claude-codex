import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { Check, CirclePlay, LayoutGrid, Copy, Flag, MessageSquare, Pause, PenLine, Play, Plus, RotateCcw, Save, Scale, Square, Trash2, X } from 'lucide-react';
import type { NodeRunState, PEdge, PNode, PNodeData, Pipeline, PipelineRun, RunConfig } from '../../../shared/types.ts';
import { stageContract, stageInstruction } from '../../../shared/stageGuide.ts';
import { CHECKLISTS, STAGES, STAGE_KINDS, AC_PARTS, TESTS, checklistOf, isProducer, judgedStep, producedItems, type AcceptanceCriterion, type ChecklistItem, type ItemStatus, type StageKind, type TestMode } from '../../../shared/stages.ts';
import { api, qs } from '../api.ts';
import { deletePipeline, ensureConv, getState, safe, savePipeline, setState, toast, useStore } from '../store.ts';
import { ConfigPicker } from './ConfigPicker.tsx';
import { assignLanes, autoLayout, edgeTypes } from './flowLayout.tsx';
import { ApprovalCard } from './ChatView.tsx';
import { Markdown } from './Message.tsx';
import { AGENT_NAME, AgentIcon, EFFORT_LABEL, Field, PERMISSIONS, Popover, Select, Spinner, Toggle, cx, fmtDuration, fmtTokens, fmtUsage, inputCls, modelLabel } from './ui.tsx';

type NData = PNodeData & {
  run?: NodeRunState;
  current?: boolean;
  runMode?: boolean;
  task?: string;
  ac?: AcceptanceCriterion[];
  size?: string;
  step?: number;
  marks?: PipelineRun['marks'];
  /** checking steps: the items of the step they judge */
  judge?: { label: string; items: ChecklistItem[] };
  [k: string]: unknown;
};
type RFNode = Node<NData>;

const STATUS_RING: Record<string, string> = {
  running: 'border-accent node-running',
  awaiting: 'border-warn ring-2 ring-warn/25',
  done: 'border-ok/60',
  error: 'border-err ring-2 ring-err/20',
  stopped: 'border-line-strong',
  idle: 'border-line',
};

function RunIcon({ st }: { st?: NodeRunState }) {
  if (!st) return null;
  switch (st.status) {
    case 'running':
      return <Spinner size={13} className="text-accent" />;
    case 'awaiting':
      return <Pause size={13} className="text-warn" />;
    case 'done':
      return <Check size={14} className="text-ok" />;
    case 'error':
      return <X size={14} className="text-err" />;
    case 'stopped':
      return <Square size={11} className="text-muted" />;
    default:
      return null;
  }
}

/** One step of a pipeline: what kind of step, who does it, what it does, when it passes. */
const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<RFNode>) {
  const catalog = useStore((s) => s.catalog);
  const roles = useStore((s) => s.roles);
  const role = roles.find((r) => r.id === data.roleId);
  const cfg = data.config ?? role?.config;
  const st = data.run;
  const perm = PERMISSIONS.find((p) => p.id === cfg?.permission);
  const stage = data.stage ? STAGES[data.stage] : undefined;
  const contract = data.stage ? stageContract(data.stage, data) : undefined;
  const color = stage?.color ?? 'var(--line-strong)';
  const testsOn = data.stage === 'test' ? TESTS.filter((t) => (data.tests?.[t.id] ?? 'auto') !== 'skip') : [];
  const always = data.stage === 'test' ? TESTS.filter((t) => data.tests?.[t.id] === 'always' || (!t.when && (data.tests?.[t.id] ?? 'auto') !== 'skip')) : [];
  return (
    <div
      style={{ borderTopColor: color }}
      className={cx(
        'w-[272px] rounded-xl border-[1.5px] border-t-[4px] bg-panel text-[12.5px] shadow-sm transition-shadow',
        data.runMode ? STATUS_RING[st?.status || 'idle'] : 'border-line',
        selected && 'shadow-pop outline-2 outline-offset-2 outline-accent/60',
        data.runMode && st?.status === 'idle' && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Left} />
      {/* a failed check comes back here, from below */}
      <Handle id="retry" type="target" position={Position.Top} style={{ left: '28%' }} />
      <Handle id="items" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      {data.stage && !isProducer(data.stage) && <Handle id="blame" type="source" position={Position.Left} isConnectable={false} style={{ top: '78%', opacity: 0 }} />}

      <div className="flex items-start gap-2.5 px-3 pb-2 pt-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[16px]" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
          {stage?.icon ?? role?.icon ?? '⚙️'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: stage ? color : undefined }}>
            {data.step ? `Bước ${data.step}` : 'Bước'}
            {stage ? ` · ${stage.name}` : ' · tự viết prompt'}
          </div>
          <div className="truncate text-[14px] font-semibold leading-tight">{data.label}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1 pt-0.5">
          {data.runMode && st && st.runs > 1 && <span className="text-[11px] text-faint" title={`Lần chạy thứ ${st.runs}: bước sau chấm chưa đạt nên gửi lại bước này làm lại`}>lần {st.runs}</span>}
          <RunIcon st={data.runMode ? st : undefined} />
        </span>
      </div>

      {cfg && (
        <div className="flex items-center gap-1.5 border-t border-line px-3 py-1.5">
          <AgentIcon agent={cfg.agent} size={14} />
          <span className="min-w-0 truncate font-medium">{modelLabel(catalog, cfg.agent, cfg.model)}</span>
          <span className="ml-auto flex shrink-0 gap-1 text-[10.5px] text-muted">
            {cfg.effort && <span className="rounded bg-hover px-1.5 py-px">{EFFORT_LABEL[cfg.effort] || cfg.effort}</span>}
            {perm && <span className={cx('rounded bg-hover px-1.5 py-px', cfg.permission === 'full' && 'text-err')}>{perm.short}</span>}
          </span>
        </div>
      )}

      {stage ? (
        <div className="space-y-1 border-t border-line px-3 py-2 text-[11.5px] leading-snug">
          <div className="text-fg/85">{contract!.does}</div>
          <div>
            <span className="font-medium text-faint">Kết quả: </span>
            <span className="text-muted">{contract!.output}</span>
          </div>
          <div>
            <span className="font-medium text-faint">Xong khi: </span>
            <span className="text-muted">{contract!.done}</span>
          </div>
          {data.stage === 'test' && (
            <div className="pt-0.5" title={TESTS.map((t) => `${t.name}: ${{ auto: 'tự động', always: 'luôn chạy', skip: 'bỏ qua' }[data.tests?.[t.id] ?? 'auto']}`).join('\n')}>
              <span className="font-medium text-faint">Loại test: </span>
              <span className="text-muted">
                luôn chạy {always.map((t) => t.name).join(', ')}; {testsOn.length - always.length} loại khác chạy khi cần
                {TESTS.length - testsOn.length ? `; tắt ${TESTS.length - testsOn.length} loại` : ''}
              </span>
            </div>
          )}
          {(data.stage === 'review-plan' || data.stage === 'review-code') && (
            <div className="pt-0.5">
              <span className="font-medium text-faint">Lần kiểm tra lại: </span>
              <span className="text-muted">
                {{ auto: 'tự chọn phạm vi', incremental: 'chỉ xem phần mới sửa', full: 'xem lại toàn bộ' }[data.reviewMode ?? 'auto']}. Chưa đạt khi còn lỗi {data.failAt === 'should' ? 'mức Chặn hoặc Nên sửa' : 'mức Chặn'}
              </span>
            </div>
          )}
        </div>
      ) : (
        data.prompt && <div className="line-clamp-2 border-t border-line px-3 py-2 text-[11.5px] text-muted">{data.prompt}</div>
      )}

      {(data.approval || data.verdict || data.runMode) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line px-3 py-1.5 text-[10.5px]">
          {data.approval && (
            <span className="inline-flex items-center gap-0.5 rounded bg-warn/10 px-1.5 py-px text-warn" title="Dừng chờ duyệt sau bước này">
              <Pause size={9} /> dừng chờ bạn duyệt
            </span>
          )}
          {data.verdict && !data.runMode && (
            <span className="rounded bg-hover px-1.5 py-px text-muted" title="Chưa đạt thì gửi lại cho bước trước sửa">
              chưa đạt thì làm lại, tối đa {data.maxLoops ?? 3} lần
            </span>
          )}
          {data.runMode && data.judge && <JudgeChip items={data.judge.items} marks={data.marks} label={data.label} />}
          {data.runMode && data.stage && <AcChip stage={data.stage} ac={data.ac} size={data.size} />}
          {data.runMode && st?.verdict && (
            <span className={cx('rounded px-1.5 py-px font-semibold', st.verdict === 'pass' ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err')}>{st.verdict === 'pass' ? 'Đạt' : 'Chưa đạt'}</span>
          )}
          {data.runMode && st && (st.usage || st.durationMs) && (
            <span className="ml-auto text-faint">
              {fmtDuration(st.durationMs)} {st.usage && `· ${fmtTokens(st.usage.inputTokens + st.usage.outputTokens)}`}
            </span>
          )}
        </div>
      )}

      {data.verdict ? (
        <>
          <Handle id="pass" type="source" position={Position.Right} style={{ background: 'var(--ok)', borderColor: 'var(--ok)' }} />
          <Handle id="fail" type="source" position={Position.Top} style={{ left: '72%', background: 'var(--err)', borderColor: 'var(--err)' }} />
        </>
      ) : (
        <Handle id="out" type="source" position={Position.Right} />
      )}
    </div>
  );
});

type Mark = NonNullable<PipelineRun['marks']>[string];
type ItemData = { label: string; code: string; hint?: string; mark?: Mark; runMode?: boolean; color: string; parent: string; placeholder?: boolean; /** the step's own criterion / self-check / test kind, hanging under it */ own?: boolean; [k: string]: unknown };

/** "5/7 đạt" on a checking step during a run (over the items it judges). */
function JudgeChip({ items, marks, label }: { items: ChecklistItem[]; marks?: PipelineRun['marks']; label: string }) {
  const mine = items.map((i) => marks?.[i.id]).filter((m): m is Mark => !!m && m.by === label);
  if (!mine.length) return null;
  const fail = mine.filter((m) => m.status === 'fail').length;
  const ok = mine.filter((m) => m.status === 'pass' || m.status === 'skip' || m.status === 'warn').length;
  return <span className={cx('rounded px-1.5 py-px font-medium', fail ? 'bg-err/10 text-err' : 'bg-ok/10 text-ok')}>{fail ? `${fail}/${items.length} mục chưa đạt` : `${ok}/${items.length} mục đạt`}</span>;
}

const MARK_STYLE: Record<Mark['status'], { icon: string; cls: string; box: string; word: string }> = {
  pass: { icon: '✓', cls: 'text-ok', box: 'border-ok/40 bg-ok/[0.06]', word: 'Đạt' },
  fail: { icon: '✗', cls: 'text-err', box: 'border-err/60 bg-err/[0.07]', word: 'Chưa đạt' },
  skip: { icon: '–', cls: 'text-faint', box: 'border-line', word: 'Bỏ qua' },
  redo: { icon: '↻', cls: 'text-warn', box: 'border-warn/50 bg-warn/[0.07]', word: 'Đã sửa, chờ chấm lại' },
  warn: { icon: '!', cls: 'text-warn', box: 'border-warn/40 bg-warn/[0.05]', word: 'Đạt, có lưu ý' },
};

/** One item a step makes (a plan section, an acceptance criterion): a slim pill between the maker and its checker. */
const ItemNode = memo(function ItemNode({ data, selected }: NodeProps<Node<ItemData>>) {
  const st = data.runMode && data.mark ? MARK_STYLE[data.mark.status] : undefined;
  return (
    <div
      title={[`${data.code}. ${data.label}`, data.hint, st && `${st.word}${data.mark?.by ? ` (${data.mark.by})` : ''}${data.mark?.note ? `: ${data.mark.note}` : ''}`].filter(Boolean).join('\n')}
      className={cx(
        'flex w-[210px] items-start gap-1.5 rounded-2xl border bg-panel px-2.5 py-1 text-[12px] leading-[18px] shadow-sm',
        st?.box ?? 'border-line',
        data.placeholder && 'border-dashed opacity-60',
        selected && 'outline-2 outline-offset-1 outline-accent/50',
      )}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="blame" type="target" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <span className={cx('w-3 shrink-0 text-center font-semibold', st?.cls ?? 'text-faint/60')}>{st?.icon ?? '○'}</span>
      <span className="shrink-0 font-mono text-[10.5px]" style={{ color: data.color }}>
        {data.code}
      </span>
      <span className={cx('min-w-0 flex-1 break-words', data.placeholder && 'italic')}>{data.label}</span>
    </div>
  );
});

/** The whole point, wrapped; "Mục tiêu: …" shows its part name in bold. */
function SubText({ text }: { text: string }) {
  const m = /^([^:]{2,40}):\s+(.+)$/s.exec(text);
  return (
    <span className="min-w-0 flex-1 break-words">
      {m ? (
        <>
          <span className="font-medium text-fg/80">{m[1]}:</span> {m[2]}
        </>
      ) : (
        text
      )}
    </span>
  );
}

/** One point under an item: what the agent wrote, or before that the part it is expected to cover (dashed). */
type SubData = { label: string; color: string; parent: string; fail?: boolean; placeholder?: boolean; [k: string]: unknown };
const SubNode = memo(function SubNode({ data }: NodeProps<Node<SubData>>) {
  return (
    <div
      title={data.placeholder ? `${data.label}. Khi chạy, AI điền nội dung vào đây.` : data.label}
      className={cx(
        'flex w-[300px] items-start gap-1.5 rounded-md border px-2 py-[3px] text-[11.5px] leading-4',
        data.placeholder ? 'border-dashed border-line/80 bg-transparent text-faint' : 'bg-panel/80 text-muted',
        !data.placeholder && (data.fail ? 'border-err/40' : 'border-line/70'),
      )}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <span className={cx('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', data.placeholder && 'opacity-50')} style={{ background: data.color }} />
      <SubText text={data.label} />
    </div>
  );
});

const ITEM_W = 210;
const ITEM_GAP = 70;
const ITEM_STEP = 34;
const SUB_W = 300;
const SUB_GAP = 46;
/** gap between two points under an item */
const SUB_GAP_Y = 5;
/** a point's height: measured once shown, until then guessed from its length (about 44 characters a line) */
const subHeight = (text: string, size?: { height: number }) => size?.height ?? 8 + Math.max(1, Math.ceil(text.length / 44)) * 16;
/** Room from a step to the next one: the step, its items and the points under them. */
const STEP_ROOM = ITEM_GAP + ITEM_W + SUB_GAP + SUB_W + 60;

/**
 * Where there is not enough room after a step for its items and their points (an older layout),
 * push everything after it to the right. Shown only: `shift` says by how much, to undo on drag.
 */
function makeRoom(nodes: RFNode[]): { nodes: RFNode[]; shift: Map<string, number> } {
  const xs = nodes.map((n) => n.position.x);
  const push: { x: number; dx: number }[] = [];
  for (const n of nodes) {
    if (n.type !== 'agent' || !n.data.stage) continue;
    const after = xs.filter((x) => x > n.position.x + 1);
    if (!after.length) continue;
    const dx = n.position.x + (n.measured?.width ?? 272) + STEP_ROOM - Math.min(...after);
    if (dx > 0) push.push({ x: n.position.x, dx });
  }
  const shift = new Map<string, number>();
  if (!push.length) return { nodes, shift };
  const out = nodes.map((n) => {
    const dx = push.filter((p) => p.x < n.position.x).reduce((a, p) => a + p.dx, 0);
    if (!dx) return n;
    shift.set(n.id, dx);
    return { ...n, position: { x: n.position.x + dx, y: n.position.y } };
  });
  return { nodes: out, shift };
}

/**
 * What a step turns out, fanned out to its right and flowing together into the next step:
 * Plan its sections, Review plan / Review code their criteria, Code one item per AC plus its
 * self-checks, Test one item per test kind. A checking step points red dashed links back at the
 * items it failed. Built from the steps on every render (not saved); returns which plain links the
 * item columns replace.
 */
function treeOf(nodes: RFNode[], edges: Edge[], marks: PipelineRun['marks'], ac: AcceptanceCriterion[] | undefined, sizes: Record<string, { width: number; height: number }>) {
  const out: Node<ItemData | SubData>[] = [];
  const links: Edge[] = [];
  const hidden = new Set<string>();
  const flow = { nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? '', data: n.data })), edges: edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle })) };
  const link = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, red = false): Edge =>
    ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'default',
      selectable: false,
      focusable: false,
      animated: red,
      markerEnd: red ? { type: MarkerType.ArrowClosed, color: 'var(--err)', width: 14, height: 14 } : undefined,
      style: red ? { stroke: 'var(--err)', strokeWidth: 1.4, strokeDasharray: '5 4' } : { stroke: 'var(--line-strong)', strokeWidth: 1 },
    }) as Edge;
  // which checker judges which step (for the red links)
  const checkersOf = (id: string) =>
    nodes.filter((c) => c.type === 'agent' && c.data.stage && !isProducer(c.data.stage) && judgedStep(flow, c.id) === id);

  for (const n of nodes) {
    if (n.type !== 'agent' || !n.data.stage) continue;
    const stage = n.data.stage;
    // what this step turns out, and where each item's result comes from
    const rows: { item: ChecklistItem; mark?: Mark; placeholder?: boolean; judged?: boolean }[] = [];
    if (stage === 'plan') for (const it of producedItems('plan', n.data)) rows.push({ item: it, mark: marks?.[it.id], judged: true });
    else if (stage === 'code') {
      const acs = producedItems('code', n.data, ac);
      if (acs.length) for (const it of acs) rows.push({ item: it, mark: marks?.[it.id], judged: true });
      else
        for (const it of [
          { id: 'AC1', text: 'Tiêu chí 1 (Plan sẽ viết)', parts: AC_PARTS },
          { id: 'AC2', text: 'Tiêu chí 2 (Plan sẽ viết)', parts: AC_PARTS },
        ])
          rows.push({ item: it, placeholder: true });
      for (const it of checklistOf('code', n.data).filter((i) => !i.ac)) rows.push({ item: it, mark: n.data.run?.items?.[it.id] as Mark | undefined });
    } else for (const it of checklistOf(stage, n.data).filter((i) => !i.ac)) rows.push({ item: it, mark: n.data.run?.items?.[it.id] as Mark | undefined });
    if (!rows.length) continue;

    // the items flow into the next step on the normal path
    const next = edges.find((e) => e.source === n.id && e.sourceHandle !== 'fail');
    const target = next && nodes.find((x) => x.id === next.target);
    const checkers = checkersOf(n.id);
    const height = n.measured?.height ?? 240;
    const x = n.position.x + (n.measured?.width ?? 272) + ITEM_GAP;
    // what the agent wrote under the item; before that, the parts it is expected to cover
    const subsOf = (item: ChecklistItem) => {
      const real = n.data.runMode ? n.data.run?.subs?.[item.id] : undefined;
      return real?.length ? { texts: real, draft: false } : { texts: item.parts ?? [], draft: true };
    };
    // each item gets a slot tall enough for its points; the whole column is centred on the step
    const pointsHeight = (item: ChecklistItem) =>
      subsOf(item).texts.reduce((h, t, k) => h + subHeight(t, sizes[`${n.id}::${item.id}::${k}`]) + SUB_GAP_Y, 0);
    const itemHeight = (item: ChecklistItem) => sizes[`${n.id}::${item.id}`]?.height ?? 26;
    const slot = (item: ChecklistItem) => Math.max(ITEM_STEP, itemHeight(item) + 8, pointsHeight(item) + 8);
    let y = n.position.y + height / 2 - rows.reduce((h, r) => h + slot(r.item), 0) / 2;
    for (const { item, mark, placeholder, judged } of rows) {
      const id = `${n.id}::${item.id}`;
      const { texts: subs, draft } = subsOf(item);
      const h = slot(item);
      const top = y;
      y += h;
      out.push({
        id,
        type: 'item',
        position: { x, y: top + h / 2 - itemHeight(item) / 2 },
        draggable: false,
        deletable: false,
        connectable: false,
        // React Flow only shows a node once it knows its size; these nodes are rebuilt, so keep it here
        measured: sizes[id],
        data: { label: item.text, code: item.id, hint: item.hint, mark: placeholder ? undefined : mark, runMode: n.data.runMode, color: STAGES[stage].color, parent: n.id, placeholder, own: !judged && !placeholder } as ItemData,
      });
      links.push(link(`f:${id}`, n.id, n.data.verdict ? 'pass' : 'out', id, 'in'));
      const blamer = judged && mark?.status === 'fail' ? checkers.find((c) => c.data.label === mark.by) : undefined;
      if (blamer) links.push(link(`b:${id}`, blamer.id, 'blame', id, 'blame', true));
      // the item opens into the points written under it, and those flow into the next step
      let sy = top + h / 2 - pointsHeight(item) / 2;
      subs.forEach((text, k) => {
        const sid = `${id}::${k}`;
        const py = sy;
        sy += subHeight(text, sizes[sid]) + SUB_GAP_Y;
        out.push({
          id: sid,
          type: 'sub',
          position: { x: x + ITEM_W + SUB_GAP, y: py },
          draggable: false,
          deletable: false,
          connectable: false,
          measured: sizes[sid],
          data: { label: text, color: STAGES[stage].color, parent: n.id, fail: !!blamer, placeholder: draft } as SubData,
        });
        links.push(link(`s:${sid}`, id, 'out', sid, 'in'));
        if (!blamer && target) links.push(link(`c:${sid}`, sid, 'out', target.id, 'items'));
      });
      if (!blamer && target && !subs.length) links.push(link(`c:${id}`, id, 'out', target.id, 'items'));
    }
    // the item column stands for the plain link from this step to the next
    if (next) hidden.add(next.id);
  }
  return { nodes: out, edges: links, hidden };
}

/** Plan: how many criteria it set (and the task size); checkers: how many pass. */
function AcChip({ stage, ac, size }: { stage: StageKind; ac?: AcceptanceCriterion[]; size?: string }) {
  if (!ac?.length) return null;
  if (stage === 'plan')
    return (
      <span className="rounded bg-hover px-1.5 py-px text-muted" title={ac.map((a) => `${a.id}: ${a.text}`).join('\n')}>
        {ac.length} AC{size ? ` · cỡ ${size}` : ''}
      </span>
    );
  if (stage !== 'test' && stage !== 'review-code') return null;
  const pass = ac.filter((a) => a.status === 'pass').length;
  const fail = ac.filter((a) => a.status === 'fail').length;
  return (
    <span
      className={cx('rounded px-1.5 py-px font-medium', fail ? 'bg-err/10 text-err' : pass === ac.length ? 'bg-ok/10 text-ok' : 'bg-hover text-muted')}
      title={ac.map((a) => `${a.status === 'pass' ? '✓' : a.status === 'fail' ? '✗' : '·'} ${a.id}: ${a.text}`).join('\n')}
    >
      AC {pass}/{ac.length}
    </span>
  );
}

const TaskNode = memo(function TaskNode({ data, selected }: NodeProps<RFNode>) {
  return (
    <div className={cx('w-[170px] rounded-xl border-[1.5px] bg-panel px-3 py-2.5 shadow-sm', data.runMode ? 'border-ok/60' : 'border-line', selected && 'shadow-pop')}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <CirclePlay size={15} className="text-accent" /> Task
      </div>
      <div className="mt-1 line-clamp-3 text-[11.5px] text-muted">{data.runMode ? data.task : 'Bạn nhập task khi bấm Chạy'}</div>
      <Handle id="out" type="source" position={Position.Right} />
    </div>
  );
});

const EndNode = memo(function EndNode({ data, selected }: NodeProps<RFNode>) {
  const done = data.runMode && data.run?.status === 'done';
  return (
    <div className={cx('flex items-center gap-1.5 rounded-full border-[1.5px] bg-panel px-4 py-2 text-[12.5px] font-semibold shadow-sm', done ? 'border-ok text-ok' : 'border-line', selected && 'shadow-pop')}>
      <Handle type="target" position={Position.Left} />
      <Handle id="items" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Flag size={14} /> {data.label || 'Done'}
    </div>
  );
});

const nodeTypes = { agent: AgentNode, task: TaskNode, end: EndNode, item: ItemNode, sub: SubNode };

/** Position of each agent step in run order (following out/pass links from Task). */
function stepNumbers(p: Pipeline): Map<string, number> {
  const order = new Map<string, number>();
  const start = p.nodes.find((n) => n.type === 'task');
  const queue = start ? [start.id] : [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (p.nodes.find((n) => n.id === id)?.type === 'agent') order.set(id, order.size + 1);
    for (const e of p.edges) if (e.source === id && e.sourceHandle !== 'fail') queue.push(e.target);
  }
  return order;
}

function toRF(p: Pipeline, run?: PipelineRun): { nodes: RFNode[]; edges: Edge[] } {
  const steps = stepNumbers(p);
  const nodes: RFNode[] = p.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data, run: run?.nodes[n.id], current: run?.current === n.id, runMode: !!run, task: run?.task, ac: run?.ac, size: run?.size, step: steps.get(n.id), marks: run?.marks },
  }));
  const edges: Edge[] = assignLanes(p.edges.map((e) => edgeStyle(e, run)), nodes);
  return { nodes, edges };
}

function edgeStyle(e: PEdge, run?: PipelineRun): Edge {
  const color = e.sourceHandle === 'pass' ? 'var(--ok)' : e.sourceHandle === 'fail' ? 'var(--err)' : 'var(--line-strong)';
  const active = !!run && run.current === e.target && run.nodes[e.target]?.status === 'running' && run.prevNode === e.source;
  const firstActive = !!run && run.current === e.target && run.nodes[e.target]?.status === 'running' && !run.prevNode && e.source === 'task';
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.sourceHandle === 'fail' ? 'retry' : undefined,
    label: e.sourceHandle === 'fail' ? 'chưa đạt, làm lại' : undefined,
    type: 'flow',
    animated: active || firstActive,
    style: { stroke: color, strokeWidth: 1.8, strokeDasharray: e.sourceHandle === 'fail' ? '6 4' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  };
}

function fromRF(base: Pipeline, nodes: RFNode[], edges: Edge[]): Pipeline {
  return {
    ...base,
    nodes: nodes.map((n): PNode => {
      const { run: _r, current: _c, runMode: _m, task: _t, ac: _a, size: _s, step: _n, marks: _k, judge: _j, ...data } = n.data;
      return { id: n.id, type: n.type as PNode['type'], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: data as PNodeData };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? 'out' })),
  };
}

/**
 * Give a custom pipeline's steps their standard stage from their role: Plan, Code and Test map
 * directly; a Review before the first Code step checks the plan, one after it checks the code.
 */
function toStandardStages(nodes: RFNode[], edges: Edge[]): { nodes: RFNode[]; changed: number } {
  // run order: walk the "out"/"pass" links from the Task node
  const order = new Map<string, number>();
  const start = nodes.find((n) => n.type === 'task');
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (order.has(id)) continue;
    order.set(id, order.size);
    for (const e of edges) if (e.source === id && e.sourceHandle !== 'fail') queue.push(e.target);
  }
  const firstCode = Math.min(...nodes.filter((n) => n.data.roleId === 'code').map((n) => order.get(n.id) ?? Infinity));
  let changed = 0;
  const next = nodes.map((n) => {
    if (n.type !== 'agent' || n.data.stage) return n;
    const r = n.data.roleId;
    const stage: StageKind | undefined =
      r === 'plan' ? 'plan' : r === 'code' ? 'code' : r === 'test' ? 'test' : r === 'review' ? ((order.get(n.id) ?? 0) < firstCode ? 'review-plan' : 'review-code') : undefined;
    if (!stage) return n;
    changed++;
    return { ...n, data: { ...n.data, stage, verdict: STAGES[stage].verdict, label: r === 'review' ? STAGES[stage].name : n.data.label } };
  });
  return { nodes: next, changed };
}

export function FlowView() {
  return (
    <ReactFlowProvider>
      <FlowInner />
    </ReactFlowProvider>
  );
}

function FlowInner() {
  const conv = useStore((s) => s.conv);
  const pipelines = useStore((s) => s.pipelines);
  const roles = useStore((s) => s.roles);
  const run = conv?.run;
  const [mode, setMode] = useState<'design' | 'run'>(run ? 'run' : 'design');
  const [tplId, setTplId] = useState<string>(() => pipelines[0]?.id || '');
  const [base, setBase] = useState<Pipeline | undefined>(() => pipelines[0]);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // switch to the run view automatically when a run starts in this conversation
  const runId = run?.id;
  useEffect(() => {
    if (runId) setMode('run');
  }, [runId]);
  useEffect(() => {
    if (!run && mode === 'run') setMode('design');
  }, [run, mode]);

  // load template into the designer
  useEffect(() => {
    if (!base && pipelines[0]) {
      setBase(pipelines[0]);
      setTplId(pipelines[0].id);
    }
  }, [pipelines, base]);

  useEffect(() => {
    if (mode === 'design' && base) {
      const g = toRF(base);
      setNodes(g.nodes);
      setEdges(g.edges);
      setDirty(false);
    }
  }, [mode, base]);

  // live run view
  useEffect(() => {
    if (mode !== 'run' || !run) return;
    const g = toRF(run.pipeline, run);
    setNodes((prev) => g.nodes.map((n) => ({ ...n, position: prev.find((p) => p.id === n.id)?.position ?? n.position, selected: n.id === selected })));
    setEdges(g.edges);
  }, [mode, run, selected]);

  // fit once per pipeline/run, after its nodes are on the canvas and the tab is visible
  const fitKey = `${mode}:${mode === 'run' ? runId : tplId}`;
  const fitted = useRef('');
  const activeTab = useStore((s) => s.activeTab);
  useEffect(() => {
    if (!nodes.length || activeTab !== 'flow' || fitted.current === fitKey) return;
    const t = setTimeout(() => {
      fitted.current = fitKey;
      // the whole flow is too wide to read at once: open on its start (Task and the first two steps), pan for the rest
      const first = [...nodes].sort((a, b) => a.position.x - b.position.x).slice(0, 3);
      const ids = new Set(first.map((n) => n.id));
      const shown = rf.getNodes().filter((n) => ids.has(n.id) || (n.type === 'item' && ids.has((n.data as ItemData).parent)));
      void rf.fitView({ nodes: shown.map((n) => ({ id: n.id })), padding: 0.06, maxZoom: 1.1, duration: 200 });
    }, 60);
    return () => clearTimeout(t);
  }, [fitKey, nodes.length, activeTab, rf]);

  // the items each making step produces sit between it and its checker (rebuilt every render, not saved)
  const marks = mode === 'run' ? run?.marks : undefined;
  const runAc = mode === 'run' ? run?.ac : undefined;
  const [itemSizes, setItemSizes] = useState<Record<string, { width: number; height: number }>>({});
  // the points under each item need room before the next step: older layouts are shown spread out (not saved)
  const room = useMemo(() => makeRoom(nodes), [nodes]);
  const placed = room.nodes;
  const shiftRef = useRef(room.shift);
  shiftRef.current = room.shift;
  const tree = useMemo(() => treeOf(placed, edges, marks, runAc, itemSizes), [placed, edges, marks, runAc, itemSizes]);
  const shownNodes = useMemo(() => {
    const flow = { nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? '', data: n.data })), edges: edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle })) };
    const withJudge = placed.map((n) => {
      if (n.type !== 'agent' || !n.data.stage || isProducer(n.data.stage)) return n;
      const target = nodes.find((x) => x.id === judgedStep(flow, n.id));
      if (!target) return n;
      return { ...n, data: { ...n.data, judge: { label: target.data.label, items: producedItems(target.data.stage, target.data, runAc) } } };
    });
    return [...withJudge, ...tree.nodes] as RFNode[];
  }, [nodes, placed, edges, tree, runAc]);
  // loop-back lanes follow the nodes as they are dragged around
  const shownEdges = useMemo(() => {
    const ceiling = tree.nodes.length ? Math.min(...tree.nodes.map((n) => n.position.y)) : undefined;
    const main = assignLanes(edges.filter((e) => !tree.hidden.has(e.id)), placed).map((e) => (e.sourceHandle === 'fail' && ceiling !== undefined ? { ...e, data: { ...e.data, ceiling } } : e));
    return [...main, ...tree.edges];
  }, [edges, placed, tree]);

  const tidy = () => {
    const p = fromRF(base ?? { id: '', name: '', nodes: [], edges: [] }, nodes, edges);
    const pos = autoLayout(p.nodes, p.edges);
    const next = nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position }));
    setNodes(next);
    setDirty(true);
    setTimeout(() => void rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: 250 }), 50);
  };

  const onNodesChange = useCallback(
    (all: NodeChange<RFNode>[]) => {
      const isItem = (c: NodeChange<RFNode>) => 'id' in c && c.id.includes('::');
      const sizes = all.filter((c) => isItem(c) && c.type === 'dimensions' && c.dimensions);
      if (sizes.length)
        setItemSizes((prev) => {
          const next = { ...prev };
          for (const c of sizes) if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions;
          return next;
        });
      // a dragged step is shown shifted (see makeRoom): keep its own position without the shift
      const ch = all
        .filter((c) => !isItem(c))
        .map((c) => (c.type === 'position' && c.position && shiftRef.current.get(c.id) ? { ...c, position: { x: c.position.x - shiftRef.current.get(c.id)!, y: c.position.y } } : c));
      setNodes((n) => applyNodeChanges(ch, n));
      if (mode === 'design' && ch.some((c) => c.type === 'position' || c.type === 'remove')) setDirty(true);
    },
    [mode],
  );
  const onEdgesChange = useCallback(
    (ch: EdgeChange[]) => {
      setEdges((e) => applyEdgeChanges(ch, e));
      if (mode === 'design' && ch.some((c) => c.type === 'remove')) setDirty(true);
    },
    [mode],
  );
  const onConnect = useCallback((c: Connection) => {
    const pe: PEdge = { id: `e_${Date.now().toString(36)}`, source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? 'out' };
    setEdges((e) => addEdge(edgeStyle(pe), e.filter((x) => !(x.source === c.source && x.sourceHandle === c.sourceHandle && x.target === c.target))));
    setDirty(true);
  }, []);

  const updateNode = (id: string, patch: Partial<NData>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  };

  const addNode = (kind: 'role' | 'end' | 'stage', roleId?: string, stage?: StageKind) => {
    const rect = wrapper.current?.getBoundingClientRect();
    const pos = rf.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 800) / 2, y: (rect?.top || 0) + (rect?.height || 600) / 2 });
    const id = `n_${Date.now().toString(36)}`;
    if (kind === 'end') {
      setNodes((n) => [...n, { id, type: 'end', position: pos, data: { label: 'Done' } }]);
    } else if (kind === 'stage' && stage) {
      // a standard stage follows its role's model (no config copied), so changing the role updates it
      const c = STAGES[stage];
      setNodes((n) => [...n, { id, type: 'agent', position: pos, data: { label: c.name, roleId: c.roleId, stage, verdict: c.verdict, approval: true, maxLoops: 3 } }]);
    } else {
      const r = roles.find((x) => x.id === roleId)!;
      setNodes((n) => [
        ...n,
        { id, type: 'agent', position: pos, data: { label: r.name, roleId: r.id, config: { ...r.config }, prompt: r.promptTemplate, approval: true, verdict: !!r.verdict, maxLoops: 3 } },
      ]);
    }
    setSelected(id);
    setDirty(true);
  };

  const current = (): Pipeline | undefined => (base ? fromRF(base, nodes, edges) : undefined);

  const save = async (asNew = false) => {
    const p = current();
    if (!p) return;
    if (asNew) {
      const name = prompt('Tên pipeline mới', `${p.name} (bản sao)`);
      if (!name) return;
      p.id = `p_${Date.now().toString(36)}`;
      p.name = name;
    }
    await savePipeline(p);
    setBase(p);
    setTplId(p.id);
    setDirty(false);
  };

  const runNow = async (task: string) => {
    const p = current();
    if (!p || !task.trim()) return;
    const c = await ensureConv();
    if (!c) return;
    const ok = await safe(api('POST', `/conversations/${encodeURIComponent(c.id)}/run${qs({ project: getState().project })}`, { pipeline: p, task }));
    if (ok) setMode('run');
  };

  const sel = shownNodes.find((n) => n.id === selected);
  const running = run?.status === 'running';
  const tokens = run
    ? Object.values(run.nodes).reduce((a, s) => a + (s.usage ? s.usage.inputTokens + s.usage.outputTokens : 0), 0)
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel/60 px-3">
        <div className="inline-flex shrink-0 whitespace-nowrap rounded-lg bg-hover/70 p-0.5 text-[12.5px]">
          <button type="button" onClick={() => setMode('design')} className={cx('rounded-md px-2.5 py-1', mode === 'design' ? 'bg-raised shadow-sm' : 'text-muted hover:text-fg')}>
            <PenLine size={13} className="mr-1 inline" /> Thiết kế
          </button>
          <button
            type="button"
            disabled={!run}
            onClick={() => setMode('run')}
            className={cx('rounded-md px-2.5 py-1 disabled:opacity-40', mode === 'run' ? 'bg-raised shadow-sm' : 'text-muted hover:text-fg')}
          >
            <Play size={13} className="mr-1 inline" /> Lần chạy
            {running && <Spinner size={11} className="ml-1 inline text-accent" />}
            {run?.status === 'awaiting' && <Pause size={11} className="ml-1 inline text-warn" />}
          </button>
        </div>

        {mode === 'design' ? (
          <>
            <Select
              value={tplId}
              width={280}
              onChange={(id) => {
                if (dirty && !confirm('Bỏ các thay đổi chưa lưu?')) return;
                const p = pipelines.find((x) => x.id === id);
                setTplId(id);
                setBase(p);
                setSelected(undefined);
              }}
              options={pipelines.map((p) => ({ value: p.id, label: p.name, hint: `${p.nodes.filter((n) => n.type === 'agent').length} bước` }))}
              display={<span className="max-w-[220px] truncate font-medium text-fg">{base?.name || 'Chọn pipeline'}</span>}
            />
            {base && (
              <button
                type="button"
                title="Đổi tên"
                onClick={() => {
                  const name = prompt('Tên pipeline', base.name);
                  if (name) {
                    setBase({ ...fromRF(base, nodes, edges), name });
                    setDirty(true);
                  }
                }}
                className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
              >
                <PenLine size={13} />
              </button>
            )}
            {dirty && <span className="text-[11.5px] text-warn">● chưa lưu</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <Popover
                placement="bottom-end"
                width={250}
                trigger={(_o, toggle) => (
                  <button type="button" onClick={toggle} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2.5 text-[12.5px] hover:bg-hover">
                    <Plus size={14} /> Thêm bước
                  </button>
                )}
              >
                {(close) => (
                  <div>
                    <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Bước chuẩn</div>
                    {STAGE_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        title={`${STAGES[k].does}\nKết quả: ${STAGES[k].output}\nXong khi: ${STAGES[k].done}`}
                        onClick={() => {
                          close();
                          addNode('stage', undefined, k);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
                      >
                        <span>{STAGES[k].icon}</span>
                        <span className="flex-1">{STAGES[k].name}</span>
                        {STAGES[k].verdict && <span className="text-[11px] text-faint">có chấm đạt</span>}
                      </button>
                    ))}
                    <div className="px-2.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Theo vai trò (tự viết prompt)</div>
                    {roles.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          close();
                          addNode('role', r.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
                      >
                        <span>{r.icon}</span>
                        <span className="flex-1">{r.name}</span>
                        <AgentIcon agent={r.config.agent} size={13} />
                        <span className="text-[11px] text-faint">{r.config.model}</span>
                      </button>
                    ))}
                    <div className="my-1 border-t border-line" />
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        addNode('end');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-hover"
                    >
                      <Flag size={14} /> Kết thúc (Done)
                    </button>
                  </div>
                )}
              </Popover>
              <button type="button" onClick={tidy} title="Tự sắp xếp các bước thành một hàng theo thứ tự chạy" className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2.5 text-[12.5px] hover:bg-hover">
                <LayoutGrid size={13} /> Sắp xếp
              </button>
              <button type="button" onClick={() => save(false)} disabled={!dirty} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2.5 text-[12.5px] hover:bg-hover disabled:opacity-40">
                <Save size={13} /> Lưu
              </button>
              <button type="button" onClick={() => save(true)} title="Lưu thành pipeline mới" className="inline-flex h-7 items-center rounded-lg border border-line px-2 text-[12.5px] hover:bg-hover">
                <Copy size={13} />
              </button>
              {pipelines.length > 1 && base && (
                <button
                  type="button"
                  title="Xoá pipeline"
                  onClick={async () => {
                    if (!confirm(`Xoá pipeline "${base.name}"?`)) return;
                    await deletePipeline(base.id);
                    const next = getState().pipelines[0];
                    setBase(next);
                    setTplId(next?.id || '');
                  }}
                  className="inline-flex h-7 items-center rounded-lg px-2 text-muted hover:bg-hover hover:text-err"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <RunButton disabled={running} onRun={runNow} />
            </div>
          </>
        ) : (
          run && (
            <>
              <span className="max-w-[240px] shrink-0 truncate text-[13px] font-medium">{run.pipeline.name}</span>
              <span
                className={cx(
                  'shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-medium',
                  run.status === 'done' ? 'bg-ok/15 text-ok' : run.status === 'error' ? 'bg-err/15 text-err' : run.status === 'awaiting' ? 'bg-warn/15 text-warn' : run.status === 'stopped' ? 'bg-hover text-muted' : 'bg-accent/15 text-accent',
                )}
              >
                {{ running: 'Đang chạy', awaiting: 'Chờ duyệt', done: 'Hoàn thành', error: 'Lỗi', stopped: 'Đã dừng' }[run.status]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={run.task}>
                Task: {run.task}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] text-faint">
                {tokens > 0 && <span>Σ {fmtTokens(tokens)} token</span>}
                <span>{fmtDuration((run.endedAt || Date.now()) - run.startedAt)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setBase({ ...structuredClone(run.pipeline), id: `p_${Date.now().toString(36)}`, name: `${run.pipeline.name} (từ lần chạy)` });
                    setTplId('');
                    setMode('design');
                  }}
                  className="rounded-lg border border-line px-2 py-1 text-fg hover:bg-hover"
                >
                  Sửa thành template
                </button>
                <button type="button" onClick={() => setState({ activeTab: 'chat' })} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-fg hover:bg-hover">
                  <MessageSquare size={13} /> Chat
                </button>
                <button
                  type="button"
                  title="Bỏ kết quả lần chạy này và chạy lại task từ bước đầu tiên"
                  onClick={() => {
                    if (confirm('Chạy lại pipeline từ đầu?\n\nKết quả và các mục đã chấm của lần chạy này sẽ bị bỏ. Tin nhắn trong chat vẫn giữ.'))
                      void api('POST', `/conversations/${encodeURIComponent(conv!.id)}/run-reset${qs({ project: getState().project })}`, {}).catch((e) => toast(e.message));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-fg hover:bg-hover"
                >
                  <RotateCcw size={13} /> Chạy lại từ đầu
                </button>
                {(running || run.status === 'awaiting') && (
                  <button
                    type="button"
                    onClick={() => void api('POST', `/conversations/${encodeURIComponent(conv!.id)}/run-stop${qs({ project: getState().project })}`, {}).catch((e) => toast(e.message))}
                    className="rounded-lg border border-err/40 px-2 py-1 text-err hover:bg-err/10"
                  >
                    Dừng
                  </button>
                )}
              </div>
            </>
          )
        )}
      </div>

      {mode === 'design' && nodes.some((n) => n.type === 'agent') && !nodes.some((n) => n.data.stage) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-accent/5 px-4 py-2 text-[12.5px]">
          <span className="min-w-0 flex-1">
            Pipeline này dùng bước <b>tuỳ chỉnh</b>: mỗi bước chỉ có prompt riêng. Bước <b>chuẩn</b> có hợp đồng rõ (Plan ra AC, Test chọn loại test theo thay đổi, Review chấm theo mức) nên ít phải sửa đi sửa lại.
          </span>
          <button
            type="button"
            onClick={() => {
              const next = toStandardStages(nodes, edges);
              if (!next.changed) return toast('Không có bước nào khớp vai trò Plan / Review / Code / Test để chuyển.', 'info');
              setNodes(next.nodes);
              setDirty(true);
              toast(`Đã chuyển ${next.changed} bước sang bước chuẩn. Bấm Lưu để giữ lại.`, 'info');
            }}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 font-medium text-white"
          >
            Chuyển sang bước chuẩn
          </button>
          {pipelines.some((p) => p.id === 'standard') && (
            <button
              type="button"
              onClick={() => {
                const p = pipelines.find((x) => x.id === 'standard')!;
                setTplId(p.id);
                setBase(p);
              }}
              className="shrink-0 rounded-md border border-line px-2.5 py-1 hover:bg-hover"
            >
              Mở Pipeline chuẩn
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={wrapper} className="min-w-0 flex-1">
          <ReactFlow
            nodes={shownNodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.type === 'item' || n.type === 'sub' ? (n.data as ItemData).parent : n.id)}
            onPaneClick={() => setSelected(undefined)}
            nodesConnectable={mode === 'design'}
            deleteKeyCode={mode === 'design' ? ['Backspace', 'Delete'] : null}
            proOptions={{ hideAttribution: true }}
            minZoom={0.12}
            maxZoom={1.6}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--line-strong)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable bgColor="var(--panel)" maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" nodeStrokeWidth={2} nodeColor={(n) => ((n.data as NData).run?.status === 'running' ? 'var(--accent)' : 'var(--line-strong)')} />
          </ReactFlow>
        </div>
        {sel && (
          <div className="w-[360px] shrink-0 overflow-y-auto border-l border-line bg-panel">
            {mode === 'design' ? (
              <DesignInspector node={sel} onChange={(p) => updateNode(sel.id, p)} onDelete={() => {
                setNodes((n) => n.filter((x) => x.id !== sel.id));
                setEdges((e) => e.filter((x) => x.source !== sel.id && x.target !== sel.id));
                setSelected(undefined);
                setDirty(true);
              }} />
            ) : (
              <RunInspector node={sel} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RunButton({ disabled, onRun }: { disabled?: boolean; onRun: (task: string) => void }) {
  const [task, setTask] = useState('');
  return (
    <Popover
      placement="bottom-end"
      width={380}
      trigger={(_o, toggle) => (
        <button type="button" onClick={toggle} disabled={disabled} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40">
          <Play size={13} fill="currentColor" /> Chạy
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-2 p-2">
          <div className="text-[12px] font-medium text-muted">Task cho pipeline (chạy trong cuộc trò chuyện đang mở)</div>
          <textarea
            autoFocus
            className={cx(inputCls, 'h-28 resize-y')}
            placeholder="VD: Thêm trang đăng nhập bằng email + mật khẩu"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                close();
                onRun(task);
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-faint">⌘ + Enter để chạy</span>
            <button
              type="button"
              disabled={!task.trim()}
              onClick={() => {
                close();
                onRun(task);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            >
              <Play size={13} fill="currentColor" /> Chạy pipeline
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function DesignInspector({ node, onChange, onDelete }: { node: RFNode; onChange: (p: Partial<NData>) => void; onDelete: () => void }) {
  const roles = useStore((s) => s.roles);
  const d = node.data;
  if (node.type === 'task')
    return (
      <div className="p-4 text-[13px] text-muted">
        <div className="mb-2 font-semibold text-fg">Task</div>
        Điểm bắt đầu. Nội dung task được nhập khi bấm <b>Chạy</b>, dùng trong prompt qua biến <code className="rounded bg-code px-1">{'{{task}}'}</code>.
      </div>
    );
  if (node.type === 'end')
    return (
      <div className="space-y-3 p-4">
        <Field label="Tên">
          <input className={inputCls} value={d.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-[13px] text-err hover:underline">
          <Trash2 size={13} /> Xoá node
        </button>
      </div>
    );
  return <AgentInspector key={node.id} d={d} onChange={onChange} onDelete={onDelete} />;
}

type InspectorTab = 'general' | 'items' | 'guide' | 'check' | 'prompt';

/** A step's settings in four tabs: who and how, its guidance, checking options, raw prompt. */
function AgentInspector({ d, onChange, onDelete }: { d: NData; onChange: (p: Partial<NData>) => void; onDelete: () => void }) {
  const roles = useStore((s) => s.roles);
  const role = roles.find((r) => r.id === d.roleId);
  const cfg = d.config ?? role?.config ?? { agent: 'claude' as const, model: 'sonnet', permission: 'read' as const };
  const stage = d.stage ? STAGES[d.stage] : undefined;
  const checkLabel = d.stage === 'test' ? 'Loại test' : d.stage === 'review-plan' || d.stage === 'review-code' ? 'Kiểm tra lại' : undefined;
  const [tab, setTab] = useState<InspectorTab>('general');
  const tabs: [InspectorTab, string][] = [['general', 'Chung'], ...(stage && d.stage !== 'test' ? [['items', d.stage === 'plan' ? 'Mục' : d.stage === 'code' ? 'Tự kiểm' : 'Tiêu chí soát'] as [InspectorTab, string]] : []),
    ...(stage ? [['guide', 'Hướng dẫn'] as [InspectorTab, string]] : []), ...(checkLabel ? [['check', checkLabel] as [InspectorTab, string]] : []), ['prompt', 'Prompt']];
  const active = tabs.some(([k]) => k === tab) ? tab : 'general';

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-4 pb-0">
        <div className="flex items-center gap-2">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[17px]"
            style={{ background: `color-mix(in srgb, ${stage?.color ?? 'var(--line-strong)'} 16%, transparent)` }}
          >
            {stage?.icon ?? role?.icon ?? '⚙️'}
          </span>
          <div className="min-w-0 flex-1">
            <input
              className="w-full rounded-md bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-hover focus:bg-hover"
              value={d.label}
              onChange={(e) => onChange({ label: e.target.value })}
              title="Đổi tên bước"
            />
            <div className="px-1 text-[11.5px]" style={{ color: stage?.color }}>
              {stage ? `Bước chuẩn · ${stage.name}` : <span className="text-faint">Bước tự viết prompt</span>}
            </div>
          </div>
          <button type="button" onClick={onDelete} title="Xoá bước" className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-err">
            <Trash2 size={15} />
          </button>
        </div>
        <div className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cx('-mb-px border-b-2 px-2.5 py-1.5 text-[12.5px]', active === k ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {active === 'general' && (
          <>
            <Field label="Loại bước">
              <select
                className={inputCls}
                value={d.stage || ''}
                onChange={(e) => {
                  const k = (e.target.value || undefined) as StageKind | undefined;
                  onChange({ stage: k, ...(k ? { verdict: STAGES[k].verdict } : {}) });
                }}
              >
                {STAGE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {STAGES[k].icon} {STAGES[k].name}: {STAGES[k].does}
                  </option>
                ))}
                <option value="">✏️ Tự viết prompt</option>
              </select>
            </Field>
            <Field label="Ai làm">
              <div className="space-y-1.5 rounded-lg border border-line p-2">
                <select
                  className={cx(inputCls, 'py-1')}
                  value={d.roleId || ''}
                  title="Đổi vai trò sẽ lấy model, quyền và prompt của vai trò đó"
                  onChange={(e) => {
                    const r = roles.find((x) => x.id === e.target.value);
                    if (r) onChange({ roleId: r.id, config: undefined, prompt: r.promptTemplate, label: d.label === role?.name ? r.name : d.label });
                  }}
                >
                  <option value="">Không theo vai trò nào</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      Vai trò {r.icon} {r.name}
                    </option>
                  ))}
                </select>
                <ConfigPicker value={cfg} onChange={(config) => onChange({ config })} placement="bottom-start" compact />
                {d.config && role && (
                  <button type="button" onClick={() => onChange({ config: undefined })} className="text-[11.5px] text-muted hover:text-fg hover:underline">
                    Dùng lại model của vai trò {role.name}
                  </button>
                )}
              </div>
            </Field>
            <Field label="Sau khi bước này xong">
              <div className="space-y-2.5 rounded-lg border border-line p-2.5">
                <Toggle checked={!!d.approval} onChange={(approval) => onChange({ approval })} label="Dừng lại chờ bạn duyệt" />
                <Toggle checked={!!d.verdict} onChange={(verdict) => onChange({ verdict })} label="Chấm đạt hoặc chưa đạt (chưa đạt thì đi nhánh làm lại)" />
                <label className="flex items-center gap-2 text-[13px]">
                  Bước này chạy tối đa
                  <input
                    className="w-16 shrink-0 rounded-lg border border-line bg-bg px-2 py-1 text-center text-[13px] outline-none focus:border-accent"
                    type="number"
                    min={1}
                    max={10}
                    value={d.maxLoops ?? 3}
                    onChange={(e) => onChange({ maxLoops: Number(e.target.value) || 1 })}
                  />
                  lần
                </label>
              </div>
            </Field>
          </>
        )}

        {active === 'items' && d.stage && <ChecklistEditor d={d} onChange={onChange} />}
        {active === 'guide' && d.stage && <GuideEditor d={d} cfg={cfg} onChange={onChange} />}

        {active === 'check' && d.stage === 'test' && <TestConfig d={d} onChange={onChange} />}
        {active === 'check' && (d.stage === 'review-plan' || d.stage === 'review-code') && (
          <>
            <Field label="Khi chấm lại lần sau">
              <select className={inputCls} value={d.reviewMode ?? 'auto'} onChange={(e) => onChange({ reviewMode: e.target.value as PNodeData['reviewMode'] })}>
                <option value="auto">Tự chọn: lần đầu xem hết, các lần sau chỉ xem phần mới sửa</option>
                <option value="incremental">Chỉ xem phần mới sửa</option>
                <option value="full">Lần nào cũng xem lại toàn bộ</option>
              </select>
            </Field>
            <Field label="Tính là chưa đạt khi">
              <select className={inputCls} value={d.failAt ?? 'blocking'} onChange={(e) => onChange({ failAt: e.target.value as PNodeData['failAt'] })}>
                <option value="blocking">Còn lỗi mức Chặn</option>
                <option value="should">Còn lỗi mức Chặn hoặc Nên sửa</option>
              </select>
            </Field>
          </>
        )}

        {active === 'prompt' && (
          <Field
            label="Prompt của bước"
            hint={
              <>
                Biến: <code>{'{{task}}'}</code> task gốc · <code>{'{{prev}}'}</code> kết quả bước trước · <code>{'{{Tên bước}}'}</code> kết quả của bước đó. Ngữ cảnh các bước trước được tự gửi kèm.
                {stage && ' Hướng dẫn ở tab Hướng dẫn được thêm vào sau prompt này.'}
              </>
            }
          >
            <textarea className={cx(inputCls, 'h-56 resize-y font-mono text-[12px]')} value={d.prompt ?? role?.promptTemplate ?? ''} onChange={(e) => onChange({ prompt: e.target.value })} />
            {d.roleId && (
              <button
                type="button"
                onClick={async () => {
                  const defs = await safe(api<{ id: string; promptTemplate: string }[]>('GET', '/roles/defaults'));
                  const def = defs?.find((r) => r.id === d.roleId);
                  if (!def) return toast('Vai trò này không có prompt gốc (vai trò tự tạo).', 'info');
                  onChange({ prompt: def.promptTemplate });
                  toast('Đã lấy lại prompt gốc. Nhớ bấm Lưu.', 'info');
                }}
                className="mt-1 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Lấy lại prompt gốc của vai trò
              </button>
            )}
          </Field>
        )}
      </div>
    </div>
  );
}

/** The items the step is made of (the tree under it): rename, explain, add, remove, back to defaults. */
/** The sub-cards of an item, typed as "Mục tiêu; Trong phạm vi; Ngoài phạm vi" (kept as typed while editing). */
function PartsInput({ parts, onChange }: { parts?: string[]; onChange: (p: string[] | undefined) => void }) {
  const [text, setText] = useState(parts?.join('; ') ?? '');
  return (
    <input
      className="mt-0.5 w-full bg-transparent pl-[34px] text-[12px] text-muted outline-none placeholder:text-faint/70"
      placeholder="Ý con, cách nhau bằng dấu ; (không bắt buộc)"
      title="Mỗi ý con là một thẻ nhỏ sau mục này trên sơ đồ. Khi chạy, AI điền nội dung cho từng ý."
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const list = e.target.value.split(';').map((x) => x.trim()).filter(Boolean);
        onChange(list.length ? list : []);
      }}
    />
  );
}

function ChecklistEditor({ d, onChange }: { d: NData; onChange: (p: Partial<NData>) => void }) {
  const stage = d.stage!;
  if (stage === 'test')
    return (
      <p className="text-[12.5px] text-muted">
        Mục của bước Test là các loại test đang bật, cộng một mục kiểm từng AC. Bật tắt loại test ở tab <b>Loại test</b>.
      </p>
    );
  const prefix = CHECKLISTS[stage][0].id[0];
  const items = checklistOf(stage, d);
  const set = (list: ChecklistItem[]) => onChange({ checklist: list });
  const edit = (i: number, patch: Partial<ChecklistItem>) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const nextId = () => {
    const used = new Set(items.map((x) => x.id));
    for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
  };
  return (
    <>
      <p className="text-[12px] text-faint">
        {stage === 'plan'
          ? 'Các phần plan phải có. Trên sơ đồ mỗi phần là một mục, bước Review plan chấm từng mục; mục chưa đạt thì Plan chỉ viết lại đúng mục đó. Mặc định theo mẫu tài liệu thiết kế kỹ thuật (design doc).'
          : stage === 'code'
            ? 'Danh sách Code tự kiểm trước khi giao. Mục của Code trên sơ đồ là các AC do Plan viết, do Test và Review code chấm. Mặc định theo tiêu chuẩn "thế nào là xong" (Definition of Done).'
            : 'Các tiêu chí bước này dùng để soát từng mục của bước trước. Mặc định theo checklist review phổ biến.'}
      </p>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={it.id} className="group rounded-lg border border-line p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-7 shrink-0 font-mono text-[11px] text-faint">{it.id}</span>
              <input className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none" value={it.text} onChange={(e) => edit(i, { text: e.target.value })} />
              <button
                type="button"
                title="Bỏ mục này"
                onClick={() => set(items.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-err group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
            <input
              className="mt-0.5 w-full bg-transparent pl-[34px] text-[12px] text-muted outline-none placeholder:text-faint/70"
              placeholder="Thế nào là đạt (không bắt buộc)"
              value={it.hint ?? ''}
              onChange={(e) => edit(i, { hint: e.target.value || undefined })}
            />
            <PartsInput parts={it.parts} onChange={(parts) => edit(i, { parts })} />
            {it.ac && <div className="pl-[34px] text-[11px] text-faint">Mục này mở ra các AC của plan khi chạy</div>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => set([...items, { id: nextId(), text: 'Mục mới' }])} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
          <Plus size={13} /> Thêm mục
        </button>
        {d.checklist && (
          <button type="button" onClick={() => onChange({ checklist: undefined })} className="text-[12.5px] text-muted hover:text-fg hover:underline">
            Về danh sách mặc định
          </button>
        )}
      </div>
    </>
  );
}

/** The step's guidance, editable: goal fields (shown on the card), extra rules, the app's detailed rules on/off. */
function GuideEditor({ d, cfg, onChange }: { d: NData; cfg: RunConfig; onChange: (p: Partial<NData>) => void }) {
  const [preview, setPreview] = useState(false);
  const def = STAGES[d.stage!];
  const g = d.guide ?? {};
  const set = (patch: Partial<NonNullable<PNodeData['guide']>>) => onChange({ guide: { ...g, ...patch } });
  const edited = Object.values(g).some((v) => v !== undefined && v !== '' && v !== true);
  const fields: [keyof typeof g & ('does' | 'input' | 'output' | 'done'), string, string][] = [
    ['does', 'Việc cần làm', def.does],
    ['input', 'Dựa trên', def.input],
    ['output', 'Phải trả về', def.output],
    ['done', 'Xong khi', def.done],
  ];
  const fakeRun = { ac: undefined } as unknown as PipelineRun;
  return (
    <>
      <p className="text-[12px] text-faint">Sửa theo cách làm của bạn. Ô để trống thì dùng câu mặc định (chữ mờ). Nội dung này hiện trên thẻ và được gửi cho agent.</p>
      {fields.map(([k, label, placeholder]) => (
        <Field key={k} label={label}>
          <textarea
            rows={2}
            className={cx(inputCls, 'resize-y text-[13px]')}
            placeholder={placeholder}
            value={(g[k] as string | undefined) ?? ''}
            onChange={(e) => set({ [k]: e.target.value })}
          />
        </Field>
      ))}
      <Field label="Quy tắc thêm" hint="Agent làm theo quy tắc này trước, kể cả khi khác hướng dẫn chung">
        <textarea
          rows={3}
          className={cx(inputCls, 'resize-y text-[13px]')}
          placeholder={'Ví dụ:\n- Viết test bằng vitest, đặt cạnh file code\n- Không sửa thư mục legacy/'}
          value={g.rules ?? ''}
          onChange={(e) => set({ rules: e.target.value })}
        />
      </Field>
      <div className="space-y-2 rounded-lg border border-line p-2.5">
        <Toggle
          checked={g.standard !== false}
          onChange={(on) => set({ standard: on ? undefined : false })}
          label={`Dùng thêm hướng dẫn chi tiết của app cho bước ${def.name}`}
        />
        <p className="text-[11.5px] text-faint">Tắt nếu bạn muốn agent chỉ làm theo những gì bạn viết ở trên và trong tab Prompt.</p>
        <button type="button" onClick={() => setPreview(!preview)} className="text-[12px] text-accent hover:underline">
          {preview ? 'Ẩn nội dung gửi cho agent' : 'Xem nội dung gửi cho agent'}
        </button>
        {preview && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-[11.5px] leading-relaxed text-muted">
            {stageInstruction(d.stage, d, fakeRun, false, cfg).trim()}
          </pre>
        )}
      </div>
      {edited && (
        <button type="button" onClick={() => onChange({ guide: undefined })} className="text-[12px] text-muted hover:text-fg hover:underline">
          Về mặc định
        </button>
      )}
    </>
  );
}

const MODE_LABEL: Record<TestMode, string> = { auto: 'Tự động', always: 'Luôn chạy', skip: 'Bỏ qua' };

/** Which kinds of test the Test step runs: by default each one runs only when the change calls for it. */
function TestConfig({ d, onChange }: { d: NData; onChange: (p: Partial<NData>) => void }) {
  const set = (id: string, mode: TestMode) => onChange({ tests: { ...d.tests, [id]: mode } });
  return (
    <Field label="Loại test" hint="Tự động: chỉ chạy khi phần code vừa đổi cần tới. Rê chuột lên tên test để xem khi nào chạy">
      <div className="divide-y divide-line rounded-lg border border-line">
        {TESTS.map((t) => {
          const mode = d.tests?.[t.id] ?? 'auto';
          return (
            <div key={t.id} className="flex items-center gap-2 px-2 py-1" title={`Kiểm: ${t.checks}\nCách: ${t.how}\nKhi nào: ${t.when || 'mọi thay đổi code'}`}>
              <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', mode === 'skip' && 'text-faint line-through')}>{t.name}</span>
              <div className="flex shrink-0 rounded-md bg-hover p-0.5 text-[11px]">
                {(['auto', 'always', 'skip'] as TestMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set(t.id, m)}
                    className={cx('rounded px-1.5 py-0.5', mode === m ? 'bg-panel font-medium text-fg shadow-sm' : 'text-faint hover:text-fg')}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[12.5px]">
        <span className="text-muted">Test hồi quy chạy</span>
        <select className={cx(inputCls, 'w-auto py-1')} value={d.regression ?? 'area'} onChange={(e) => onChange({ regression: e.target.value as 'area' | 'full' })}>
          <option value="area">phần liên quan tới code vừa đổi</option>
          <option value="full">toàn bộ test của project</option>
        </select>
      </div>
    </Field>
  );
}

/** The plan's criteria during a run, with what the checking steps said. */
function CriteriaList({ ac }: { ac: AcceptanceCriterion[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">Tiêu chí đạt (AC)</div>
      <div className="space-y-1 rounded-lg border border-line p-2">
        {ac.map((a) => (
          <div key={a.id} className="flex gap-1.5 text-[12.5px]" title={a.by ? `Bước ${a.by} đã kiểm tra` : 'Chưa kiểm tra'}>
            <span className={cx('w-4 shrink-0 text-center', a.status === 'pass' ? 'text-ok' : a.status === 'fail' ? 'text-err' : 'text-faint')}>
              {a.status === 'pass' ? '✓' : a.status === 'fail' ? '✗' : '·'}
            </span>
            <span className="shrink-0 font-medium">{a.id}</span>
            <span className="text-muted">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Each item this step made or judged, with the checkers' verdicts and reasons. */
function ItemResults({ node, run }: { node: RFNode; run: PipelineRun }) {
  const items = node.data.judge?.items ?? producedItems(node.data.stage, node.data, run.ac);
  // the points written under each item belong to the step that made them
  const subs = node.data.judge ? undefined : node.data.run?.subs;
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{node.data.judge ? `Chấm các mục của ${node.data.judge.label}` : 'Các mục bước này làm ra'}</div>
      <div className="space-y-1 rounded-lg border border-line p-2">
        {items.map((it) => {
          const m = run.marks?.[it.id];
          const st = m ? MARK_STYLE[m.status] : undefined;
          return (
            <div key={it.id} className="text-[12.5px]" title={m?.by ? `${st?.word} (${m.by})` : 'Chưa chấm'}>
              <div className="flex gap-1.5">
                <span className={cx('w-4 shrink-0 text-center font-semibold', st?.cls ?? 'text-faint')}>{st?.icon ?? '○'}</span>
                <span className="shrink-0 font-mono text-[11px] leading-[19px] text-faint">{it.id}</span>
                <span>{it.text}</span>
              </div>
              {m?.note && <div className={cx('pl-[46px] text-[12px]', m.status === 'fail' ? 'text-err/85' : 'text-muted')}>{m.note}</div>}
              {subs?.[it.id]?.length ? (
                <ul className="pl-[46px] text-[12px] text-muted">
                  {subs[it.id].map((t, k) => (
                    <li key={k} className="list-inside list-disc truncate" title={t}>
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The step's own criteria / self-checks / test kinds and what it reported for each. */
function OwnResults({ node, items }: { node: RFNode; items: NonNullable<NodeRunState['items']> }) {
  const own = checklistOf(node.data.stage!, node.data).filter((i) => !i.ac);
  const subs = node.data.run?.subs;
  const title = node.data.stage === 'test' ? 'Các loại test' : node.data.stage === 'code' ? 'Tự kiểm' : 'Tiêu chí soát';
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      <div className="space-y-1 rounded-lg border border-line p-2">
        {own.map((it) => {
          const m = items[it.id];
          const st = m ? MARK_STYLE[m.status] : undefined;
          return (
            <div key={it.id} className="text-[12.5px]">
              <div className="flex gap-1.5">
                <span className={cx('w-4 shrink-0 text-center font-semibold', st?.cls ?? 'text-faint')}>{st?.icon ?? '○'}</span>
                <span className="shrink-0 font-mono text-[11px] leading-[19px] text-faint">{it.id}</span>
                <span>{it.text}</span>
              </div>
              {m?.note && <div className={cx('pl-[46px] text-[12px]', m.status === 'fail' ? 'text-err/85' : 'text-muted')}>{m.note}</div>}
              {subs?.[it.id]?.length ? (
                <ul className="pl-[46px] text-[12px] text-muted">
                  {subs[it.id].map((t, k) => (
                    <li key={k} className="list-inside list-disc truncate" title={t}>
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunInspector({ node }: { node: RFNode }) {
  const conv = useStore((s) => s.conv);
  const catalog = useStore((s) => s.catalog);
  const run = conv?.run;
  const st = node.data.run;
  const cfg = node.data.config;
  const turn = useMemo(() => conv?.turns.find((t) => t.id === st?.turnId), [conv, st?.turnId]);
  if (!run || !conv) return null;
  if (node.type !== 'agent')
    return (
      <div className="p-4 text-[13px]">
        <div className="mb-1 font-semibold">{node.type === 'task' ? 'Task' : node.data.label}</div>
        {node.type === 'task' && <div className="whitespace-pre-wrap text-muted">{run.task}</div>}
      </div>
    );
  return (
    <div className="space-y-3 p-4 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{node.data.label}</span>
        <RunIcon st={st} />
        <span className="text-muted">{st ? { idle: 'Chưa chạy', running: 'Đang chạy', awaiting: 'Chờ duyệt', done: 'Xong', error: 'Lỗi', stopped: 'Đã dừng' }[st.status] : ''}</span>
      </div>
      {cfg && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
          <AgentIcon agent={cfg.agent} size={14} /> {AGENT_NAME[cfg.agent]} · {modelLabel(catalog, cfg.agent, cfg.model)} · {EFFORT_LABEL[cfg.effort || ''] || cfg.effort} · {PERMISSIONS.find((p) => p.id === cfg.permission)?.label}
        </div>
      )}
      {st && (st.durationMs || st.usage) && (
        <div className="text-[12px] text-faint">
          Lần {st.runs} · {fmtDuration(st.durationMs)} · {fmtUsage(st.usage)}
        </div>
      )}
      {st?.verdict && <div className={cx('font-semibold', st.verdict === 'pass' ? 'text-ok' : 'text-err')}>VERDICT: {st.verdict.toUpperCase()}</div>}
      {node.data.judge?.items.length || isProducer(node.data.stage) ? <ItemResults node={node} run={run} /> : null}
      {node.data.stage && node.data.stage !== 'plan' && st?.items ? <OwnResults node={node} items={st.items} /> : null}
      {node.data.stage === 'plan' && run.ac?.length ? <CriteriaList ac={run.ac} /> : null}
      {st?.error && <div className="whitespace-pre-wrap rounded-lg bg-err/5 p-2 text-[12.5px] text-err">{st.error}</div>}
      {run.current === node.id && ['awaiting', 'error', 'stopped'].includes(run.status) && <ApprovalCard conv={conv} run={run} compact />}
      {st?.status === 'running' && turn && (
        <div className="text-[12.5px] text-muted">
          {turn.blocks.filter((b) => b.type === 'tool').length} tool call… <Spinner size={11} className="inline" />
        </div>
      )}
      {st?.output && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Kết quả</div>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-line bg-bg p-3">
            <Markdown text={st.output} className="text-[13.5px]" />
          </div>
        </div>
      )}
      <button type="button" onClick={() => setState({ activeTab: 'chat' })} className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
        <MessageSquare size={13} /> Xem đầy đủ trong chat
      </button>
    </div>
  );
}
