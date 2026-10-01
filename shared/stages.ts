// The standard pipeline stages: what each step receives, must produce and when it counts as done,
// plus the test catalogue the Test step picks from. Shared by the server (prompts) and the UI (Flow).
// Erasable-only TypeScript (Node runs it with type stripping).

export type StageKind = 'plan' | 'review-plan' | 'code' | 'test' | 'review-code';

export type TestKind =
  | 'static'
  | 'build'
  | 'smoke'
  | 'unit'
  | 'integration'
  | 'api'
  | 'e2e'
  | 'ui'
  | 'regression'
  | 'data'
  | 'security'
  | 'perf'
  | 'a11y'
  | 'platform'
  | 'deps';

/** auto = run when the change matches `when`; always; skip */
export type TestMode = 'auto' | 'always' | 'skip';

export interface TestDef {
  id: TestKind;
  name: string;
  /** what it checks */
  checks: string;
  /** typical way to run it */
  how: string;
  /** which changes call for it (empty = every code change) */
  when: string;
}

export const TESTS: TestDef[] = [
  { id: 'static', name: 'Lint và typecheck', checks: 'lỗi kiểu, cú pháp, quy ước code', how: 'typecheck (tsc, mypy…), lint (eslint, ruff…)', when: '' },
  { id: 'build', name: 'Build', checks: 'project build được', how: 'lệnh build của project', when: '' },
  { id: 'smoke', name: 'Mở thử app (smoke)', checks: 'app khởi động, trang chính hoặc /health mở được', how: 'chạy app/dev server rồi gọi thử', when: 'đổi giao diện, cấu hình, biến môi trường, cách khởi động' },
  { id: 'unit', name: 'Unit', checks: 'từng hàm/logic và trường hợp biên (rỗng, null, quá lớn, sai định dạng)', how: 'vitest, jest, pytest, go test…', when: 'đổi logic, hàm tính toán, xử lý dữ liệu' },
  { id: 'integration', name: 'Tích hợp', checks: 'các phần nói chuyện với nhau: service ↔ DB, module ↔ module', how: 'test với DB/dịch vụ thật hoặc bản test', when: 'đổi backend, tầng dữ liệu, cách các module gọi nhau' },
  { id: 'api', name: 'API / hợp đồng', checks: 'request, response, mã lỗi, validate input, phân quyền của endpoint', how: 'gọi thật endpoint, so với schema/kiểu', when: 'đổi API, route, handler, schema request/response' },
  { id: 'e2e', name: 'Luồng người dùng (E2E)', checks: 'cả luồng từ đầu tới cuối (đăng nhập, tạo, thanh toán…)', how: 'Playwright, Cypress', when: 'đổi một luồng người dùng' },
  { id: 'ui', name: 'Giao diện', checks: 'bố cục, chữ, trạng thái trống/lỗi; desktop và mobile; sáng và tối', how: 'mở trang, chụp màn hình từng kích thước', when: 'đổi giao diện, CSS, component' },
  { id: 'regression', name: 'Hồi quy (test cũ)', checks: 'phần cũ không bị hỏng', how: 'chạy lại bộ test có sẵn', when: '' },
  { id: 'data', name: 'Dữ liệu / migration', checks: 'migration chạy lên và lùi lại được, dữ liệu cũ không hỏng', how: 'chạy migrate trên bản sao DB', when: 'đổi schema DB, migration, cách lưu dữ liệu' },
  { id: 'security', name: 'Bảo mật', checks: 'quyền truy cập, input độc hại, lộ secret', how: 'gọi bằng user không có quyền, gửi input lạ, soát secret trong diff', when: 'đổi đăng nhập, phân quyền, xử lý input người dùng, upload' },
  { id: 'perf', name: 'Hiệu năng', checks: 'không chậm đi, không N+1 query, không rò bộ nhớ', how: 'đo trước/sau, đếm query', when: 'đổi query, vòng lặp trên dữ liệu lớn, đường xử lý nóng; hoặc AC có yêu cầu tốc độ' },
  { id: 'a11y', name: 'Trợ năng (a11y)', checks: 'dùng được bằng bàn phím, có label, đủ tương phản', how: 'axe, thử Tab qua form', when: 'đổi form, nút, component tương tác' },
  { id: 'platform', name: 'Đa nền tảng', checks: 'chạy đúng trên Windows / macOS / Linux', how: 'CI theo hệ điều hành, soát đường dẫn và lệnh shell', when: 'đổi code riêng theo hệ điều hành, đường dẫn file, lệnh shell' },
  { id: 'deps', name: 'Thư viện (dependency)', checks: 'cài sạch, build, cảnh báo bảo mật', how: 'npm ci / pip install, npm audit', when: 'đổi package.json, lockfile, requirements' },
];

