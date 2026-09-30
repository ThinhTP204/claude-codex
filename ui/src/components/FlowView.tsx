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
import { Check, CirclePlay, Copy, Flag, MessageSquare, Pause, PenLine, Play, Plus, Save, Scale, Square, Trash2, X } from 'lucide-react';
import type { NodeRunState, PEdge, PNode, PNodeData, Pipeline, PipelineRun } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { deletePipeline, ensureConv, getState, safe, savePipeline, setState, toast, useStore } from '../store.ts';
import { ConfigPicker } from './ConfigPicker.tsx';
import { ApprovalCard } from './ChatView.tsx';
import { Markdown } from './Message.tsx';
import { AGENT_NAME, AgentIcon, EFFORT_LABEL, Field, PERMISSIONS, Popover, Select, Spinner, Toggle, cx, fmtDuration, fmtTokens, fmtUsage, inputCls, modelLabel } from './ui.tsx';

type NData = PNodeData & { run?: NodeRunState; current?: boolean; runMode?: boolean; task?: string; [k: string]: unknown };
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

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<RFNode>) {
  const catalog = useStore((s) => s.catalog);
  const roles = useStore((s) => s.roles);
  const role = roles.find((r) => r.id === data.roleId);
  const cfg = data.config ?? role?.config;
  const st = data.run;
  const perm = PERMISSIONS.find((p) => p.id === cfg?.permission);
  return (
    <div
      className={cx(
        'w-[230px] rounded-xl border-[1.5px] bg-panel text-[12.5px] shadow-sm transition-shadow',
        data.runMode ? STATUS_RING[st?.status || 'idle'] : 'border-line',
        selected && 'shadow-pop outline-2 outline-offset-2 outline-accent/60',
        data.runMode && st?.status === 'idle' && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[14px]">{role?.icon ?? '⚙️'}</span>
        <span className="truncate font-semibold">{data.label}</span>
        <span className="ml-auto flex items-center gap-1">
          {data.runMode && st && st.runs > 1 && <span className="text-[11px] text-faint" title={`Lần chạy thứ ${st.runs}: bước sau chấm chưa đạt nên gửi lại bước này làm lại`}>lần {st.runs}</span>}
          <RunIcon st={data.runMode ? st : undefined} />
        </span>
      </div>
      {cfg && (
        <div className="space-y-1 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <AgentIcon agent={cfg.agent} size={14} />
            <span className="font-medium">{AGENT_NAME[cfg.agent]}</span>
            <span className="truncate text-muted">{modelLabel(catalog, cfg.agent, cfg.model)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
            {cfg.effort && <span className="rounded bg-hover px-1.5 py-px">{EFFORT_LABEL[cfg.effort] || cfg.effort}</span>}
            {perm && <span className={cx('rounded bg-hover px-1.5 py-px', cfg.permission === 'full' && 'text-err')}>{perm.short}</span>}
            {data.approval && (
              <span className="inline-flex items-center gap-0.5 rounded bg-warn/10 px-1.5 py-px text-warn" title="Dừng chờ duyệt sau bước này">
                <Pause size={9} /> duyệt
              </span>
            )}
            {cfg.fast && <span className="rounded bg-hover px-1.5 py-px">⚡fast</span>}
          </div>
          {data.runMode && st && (st.usage || st.durationMs) && (
            <div className="text-[11px] text-faint">
              {fmtDuration(st.durationMs)} {st.usage && `· ${fmtTokens(st.usage.inputTokens + st.usage.outputTokens)} token`}
            </div>
          )}
          {data.runMode && st?.verdict && (
            <div className={cx('text-[11px] font-semibold', st.verdict === 'pass' ? 'text-ok' : 'text-err')}>VERDICT: {st.verdict.toUpperCase()}</div>
          )}
        </div>
      )}
      {data.verdict ? (
        <>
          <Handle id="pass" type="source" position={Position.Right} style={{ top: '38%', background: 'var(--ok)', borderColor: 'var(--ok)' }} />
          <Handle id="fail" type="source" position={Position.Right} style={{ top: '74%', background: 'var(--err)', borderColor: 'var(--err)' }} />
          <span className="pointer-events-none absolute -right-9 top-[38%] -translate-y-1/2 text-[10px] font-semibold text-ok">pass</span>
          <span className="pointer-events-none absolute -right-7 top-[74%] -translate-y-1/2 text-[10px] font-semibold text-err">fail</span>
        </>
      ) : (
        <Handle id="out" type="source" position={Position.Right} />
      )}
    </div>
  );
});

const TaskNode = memo(function TaskNode({ data, selected }: NodeProps<RFNode>) {
  return (
    <div className={cx('w-[170px] rounded-xl border-[1.5px] bg-panel px-3 py-2.5 shadow-sm', data.runMode ? 'border-ok/60' : 'border-line', selected && 'shadow-pop')}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <CirclePlay size={15} className="text-accent" /> Task
      </div>
      <div className="mt-1 line-clamp-3 text-[11.5px] text-muted">{data.runMode ? data.task : 'Yêu cầu anh nhập khi chạy'}</div>
      <Handle id="out" type="source" position={Position.Right} />
    </div>
  );
});

const EndNode = memo(function EndNode({ data, selected }: NodeProps<RFNode>) {
  const done = data.runMode && data.run?.status === 'done';
  return (
    <div className={cx('flex items-center gap-1.5 rounded-full border-[1.5px] bg-panel px-4 py-2 text-[12.5px] font-semibold shadow-sm', done ? 'border-ok text-ok' : 'border-line', selected && 'shadow-pop')}>
      <Handle type="target" position={Position.Left} />
      <Flag size={14} /> {data.label || 'Done'}
    </div>
  );
});

const nodeTypes = { agent: AgentNode, task: TaskNode, end: EndNode };

function toRF(p: Pipeline, run?: PipelineRun): { nodes: RFNode[]; edges: Edge[] } {
  const nodes: RFNode[] = p.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data, run: run?.nodes[n.id], current: run?.current === n.id, runMode: !!run, task: run?.task },
  }));
  const edges: Edge[] = p.edges.map((e) => edgeStyle(e, run));
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
    type: 'smoothstep',
    animated: active || firstActive,
    style: { stroke: color, strokeWidth: 1.8, strokeDasharray: e.sourceHandle === 'fail' ? '6 4' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  };
}

