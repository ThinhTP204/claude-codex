import type { Conversation, PNode, Pipeline, PipelineRun, RunConfig, Turn } from '../shared/types.ts';
import { executeTurn, finalText, isRunning, publish, saveConv, stopConv } from './conversations.ts';
import { getRoles } from './roles.ts';
import { uid } from './store.ts';
import { reviewSections } from '../shared/verdict.ts';

// Appended at run time, so it also applies to pipelines saved before these rules existed.
const VERDICT_INSTRUCTION =
  '\n\n---\nCách chấm (quan trọng, tránh làm lại vô ích):\n' +
  '- `VERDICT: FAIL` CHỈ khi có vấn đề chặn: sai logic/yêu cầu, thiếu bước bắt buộc, lỗi bảo mật hoặc mất dữ liệu, hoặc chắc chắn không chạy được.\n' +
  '- Góp ý nhỏ, cải tiến thêm, cách viết khác, rủi ro thấp: vẫn `VERDICT: PASS`, ghi vào mục `Lưu ý:`.\n' +
  '- Nếu kết luận phụ thuộc vào một quyết định nghiệp vụ mà chỉ người dùng trả lời được (bước trước không thể tự chốt): `VERDICT: ASK`, ' +
  'và ngay trước đó viết mục `Câu hỏi:` (tối đa 3 câu, mỗi câu kèm phương án đề xuất).\n' +
  '- Nếu FAIL: ngay trước dòng VERDICT, viết mục `Cần sửa:` liệt kê ngắn gọn (tối đa 5 ý) những gì bước trước phải làm lại. ' +
  'Lỗi từ lệnh (build/test/lint): ghi kèm đúng lệnh đã chạy, file:dòng và vài dòng lỗi gốc, để bước sau tái hiện và sửa tận gốc.\n' +
  'Dòng CUỐI CÙNG phải là đúng một trong: `VERDICT: PASS`, `VERDICT: FAIL`, `VERDICT: ASK`.';

/**
 * A step running again because a checking step failed it (Test → Code): say so explicitly, with the
 * failures up front. Otherwise the agent gets its original "implement X" prompt and patches loosely.
 */
export function retryFeedback(run: PipelineRun, node: PNode, cfg: RunConfig): string {
  const from = run.prevNode && run.prevNode !== node.id ? nodeOf(run, run.prevNode) : undefined;
  const fst = from && run.nodes[from.id];
  if (!from?.data.verdict || fst?.verdict !== 'fail' || !fst.output) return '';
  const sections = reviewSections(fst.output).filter((x) => x.title === 'Cần sửa' || x.title === 'Câu hỏi');
  const body = sections.length
    ? sections.map((x) => `${x.title}:\n${x.body}`).join('\n\n')
    : fst.output.length > 8000
      ? '…' + fst.output.slice(-8000)
      : fst.output;
  const canRun = cfg.permission === 'exec' || cfg.permission === 'full';
  return (
    `\n\n---\nLẦN CHẠY LẠI: bước "${from.data.label}" vừa chấm CHƯA ĐẠT. Nhiệm vụ lần này là sửa triệt để các vấn đề dưới đây, không làm lại từ đầu ` +
    `(nhận xét đầy đủ của "${from.data.label}" nằm trong ngữ cảnh phía trên).\n\n<feedback from="${from.data.label}">\n${body}\n</feedback>\n\n` +
    'Yêu cầu:\n' +
    '- Xử lý từng ý tận gốc (tìm nguyên nhân, không vá bề mặt). Với code: không che lỗi — không tắt/xoá test, không bỏ qua lint/type (any, @ts-ignore, eslint-disable), không nuốt exception.\n' +
    '- Sửa luôn những chỗ cùng loại vấn đề liên quan, không chỉ đúng dòng được nêu.\n' +
    (canRun
      ? '- Chạy lại đúng lệnh build/test đã lỗi để xác nhận đã hết lỗi trước khi kết thúc.\n'
      : '- Bạn không chạy được lệnh: đọc kỹ log/nhận xét và code liên quan, suy luận cẩn thận trước khi sửa.\n') +
    '- Cuối câu trả lời liệt kê: từng ý → nguyên nhân → đã xử lý thế nào (file:dòng nếu có).'
  );
}

/** The "Cần sửa / Câu hỏi" part of a checker's answer. */
function demandsOf(output: string): string {
  return reviewSections(output)
    .filter((x) => x.title === 'Cần sửa' || x.title === 'Câu hỏi')
    .map((x) => `${x.title}:\n${x.body}`)
    .join('\n\n');
}

/**
 * A checker running again after the previous step fixed things: verify the earlier demands instead of
 * re-reviewing from scratch, which tends to surface new nitpicks and loop forever.
 */