export interface StageDef {
  name: string;
  icon: string;
  /** one line: what the step does */
  does: string;
  /** accent colour of its card */
  color: string;
  /** what the step gets */
  input: string;
  /** what it must write */
  output: string;
  /** when it counts as done */
  done: string;
  /** checking steps end with VERDICT and branch pass/fail */
  verdict: boolean;
  /** role used when a step of this kind is added */
  roleId: string;
}

export const STAGES: Record<StageKind, StageDef> = {
  plan: {
    name: 'Plan',
    icon: '🧭',
    does: 'Đọc code, chốt phạm vi, tiêu chí đạt và cách test',
    color: '#3b82f6',
    input: 'Task bạn nhập',
    output: 'Kế hoạch có tiêu chí đạt (AC1, AC2…), các bước làm và cách test',
    done: 'Có đủ các mục và mọi AC đều kiểm tra được',
    verdict: false,
    roleId: 'plan',
  },
  'review-plan': {
    name: 'Review plan',
    icon: '🔍',
    does: 'Kiểm tra plan có đúng yêu cầu và làm được với code hiện có',
    color: '#8b5cf6',
    input: 'Plan của bước trước',
    output: 'Nhận xét chia 3 mức: Chặn, Nên sửa, Gợi ý',
    done: 'Không còn lỗi mức Chặn',
    verdict: true,
    roleId: 'review',
  },
  code: {
    name: 'Code',
    icon: '🛠',
    does: 'Viết code và test theo plan, tự chạy thử trước khi giao',
    color: '#f97316',
    input: 'Plan, tiêu chí đạt và góp ý của bước kiểm tra',
    output: 'Code đã sửa, test mới, và AC nào làm ở file nào',
    done: 'Code qua typecheck, lint và build',
    verdict: false,
    roleId: 'code',
  },
  test: {
    name: 'Test',
    icon: '🧪',
    does: 'Chạy những loại test hợp với phần code vừa đổi',
    color: '#16a34a',
    input: 'Phần code vừa đổi, cách test trong plan và tiêu chí đạt',
    output: 'Kết quả từng loại test kèm log, và AC nào đạt, AC nào chưa',
    done: 'Không có lỗi mới do lần sửa này gây ra',
    verdict: true,
    roleId: 'test',
  },
  'review-code': {
    name: 'Review code',
    icon: '🔎',
    does: 'Đọc phần code vừa đổi và đối chiếu với từng AC',
    color: '#0d9488',
    input: 'Phần code vừa đổi và tiêu chí đạt',
    output: 'AC nào đạt, AC nào chưa, kèm nhận xét theo 3 mức',
    done: 'Mọi AC đều đạt và không còn lỗi mức Chặn',
    verdict: true,
    roleId: 'review',
  },
};

export const STAGE_KINDS = Object.keys(STAGES) as StageKind[];

/** Criteria the Plan wrote, with what later steps said about them. */
export interface AcceptanceCriterion {
  id: string;
  text: string;
  status?: 'pass' | 'fail';
  /** step that last judged it */
  by?: string;
}

