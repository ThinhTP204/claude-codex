import type { Pipeline, Role } from '../shared/types.ts';
import { dataFile, readJson, writeJson } from './store.ts';

export const DEFAULT_ROLES: Role[] = [
  {
    id: 'plan',
    name: 'Plan',
    icon: '🧭',
    description: 'Lập kế hoạch, không sửa code',
    config: { agent: 'claude', model: 'opus', effort: 'high', permission: 'read' },
    promptTemplate:
      'Lập kế hoạch triển khai chi tiết cho yêu cầu dưới đây. Đọc code liên quan trước. KHÔNG sửa file nào.\n' +
      'Kết quả gồm: mục tiêu, các file cần đổi, từng bước làm, rủi ro, cách kiểm tra.\n' +
      'Chỗ nào yêu cầu chưa rõ: tự chọn phương án hợp lý nhất và ghi rõ trong mục `Giả định:`, đừng để câu hỏi bỏ ngỏ.\n\nYêu cầu:\n{{task}}',
  },
  {
    id: 'review',
    name: 'Review',
    icon: '🔍',
    description: 'Soi lỗi, thiếu sót, rủi ro',
    config: { agent: 'codex', model: 'gpt-6-sol', effort: 'xhigh', permission: 'read' },
    promptTemplate:
      'Review kết quả của bước trước (xem ngữ cảnh phía trên) cho yêu cầu: {{task}}\n' +
      'Kiểm tra với code thực tế. Tập trung vào vấn đề chặn (sai logic, thiếu bước, bảo mật); góp ý nhỏ ghi ngắn gọn. Không sửa file.',
    verdict: true,
  },
  {
    id: 'code',
    name: 'Code',
    icon: '🛠',
    description: 'Viết code theo plan',
    config: { agent: 'claude', model: 'sonnet', effort: 'medium', permission: 'write' },
    promptTemplate:
      'Triển khai yêu cầu sau theo plan đã thống nhất và các góp ý review trong ngữ cảnh phía trên.\n\nYêu cầu:\n{{task}}\n\n' +
      'Khi xong, tóm tắt những file đã đổi.',
  },
  {
    id: 'test',
    name: 'Test',
    icon: '🧪',
    description: 'Chạy build/test, kiểm tra kết quả',
    config: { agent: 'codex', model: 'gpt-6-luna', effort: 'medium', permission: 'exec' },
    promptTemplate:
      'Kiểm tra phần code vừa được triển khai cho yêu cầu: {{task}}\n' +
      'Chạy build/lint/test phù hợp với project. Báo lỗi cụ thể nếu có, không tự sửa code.',
    verdict: true,
  },
  {
    id: 'debug',
    name: 'Debug',
    icon: '🐞',
    description: 'Tìm nguyên nhân và sửa lỗi',
    config: { agent: 'claude', model: 'opus', effort: 'high', permission: 'write' },
    promptTemplate: 'Tìm nguyên nhân gốc và sửa lỗi sau:\n{{task}}\n\nGiải thích nguyên nhân và cách sửa.',
  },
  {
    id: 'ask',
    name: 'Ask',
    icon: '💬',
    description: 'Hỏi nhanh, chỉ đọc',
    config: { agent: 'claude', model: 'haiku', effort: 'low', permission: 'read' },
    promptTemplate: '{{task}}',
  },
];

const ROLES_FILE = dataFile('roles.json');
const PIPELINES_FILE = dataFile('pipelines.json');

export function getRoles(): Role[] {
  return readJson<Role[]>(ROLES_FILE, DEFAULT_ROLES);
}

export function saveRoles(roles: Role[]): void {
  writeJson(ROLES_FILE, roles);
}

function node(id: string, x: number, y: number, roleId: string, extra: Partial<Pipeline['nodes'][0]['data']> = {}) {
  const r = DEFAULT_ROLES.find((r) => r.id === roleId)!;
  return {
    id,
    type: 'agent' as const,
    position: { x, y },
    data: { label: r.name, roleId, config: { ...r.config }, prompt: r.promptTemplate, approval: true, verdict: !!r.verdict, maxLoops: 3, ...extra },
  };
}

export const DEFAULT_PIPELINE: Pipeline = {
  id: 'plan-review-code',
  name: 'Plan → Review → Code → Test',
  nodes: [
    // one row in run order; fail links loop back over the top (see ui flowLayout.tsx)
    { id: 'task', type: 'task', position: { x: 0, y: 30 }, data: { label: 'Task' } },
    node('plan', 320, 0, 'plan'),
    node('review', 640, 0, 'review'),
    node('code', 960, 0, 'code'),
    node('test', 1280, 0, 'test', { approval: false }),
    { id: 'end', type: 'end', position: { x: 1600, y: 30 }, data: { label: 'Done' } },
  ],
  edges: [
    { id: 'e1', source: 'task', target: 'plan', sourceHandle: 'out' },
    { id: 'e2', source: 'plan', target: 'review', sourceHandle: 'out' },
    { id: 'e3', source: 'review', target: 'code', sourceHandle: 'pass' },
    { id: 'e4', source: 'review', target: 'plan', sourceHandle: 'fail' },
    { id: 'e5', source: 'code', target: 'test', sourceHandle: 'out' },
    { id: 'e6', source: 'test', target: 'end', sourceHandle: 'pass' },
    { id: 'e7', source: 'test', target: 'code', sourceHandle: 'fail' },
  ],
};