function recheckInstruction(demands: string): string {
  return (
    '\n\n---\nĐÂY LÀ LẦN CHẤM LẠI. Lần trước bạn yêu cầu:\n<previous-demands>\n' +
    demands +
    '\n</previous-demands>\n\n' +
    'Chỉ kiểm tra: (1) từng ý trên đã được xử lý đúng chưa — ghi rõ ý nào ĐÃ XỬ LÝ / CHƯA; ' +
    '(2) lần sửa này có gây ra lỗi chặn mới không. Không soi lại từ đầu; góp ý mới không chặn thì ghi vào `Lưu ý:` và vẫn PASS. ' +
    '`VERDICT: FAIL` chỉ khi còn ý cũ chưa xử lý hoặc có lỗi chặn mới.'
  );
}

export function parseVerdict(text: string): 'pass' | 'fail' | 'ask' | undefined {
  const all = [...text.matchAll(/VERDICT\s*[:：]\s*\**\s*(PASS|FAIL|ASK)/gi)];
  const last = all[all.length - 1];
  return last ? (last[1].toLowerCase() as 'pass' | 'fail' | 'ask') : undefined;
}

const nodeOf = (run: PipelineRun, id: string) => run.pipeline.nodes.find((n) => n.id === id);

function targets(run: PipelineRun, fromId: string): string[] {
  const node = nodeOf(run, fromId);
  const st = run.nodes[fromId];
  return run.pipeline.edges
    .filter((e) => e.source === fromId)
    .filter((e) => (node?.data.verdict ? e.sourceHandle === (st?.verdict ?? 'pass') : true))
    .map((e) => e.target);
}

function render(run: PipelineRun, template: string): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.toLowerCase();
    if (k === 'task') return run.task;
    if (k === 'prev') return (run.prevNode && run.nodes[run.prevNode]?.output) || '';
    const n = run.pipeline.nodes.find((n) => n.data.label.toLowerCase() === k || n.id === key);
    return (n && run.nodes[n.id]?.output) || '';
  });
}

export function nodeConfig(node: PNode): { cfg: RunConfig; template: string; roleName: string; roleIcon?: string } {
  const role = getRoles().find((r) => r.id === node.data.roleId);
  return {
    cfg: node.data.config ?? role?.config ?? { agent: 'claude', model: 'sonnet', permission: 'read' },
    template: node.data.prompt ?? role?.promptTemplate ?? '{{task}}',
    roleName: role?.name ?? node.data.label,
    roleIcon: role?.icon,
  };
}

function addNote(c: Conversation, text: string, node?: PNode) {
  const t: Turn = { id: uid('t_'), role: 'user', createdAt: Date.now(), text, nodeId: node?.id, nodeLabel: node?.data.label, blocks: [], status: 'done' };
  c.turns.push(t);
}

async function execNode(c: Conversation, run: PipelineRun, node: PNode): Promise<void> {
  const st = run.nodes[node.id];
  const max = node.data.maxLoops ?? 3;
  if (st.runs >= max) {
    st.status = 'error';
    st.error = `Bước "${node.data.label}" đã chạy ${st.runs}/${max} lần, dừng để tránh lặp vô hạn.`;
    run.status = 'error';
    run.current = node.id;
    return;
  }
  st.runs++;
  // what this checker demanded last round (Review/Test running again after a fix)
  const lastDemands = node.data.verdict && st.runs > 1 && st.output ? demandsOf(st.output) : '';
  st.status = 'running';
  st.error = undefined;
  st.verdict = undefined;
  st.verdictMissing = undefined;
  st.needsInput = undefined;
  run.current = node.id;
  publish(c);

  const { cfg, template, roleName, roleIcon } = nodeConfig(node);
  let prompt = render(run, template);
  prompt += retryFeedback(run, node, cfg);
  if (lastDemands) prompt += recheckInstruction(lastDemands);
  if (node.data.verdict) prompt += VERDICT_INSTRUCTION;

  const { turn, result } = await executeTurn(c, { prompt, config: cfg, roleName, roleIcon, nodeId: node.id, nodeLabel: node.data.label });
  st.turnId = turn.id;
  st.usage = result.usage;
  st.durationMs = result.durationMs;
  if (result.stopped) {
    st.status = 'stopped';
    run.status = 'stopped';
    return;
  }
  if (!result.ok) {
    st.status = 'error';
    st.error = result.error;
    run.status = 'error';
    return;
  }
  st.output = finalText(turn) || result.finalText;
  run.prevNode = node.id;
  if (node.data.verdict) {
    const v = parseVerdict(st.output);
    // ASK: the reviewer needs a business decision; looping back would just fail again
    if (v === 'ask') st.needsInput = true;
    else if (v) st.verdict = v;
    else st.verdictMissing = true;
  }
  if (node.data.approval || st.verdictMissing || st.needsInput) {
    st.status = 'awaiting';
    run.status = 'awaiting';
  } else {
    st.status = 'done';
  }
}