/** "AC1: …" lines of a plan. */
export function parseCriteria(text: string): AcceptanceCriterion[] {
  const out: AcceptanceCriterion[] = [];
  for (const line of text.split('\n')) {
    let id: string | undefined;
    let body: string | undefined;
    // "| **AC1** | Bấm X thì Y | cách kiểm |": the cell after the id
    const row = /^\s*\|\s*\**\s*AC\s*(\d+)\s*\**\s*\|\s*([^|]+)\|/i.exec(line);
    const plain = /^\s*(?:[-*+]|\d+[.)])?\s*\**\s*AC\s*(\d+)\s*\**\s*[:.)\-–—]\s*\**\s*(.+)$/i.exec(line);
    if (row) [id, body] = [row[1], row[2]];
    else if (plain) [id, body] = [plain[1], plain[2]];
    if (id && body && !out.some((x) => x.id === `AC${id}`)) out.push({ id: `AC${id}`, text: body.replace(/\*\*/g, '').trim() });
  }
  return out;
}

/** "AC2: CHƯA ĐẠT — …", "| AC1 | ✓ |" lines of a review/test report → status per criterion. */
export function parseCriteriaStatus(text: string): Record<string, 'pass' | 'fail'> {
  const out: Record<string, 'pass' | 'fail'> = {};
  for (const line of text.split('\n')) {
    const m = /\bAC\s*(\d+)\b(.*)$/i.exec(line);
    if (!m) continue;
    const rest = m[2];
    // \b is ASCII-only in JS: Vietnamese words need Unicode-aware edges
    if (/chưa\s*đạt|không\s*đạt|(?<!\p{L})fail(?!\p{L})|❌|✗|✘/iu.test(rest)) out[`AC${m[1]}`] = 'fail';
    else if (/(?<!\p{L})(đạt|pass)(?!\p{L})|✅|✓|✔/iu.test(rest)) out[`AC${m[1]}`] = 'pass';
  }
  return out;
}

/** "Cỡ task: Vừa" in a plan. */
export function parseSize(text: string): 'Nhỏ' | 'Vừa' | 'Lớn' | undefined {
  const m = /cỡ\s*task\s*\**\s*[:：]\s*\**\s*(nhỏ|vừa|lớn)/i.exec(text);
  if (!m) return;
  const s = m[1].toLowerCase();
  return s === 'nhỏ' ? 'Nhỏ' : s === 'vừa' ? 'Vừa' : 'Lớn';
}

// ---- checklists: the items each step is made of (a tree under the step on the Flow) ----

export interface ChecklistItem {
  /** short code the agent reports against, e.g. "P3" */
  id: string;
  text: string;
  /** what "done" means for this item (sent to the agent, shown on hover) */
  hint?: string;
  /** what the item is made of: the points the agent writes under it, sub-cards on the flow */
  parts?: string[];
  /** this item opens into the plan's acceptance criteria */
  ac?: boolean;
}

/**
 * Default items, after common practice: Plan follows a technical design doc / RFC (with acceptance
 * criteria as Given/When/Then), Review plan a design-review checklist, Code a Definition of Done,
 * Review code Google's code review guidelines. Test items are the enabled test kinds (Test tab).
 */
