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
      'Kết quả gồm: mục tiêu, các file cần đổi, từng bước làm, rủi ro, cách kiểm tra.\n\nYêu cầu:\n{{task}}',
  },
  {
    id: 'review',
    name: 'Review',
    icon: '🔍',
    description: 'Soi lỗi, thiếu sót, rủi ro',
    config: { agent: 'codex', model: 'gpt-6-sol', effort: 'xhigh', permission: 'read' },
    promptTemplate:
      'Review kết quả của bước trước (xem ngữ cảnh phía trên) cho yêu cầu: {{task}}\n' +
      'Kiểm tra với code thực tế. Liệt kê cụ thể lỗi, chỗ thiếu, rủi ro và cách sửa. Không sửa file.',
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
    { id: 'task', type: 'task', position: { x: 0, y: 20 }, data: { label: 'Task' } },
    node('plan', 230, 0, 'plan'),
    node('review', 520, 0, 'review'),
    node('code', 230, 230, 'code'),
    node('test', 520, 230, 'test', { approval: false }),
    { id: 'end', type: 'end', position: { x: 820, y: 260 }, data: { label: 'Done' } },
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

export function getPipelines(): Pipeline[] {
  return readJson<Pipeline[]>(PIPELINES_FILE, [DEFAULT_PIPELINE]);
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