/**
 * The standard pipeline: each step is a stage with a contract (shared/stages.ts). No model is fixed
 * on the nodes, so they follow the roles (change a role's model once, every pipeline uses it).
 */
const stageNode = (id: string, x: number, roleId: string, stage: Pipeline['nodes'][0]['data']['stage'], label: string, extra: Partial<Pipeline['nodes'][0]['data']> = {}) => ({
  id,
  type: 'agent' as const,
  position: { x, y: 0 },
  // every step waits for the user (human in the loop), passed or not
  data: { label, roleId, stage, verdict: stage === 'review-plan' || stage === 'test' || stage === 'review-code', approval: true, maxLoops: 3, ...extra },
});

export const STANDARD_PIPELINE: Pipeline = {
  id: 'standard',
  name: 'Pipeline chuẩn (Plan → Review → Code → Test → Review code)',
  nodes: [
    { id: 'task', type: 'task', position: { x: 0, y: 80 }, data: { label: 'Task' } },
    stageNode('plan', 320, 'plan', 'plan', 'Plan'),
    stageNode('review-plan', 1300, 'review', 'review-plan', 'Review plan'),
    stageNode('code', 2280, 'code', 'code', 'Code'),
    stageNode('test', 3260, 'test', 'test', 'Test'),
    stageNode('review-code', 4240, 'review', 'review-code', 'Review code'),
    { id: 'end', type: 'end', position: { x: 5220, y: 95 }, data: { label: 'Done' } },
  ],
  edges: [
    { id: 's1', source: 'task', target: 'plan', sourceHandle: 'out' },
    { id: 's2', source: 'plan', target: 'review-plan', sourceHandle: 'out' },
    { id: 's3', source: 'review-plan', target: 'code', sourceHandle: 'pass' },
    { id: 's4', source: 'review-plan', target: 'plan', sourceHandle: 'fail' },
    { id: 's5', source: 'code', target: 'test', sourceHandle: 'out' },
    { id: 's6', source: 'test', target: 'review-code', sourceHandle: 'pass' },
    { id: 's7', source: 'test', target: 'code', sourceHandle: 'fail' },
    { id: 's8', source: 'review-code', target: 'end', sourceHandle: 'pass' },
    { id: 's9', source: 'review-code', target: 'code', sourceHandle: 'fail' },
  ],
};

// templates added to existing pipeline lists once (deleting one keeps it deleted)
const SEEDED_FILE = dataFile('pipelines-seeded.json');

export function getPipelines(): Pipeline[] {
  const list = readJson<Pipeline[] | null>(PIPELINES_FILE, null) ?? [STANDARD_PIPELINE];
  const seeded = readJson<string[]>(SEEDED_FILE, []);
  let changed = false;
  if (!seeded.includes(STANDARD_PIPELINE.id)) {
    if (!list.some((p) => p.id === STANDARD_PIPELINE.id)) list.unshift(STANDARD_PIPELINE);
    seeded.push(STANDARD_PIPELINE.id);
    changed = true;
  }
  // the old built-in "Plan → Review → Code → Test" is replaced by the standard pipeline
  if (!seeded.includes('drop:' + DEFAULT_PIPELINE.id)) {
    const i = list.findIndex((p) => p.id === DEFAULT_PIPELINE.id);
    if (i >= 0) list.splice(i, 1);
    seeded.push('drop:' + DEFAULT_PIPELINE.id);
    changed = true;
  }
  // the standard pipeline's layout changed (items and their points between steps): re-place its saved copy once
  if (!seeded.includes('layout6:' + STANDARD_PIPELINE.id)) {
    const std = list.find((p) => p.id === STANDARD_PIPELINE.id);
    for (const n of std?.nodes ?? []) {
      const fresh = STANDARD_PIPELINE.nodes.find((x) => x.id === n.id);
      if (fresh) n.position = { ...fresh.position };
    }
    seeded.push('layout6:' + STANDARD_PIPELINE.id);
    changed = true;
  }
  // human in the loop: every step of the saved standard pipeline waits for the user (once)
  if (!seeded.includes('hitl:' + STANDARD_PIPELINE.id)) {
    for (const n of list.find((p) => p.id === STANDARD_PIPELINE.id)?.nodes ?? []) if (n.type === 'agent') n.data.approval = true;
    seeded.push('hitl:' + STANDARD_PIPELINE.id);
    changed = true;
  }
  if (changed) {
    writeJson(PIPELINES_FILE, list);
    writeJson(SEEDED_FILE, seeded);
  }
  return list;
}

export function savePipeline(p: Pipeline): Pipeline[] {
  const list = getPipelines().filter((x) => x.id !== p.id);
  list.push(p);
  writeJson(PIPELINES_FILE, list);
  return list;
}

export function deletePipeline(id: string): Pipeline[] {
  const list = getPipelines().filter((x) => x.id !== id);
  writeJson(PIPELINES_FILE, list);
  return list;
}