export const CHECKLISTS: Record<Exclude<StageKind, 'test'>, ChecklistItem[]> = {
  plan: [
    { id: 'P1', text: 'Mục tiêu và phạm vi', hint: 'làm gì và KHÔNG làm gì', parts: ['Mục tiêu', 'Sẽ làm', 'Không làm'] },
    { id: 'P2', text: 'Hiện trạng code liên quan', hint: 'file, module, luồng sẽ bị ảnh hưởng', parts: ['File, module liên quan', 'Hiện đang chạy thế nào', 'Phần sẽ bị ảnh hưởng'] },
    { id: 'P3', text: 'Giả định và câu hỏi mở', hint: 'chỗ yêu cầu chưa rõ đã tự chốt thế nào', parts: ['Điều đã tự quyết', 'Điều còn chưa rõ'] },
    { id: 'P4', text: 'Tiêu chí đạt (AC)', hint: 'mỗi AC dạng Cho / Khi / Thì, kiểm chứng được', parts: ['Mỗi tiêu chí một dòng (AC1, AC2…)'], ac: true },
    { id: 'P5', text: 'Thiết kế giải pháp', hint: 'thay đổi dữ liệu, API, giao diện, lý do chọn cách này', parts: ['Dữ liệu', 'API', 'Giao diện', 'Lý do chọn cách này'] },
    { id: 'P6', text: 'Các bước làm', hint: 'chia nhỏ theo thứ tự, ghi file sẽ đổi', parts: ['Thứ tự các bước', 'File đổi ở từng bước'] },
    { id: 'P7', text: 'Cách test từng AC', hint: 'loại test nào, test có sẵn hay viết mới', parts: ['Tiêu chí nào kiểm bằng test nào', 'Test có sẵn hay phải viết'] },
    { id: 'P8', text: 'Rủi ro và cách lùi lại', hint: 'tương thích ngược, dữ liệu cũ, cách rollback', parts: ['Có thể hỏng gì', 'Cách quay lại bản cũ'] },
  ],
  'review-plan': [
    { id: 'R1', text: 'Đúng và đủ yêu cầu', hint: 'không thiếu ý của task, không làm thừa ngoài phạm vi', parts: ['Ý còn thiếu so với task', 'Phần làm thừa'] },
    { id: 'R2', text: 'AC rõ ràng và kiểm chứng được', hint: 'phủ cả trường hợp biên và lỗi', parts: ['Tiêu chí còn mơ hồ', 'Trường hợp đặc biệt chưa tính'] },
    { id: 'R3', text: 'Làm được với code hiện có', hint: 'file, hàm có thật; hợp kiến trúc đang dùng', parts: ['File, hàm có thật không', 'Có hợp với code hiện tại không'] },
    { id: 'R4', text: 'Ảnh hưởng đã tính tới', hint: 'API, dữ liệu, tương thích ngược, hiệu năng', parts: ['API', 'Dữ liệu', 'Bản cũ còn dùng được không'] },
    { id: 'R5', text: 'Bảo mật và phân quyền', hint: 'input người dùng, quyền truy cập, secret', parts: ['Dữ liệu người dùng nhập', 'Ai được làm gì', 'Mật khẩu, khóa bí mật'] },
    { id: 'R6', text: 'Cách test phủ hết AC', parts: ['Tiêu chí chưa có cách test'] },
    { id: 'R7', text: 'Rủi ro có cách xử lý và lùi lại', parts: ['Rủi ro chưa có cách xử lý'] },
  ],
  code: [
    { id: 'C1', text: 'Làm đủ các bước của plan', hint: 'không làm ngoài phạm vi', parts: ['Bước đã làm', 'Bước bỏ qua, vì sao'] },
    { id: 'C2', text: 'Mỗi AC có code tương ứng', hint: 'ghi AC nào làm ở file:dòng nào', parts: ['Tiêu chí nào sửa ở file:dòng nào'], ac: true },
    { id: 'C3', text: 'Xử lý lỗi và trường hợp biên', parts: ['Lỗi đã xử lý', 'Trường hợp đặc biệt'] },
    { id: 'C4', text: 'Viết hoặc cập nhật test', hint: 'theo cách test trong plan', parts: ['Test đã viết hoặc sửa'] },
    { id: 'C5', text: 'Lint, typecheck, build qua', hint: 'chỉ khi được quyền chạy lệnh; không thì ghi BỎ QUA', parts: ['Lệnh đã chạy', 'Kết quả'] },
    { id: 'C6', text: 'Không để lại code thừa', hint: 'không console.log debug, code chết, secret', parts: ['Đã dọn những gì'] },
  ],
  'review-code': [
    { id: 'K1', text: 'Đáp ứng đúng các AC', parts: ['Tiêu chí nào đạt, tiêu chí nào chưa'], ac: true },
    { id: 'K2', text: 'Logic đúng, có trường hợp biên', parts: ['Chỗ logic sai', 'Trường hợp đặc biệt bị sót'] },
    { id: 'K3', text: 'Xử lý lỗi đầy đủ', hint: 'không nuốt lỗi, thông báo rõ', parts: ['Lỗi bị bỏ qua không báo', 'Thông báo lỗi có rõ không'] },
    { id: 'K4', text: 'Bảo mật', hint: 'validate input, phân quyền, không lộ secret', parts: ['Dữ liệu người dùng nhập', 'Ai được làm gì', 'Mật khẩu, khóa bí mật'] },
    { id: 'K5', text: 'Hiệu năng', hint: 'query thừa, vòng lặp trên dữ liệu lớn', parts: ['Truy vấn thừa', 'Vòng lặp chạy chậm'] },
    { id: 'K6', text: 'Dễ đọc, hợp cách viết sẵn có', hint: 'đặt tên, cấu trúc, không trùng lặp', parts: ['Cách đặt tên', 'Code lặp lại'] },
    { id: 'K7', text: 'Có test cho logic mới', hint: 'test kiểm đúng hành vi, không chỉ cho có', parts: ['Test có kiểm đúng việc cần làm không'] },
    { id: 'K8', text: 'Không đổi ngoài phạm vi', parts: ['Phần đổi ngoài phạm vi'] },
  ],
};