async function pump(c: Conversation): Promise<void> {
  const run = c.run!;
  try {
    while (run.status === 'running') {
      const next = run.queue.shift();
      if (!next) {
        run.status = 'done';
        run.current = undefined;
        break;
      }
      const node = nodeOf(run, next);
      if (!node) continue;
      if (node.type !== 'agent') {
        run.nodes[next] = { ...run.nodes[next], status: 'done' };
        run.queue.push(...targets(run, next));
        continue;
      }
      await execNode(c, run, node);
      if (run.status === 'running') run.queue.push(...targets(run, next));
    }
  } catch (e) {
    run.status = 'error';
    const cur = run.current && run.nodes[run.current];
    if (cur) {
      cur.status = 'error';
      cur.error = String((e as Error).message || e);
    }
  }
  if (run.status === 'done' || run.status === 'stopped') run.endedAt = Date.now();
  saveConv(c, true);
  publish(c);
}

export function startPipeline(c: Conversation, pipeline: Pipeline, task: string): void {
  if (isRunning(c.id) || c.run?.status === 'running') throw new Error('Đang có tác vụ chạy trong cuộc trò chuyện này.');
  if (!task.trim()) throw new Error('Chưa nhập task.');
  const start = pipeline.nodes.find((n) => n.type === 'task');
  if (!start) throw new Error('Pipeline cần một node Task để bắt đầu.');
  const run: PipelineRun = {
    id: uid('r_'),
    pipeline: structuredClone(pipeline),
    task,
    status: 'running',
    queue: [start.id],
    nodes: Object.fromEntries(pipeline.nodes.map((n) => [n.id, { status: 'idle' as const, runs: 0 }])),
    startedAt: Date.now(),
  };
  run.nodes[start.id].output = task;
  c.run = run;
  addNote(c, `▶️ Chạy pipeline **${pipeline.name}**\n\n${task}`);
  saveConv(c, true);
  void pump(c);
}

export function approve(c: Conversation, opts: { output?: string; verdict?: 'pass' | 'fail'; note?: string }): void {
  const run = c.run;
  if (!run || run.status !== 'awaiting' || !run.current) throw new Error('Không có bước nào đang chờ duyệt.');
  const node = nodeOf(run, run.current)!;
  const st = run.nodes[run.current];
  if (opts.output !== undefined && opts.output !== st.output) {
    st.output = opts.output;
    addNote(c, `✏️ Người dùng đã chỉnh sửa kết quả của bước "${node.data.label}". Dùng bản này thay cho bản gốc:\n\n${opts.output}`, node);
  }
  if (opts.note?.trim()) addNote(c, `💬 Ghi chú của người dùng sau bước "${node.data.label}":\n${opts.note}`, node);
  if (opts.verdict) st.verdict = opts.verdict;
  if (node.data.verdict && !st.verdict) st.verdict = 'pass';
  st.status = 'done';
  st.verdictMissing = undefined;
  st.needsInput = undefined;
  run.status = 'running';
  run.queue.push(...targets(run, node.id));
  void pump(c);
}

export function rerun(c: Conversation, opts: { config?: RunConfig; note?: string; nodeId?: string }): void {
  const run = c.run;
  if (!run || run.status === 'running' || run.status === 'done') throw new Error('Không có bước nào để chạy lại.');
  const id = opts.nodeId ?? run.current;
  const node = id && nodeOf(run, id);
  if (!node) throw new Error('Không tìm thấy bước để chạy lại.');
  if (opts.config) node.data.config = opts.config;
  if (opts.note?.trim()) addNote(c, `💬 Góp ý của người dùng cho lần chạy lại bước "${node.data.label}":\n${opts.note}`, node);
  const st = run.nodes[node.id];
  st.runs = Math.max(0, st.runs - 1);
  run.status = 'running';
  run.endedAt = undefined;
  run.queue = [node.id];
  void pump(c);
}

export function stopPipeline(c: Conversation): void {
  const run = c.run;
  if (!run) return;
  if (isRunning(c.id)) {
    stopConv(c.id); // execNode sees `stopped` and ends the loop
    return;
  }
  if (run.status === 'awaiting' || run.status === 'error') {
    run.status = 'stopped';
    run.endedAt = Date.now();
    saveConv(c, true);
    publish(c);
  }
}