function fromRF(base: Pipeline, nodes: RFNode[], edges: Edge[]): Pipeline {
  return {
    ...base,
    nodes: nodes.map((n): PNode => {
      const { run: _r, current: _c, runMode: _m, task: _t, ...data } = n.data;
      return { id: n.id, type: n.type as PNode['type'], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: data as PNodeData };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? 'out' })),
  };
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
      void rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: 200 });
    }, 60);
    return () => clearTimeout(t);
  }, [fitKey, nodes.length, activeTab, rf]);

  const onNodesChange = useCallback(
    (ch: NodeChange<RFNode>[]) => {
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

  const addNode = (kind: 'role' | 'end', roleId?: string) => {
    const rect = wrapper.current?.getBoundingClientRect();
    const pos = rf.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 800) / 2, y: (rect?.top || 0) + (rect?.height || 600) / 2 });
    const id = `n_${Date.now().toString(36)}`;
    if (kind === 'end') {
      setNodes((n) => [...n, { id, type: 'end', position: pos, data: { label: 'Done' } }]);
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

  const sel = nodes.find((n) => n.id === selected);
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

      <div className="flex min-h-0 flex-1">
        <div ref={wrapper} className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(undefined)}
            nodesConnectable={mode === 'design'}
            deleteKeyCode={mode === 'design' ? ['Backspace', 'Delete'] : null}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={1.6}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--line-strong)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable bgColor="var(--panel)" maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" nodeStrokeWidth={2} nodeColor={(n) => ((n.data as NData).run?.status === 'running' ? 'var(--accent)' : 'var(--line-strong)')} />
          </ReactFlow>
        </div>
        {sel && (
          <div className="w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel">
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
  const role = roles.find((r) => r.id === d.roleId);
  const cfg = d.config ?? role?.config ?? { agent: 'claude' as const, model: 'sonnet', permission: 'read' as const };
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{role?.icon ?? '⚙️'}</span>
        <input className={cx(inputCls, 'font-semibold')} value={d.label} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <Field label="Vai trò" hint="Chọn vai trò sẽ nạp lại model, quyền và prompt mặc định">
        <select
          className={inputCls}
          value={d.roleId || ''}
          onChange={(e) => {
            const r = roles.find((x) => x.id === e.target.value);
            if (r) onChange({ roleId: r.id, config: { ...r.config }, prompt: r.promptTemplate, verdict: !!r.verdict, label: d.label === role?.name ? r.name : d.label });
          }}
        >
          <option value="">Tuỳ chỉnh</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.icon} {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Agent · Model · Effort · Quyền">
        <div className="rounded-lg border border-line p-1">
          <ConfigPicker value={cfg} onChange={(config) => onChange({ config })} placement="bottom-start" compact />
        </div>
      </Field>
      <Field
        label="Prompt"
        hint={
          <>
            Biến: <code>{'{{task}}'}</code> task gốc · <code>{'{{prev}}'}</code> kết quả bước trước · <code>{'{{Tên bước}}'}</code> kết quả của bước đó. Ngữ cảnh các bước agent khác đã làm được tự gửi kèm.
          </>
        }
      >
        <textarea className={cx(inputCls, 'h-40 resize-y font-mono text-[12px]')} value={d.prompt ?? role?.promptTemplate ?? ''} onChange={(e) => onChange({ prompt: e.target.value })} />
        {d.roleId && (
          <button
            type="button"
            title="Pipeline giữ bản copy prompt lúc tạo; bấm để lấy prompt gốc mới nhất của vai trò này"
            onClick={async () => {
              const defs = await safe(api<{ id: string; promptTemplate: string }[]>('GET', '/roles/defaults'));
              const def = defs?.find((r) => r.id === d.roleId);
              if (!def) return toast('Vai trò này không có prompt gốc (vai trò tự tạo).', 'info');
              onChange({ prompt: def.promptTemplate });
              toast('Đã khôi phục prompt gốc. Nhớ bấm Lưu pipeline.', 'info');
            }}
            className="mt-1 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Khôi phục prompt gốc
          </button>
        )}
      </Field>
      <div className="space-y-2.5">
        <Toggle checked={!!d.approval} onChange={(approval) => onChange({ approval })} label={<span><Pause size={12} className="mr-1 inline text-warn" />Dừng chờ duyệt sau bước này</span>} />
        <Toggle checked={!!d.verdict} onChange={(verdict) => onChange({ verdict })} label={<span><Scale size={12} className="mr-1 inline" />Chấm đạt/chưa đạt (rẽ nhánh pass/fail)</span>} />
      </div>
      <Field label="Số lần chạy tối đa" hint="Chặn vòng lặp fail → làm lại vô hạn">
        <input className={cx(inputCls, 'w-24')} type="number" min={1} max={10} value={d.maxLoops ?? 3} onChange={(e) => onChange({ maxLoops: Number(e.target.value) || 1 })} />
      </Field>
      <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-[13px] text-err hover:underline">
        <Trash2 size={13} /> Xoá bước
      </button>
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