/** warn = passed, with a note (a checker flagged something that did not fail the step) */
export type ItemStatus = 'pass' | 'fail' | 'skip' | 'warn';

/** What each test kind reports under its result line. */
export const TEST_PARTS = ['Có chạy không, vì sao', 'Lệnh đã dùng', 'Kết quả'];
/** What Code writes under each acceptance criterion. */
export const AC_PARTS = ['Sửa ở file:dòng nào', 'Đã làm gì'];

/** The items of a step: the node's own list, or the defaults; Test: the enabled test kinds, plus the AC. */
export function checklistOf(stage: StageKind, d: { checklist?: ChecklistItem[]; tests?: Partial<Record<TestKind, TestMode>> }): ChecklistItem[] {
  if (stage === 'test')
    return [
      ...TESTS.filter((t) => (d.tests?.[t.id] ?? 'auto') !== 'skip').map((t, i) => ({ id: `T${i + 1}`, text: t.name, hint: `${t.checks}. Chạy khi: ${t.when || 'mọi thay đổi code'}`, parts: TEST_PARTS })),
      { id: `T${TESTS.length + 1}`, text: 'Từng AC đạt', ac: true },
    ];
  return d.checklist?.length ? withDefaultParts(stage, d.checklist) : CHECKLISTS[stage];
}

/** Lists saved before items had parts: an unchanged default item gets its default parts. */
function withDefaultParts(stage: Exclude<StageKind, 'test'>, list: ChecklistItem[]): ChecklistItem[] {
  return list.map((i) => (i.parts ? i : { ...i, parts: CHECKLISTS[stage].find((x) => x.id === i.id && x.text === i.text)?.parts }));
}

/** "P3: CHƯA ĐẠT — thiếu …" lines → status and note per item code. */
export function parseItems(text: string, ids: string[]): Record<string, { status: ItemStatus; note?: string }> {
  const out: Record<string, { status: ItemStatus; note?: string }> = {};
  const want = new Set(ids.map((x) => x.toUpperCase()));
  for (const line of text.split('\n')) {
    const m = /^[\s>*_|`-]*\**\s*([A-Z]{1,2}\d{1,2})\s*\**\s*[:.)|\-–—]\s*(.*)$/i.exec(line);
    if (!m || !want.has(m[1].toUpperCase())) continue;
    const rest = m[2].replace(/\*\*/g, '');
    let status: ItemStatus | undefined;
    if (/chưa\s*đạt|không\s*đạt|(?<!\p{L})fail(?!\p{L})|❌|✗|✘/iu.test(rest)) status = 'fail';
    else if (/bỏ\s*qua|(?<!\p{L})skip(?!\p{L})|không\s*áp\s*dụng|n\/a/iu.test(rest)) status = 'skip';
    else if (/(?<!\p{L})(đạt|pass|xong)(?!\p{L})|✅|✓|✔/iu.test(rest)) status = 'pass';
    if (!status) continue;
    // the note is whatever is left once the status word and separators are gone
    const note = rest
      .replace(/chưa\s*đạt|không\s*đạt|bỏ\s*qua|không\s*áp\s*dụng|(?<!\p{L})(đạt|pass|fail|skip|xong)(?!\p{L})|[✅✓✔❌✗✘]/iu, '')
      .replace(/\|/g, ' ')
      .replace(/^[\s:—–-]+|[\s:—–-]+$/g, '')
      .replace(/\s+/g, ' ');
    out[m[1].toUpperCase()] = { status, note: note || undefined };
  }
  return out;
}

// ---- who makes what, who checks what ----

/** Steps that make items (the plan's sections, the code for each AC); the others check them. */
export const PRODUCERS: StageKind[] = ['plan', 'code'];
export const isProducer = (k?: StageKind) => !!k && PRODUCERS.includes(k);

interface FlowLike {
  nodes: { id: string; type: string; data: { stage?: StageKind; checklist?: ChecklistItem[]; label: string } }[];
  edges: { source: string; target: string; sourceHandle?: string | null }[];
}

/**
 * The step a checking step judges: the one its "chưa đạt" link sends work back to, or else the
 * nearest step before it that makes items.
 */
export function judgedStep(p: FlowLike, checkerId: string): string | undefined {
  const node = (id: string) => p.nodes.find((n) => n.id === id);
  const back = p.edges.find((e) => e.source === checkerId && e.sourceHandle === 'fail');
  if (back && isProducer(node(back.target)?.data.stage)) return back.target;
  const seen = new Set<string>();
  const queue = p.edges.filter((e) => e.target === checkerId && e.sourceHandle !== 'fail').map((e) => e.source);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (isProducer(node(id)?.data.stage)) return id;
    queue.push(...p.edges.filter((e) => e.target === id && e.sourceHandle !== 'fail').map((e) => e.source));
  }
}

/** The items a making step produces: the plan's sections, or one per acceptance criterion for Code. */
export function producedItems(stage: StageKind | undefined, d: { checklist?: ChecklistItem[] }, ac?: AcceptanceCriterion[]): ChecklistItem[] {
  if (stage === 'plan') return d.checklist?.length ? withDefaultParts('plan', d.checklist) : CHECKLISTS.plan;
  if (stage === 'code') return (ac ?? []).map((a) => ({ id: a.id, text: a.text, ac: true, parts: AC_PARTS }));
  return [];
}

/**
 * The points an agent wrote under each item: the bullets under a plan section ("P1. Mục tiêu và
 * phạm vi"), or under a result line ("T4: ĐẠT — …" then "  - npm test: 42 pass"). A section is
 * found by its code, or by its name on a heading line; it ends at the next item, heading or label.
 * `allow`: code lines that still count as points (the plan's AC lines under its criteria section).
 */
export function parseSubs(text: string, items: { id: string; text: string }[], allow?: RegExp): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const byId = new Map(items.map((i) => [i.id.toUpperCase(), i.id]));
  const norm = (s: string) => s.toLowerCase().replace(/[*_`#:.]/g, '').replace(/\s+/g, ' ').trim();
  let cur: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*/g, '');
    if (!line.trim()) continue;
    const code = /^[\s>*_|`#-]*\s*([A-Z]{1,2}\d{1,2})\s*[:.)|\-–—]/i.exec(line);
    if (code && byId.has(code[1].toUpperCase())) {
      cur = byId.get(code[1].toUpperCase());
      continue;
    }
    const bullet = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(.+)$/.exec(line);
    const heading = /^\s*#{1,6}\s/.test(raw) || (/^\s*\*\*[^*]+\*\*:?\s*$/.test(raw)) || (!bullet && /^\s*[^-*•\s][^:]{0,60}:\s*$/.test(line));
    if (heading) {
      // a section heading may name the item instead of giving its code
      const name = norm(line);
      cur = name.length < 4 ? undefined : items.find((i) => name.startsWith(norm(i.text)) || norm(i.text).startsWith(name))?.id;
      continue;
    }
    if (code && !(allow && allow.test(code[1]))) {
      cur = undefined;
      continue;
    }
    if (!cur) continue;
    const point = (code ? line.trim() : bullet?.[1])
      ?.replace(/`/g, '')
      .replace(/^\|\s*|\s*\|\s*$/g, '') // a table row reads as "a · b · c"
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/^[\s:—–-]+/, '')
      .trim();
    if (!point || /^verdict\b/i.test(point) || /^[\s·:-]+$/.test(point)) continue;
    const list = (out[cur] ??= []);
    if (list.length < 8) list.push(point.length > 400 ? point.slice(0, 399) + '…' : point);
  }
  return out;
}
