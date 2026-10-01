// What each standard stage is told, on top of its own prompt. Shared so the Flow editor can show the
// exact text an agent will get. Erasable-only TypeScript (Node runs it with type stripping).
import type { PNodeData, PipelineRun, RunConfig } from './types.ts';
import { CHECKLISTS, STAGES, TESTS, TEST_PARTS, checklistOf, isProducer, producedItems, type ChecklistItem, type StageKind } from './stages.ts';

const TEST_NAMES = TESTS.map((t) => t.name).join(', ');

function criteria(run: PipelineRun): string {
  if (!run.ac?.length) return '';
  return '\n\nTiêu chí đạt (do bước Plan chốt):\n' + run.ac.map((a) => `${a.id}: ${a.text}${a.status ? ` (lần chấm trước: ${a.status === 'pass' ? 'ĐẠT' : 'CHƯA ĐẠT'})` : ''}`).join('\n');
}

const SEVERITY =
  'Phân loại mọi ý theo mức, mỗi mức một mục riêng:\n' +
  '- `Cần sửa:` mức CHẶN: sai yêu cầu/AC, sai logic, thiếu bước bắt buộc, lỗ hổng bảo mật, mất dữ liệu, chắc chắn không chạy.\n' +
  '- `Nên sửa:` đáng làm nhưng không chặn.\n' +
  '- `Gợi ý:` tuỳ chọn, cách viết khác.\n';

function failRule(d: PNodeData): string {
  return d.failAt === 'should'
    ? 'Chấm `VERDICT: FAIL` khi còn ý trong `Cần sửa` hoặc `Nên sửa`.'
    : 'Chỉ chấm `VERDICT: FAIL` khi còn ý trong `Cần sửa` (mức chặn); `Nên sửa` và `Gợi ý` vẫn PASS.';
}

function testPlan(d: PNodeData): string {
  const lines = TESTS.map((t) => {
    const mode = d.tests?.[t.id] ?? 'auto';
    if (mode === 'skip') return `- ${t.name}: KHÔNG chạy (người dùng tắt).`;
    const when = mode === 'always' || !t.when ? 'LUÔN chạy' : `chạy khi ${t.when}`;
    const scope = t.id === 'regression' ? (d.regression === 'full' ? ' Phạm vi: toàn bộ bộ test.' : ' Phạm vi: test của khu vực bị đổi.') : '';
    return `- ${t.name} (${when}): kiểm ${t.checks}. Cách: ${t.how}.${scope}`;
  });
  return lines.join('\n');
}

/** The step's goal as the user set it (or the stage's default): what, from what, producing what, done when. */
export function stageContract(kind: StageKind, d: PNodeData): { does: string; input: string; output: string; done: string } {
  const c = STAGES[kind];
  const g = d.guide;
  return { does: g?.does?.trim() || c.does, input: g?.input?.trim() || c.input, output: g?.output?.trim() || c.output, done: g?.done?.trim() || c.done };
}

/**
 * Text appended to a stage's prompt: its goal (editable per node), the app's detailed rules for that
 * kind of step (can be switched off), then the user's own extra rules.
 * `recheck`: this checker ran before in this run.
 */
export function stageInstruction(
  kind: StageKind | undefined,
  d: PNodeData,
  run: PipelineRun,
  recheck: boolean,
  cfg: RunConfig,
  /** checking steps: the step they judge and its items */
  judged?: { label: string; items: ChecklistItem[] },
): string {
  if (!kind) return '';
  const c = stageContract(kind, d);
  const goal =
    `\n\n---\nBƯỚC NÀY (${d.label}):\n- Việc cần làm: ${c.does}\n- Dựa trên: ${c.input}\n- Phải trả về: ${c.output}\n- Xong khi: ${c.done}` +
    (d.guide?.standard === false ? criteria(run) : '');
  const rules = d.guide?.rules?.trim() ? `\n\nQuy tắc thêm của người dùng (ưu tiên hơn hướng dẫn chung nếu khác nhau):\n${d.guide.rules.trim()}` : '';
  const standard = d.guide?.standard === false ? '' : standardRules(kind, d, run, recheck, cfg);
  return goal + standard + rules + (isProducer(kind) ? makeBlock(kind, d, run) : judgeBlock(kind, d, run, recheck && d.reviewMode !== 'full', judged));
}

/** Points under each item: shown as sub-cards that fan out of the item on the flow. */
const SUBS =
  ' Ngay dưới mỗi dòng kết quả, thêm 1–5 ý con, mỗi ý một dòng thụt vào bắt đầu bằng `  - ` và dưới 15 từ, ' +
  'đi lần lượt theo các "ý con" ghi ở mỗi mục (vd `  - Lệnh đã dùng: npm test`, `  - Kết quả: 42 pass`), để người xem biết mục đó gồm những gì.';

/** " — ý con: Mục tiêu; Trong phạm vi; Ngoài phạm vi" */
const partsOf = (i: ChecklistItem) => (i.parts?.length ? ` — ý con: ${i.parts.join('; ')}` : '');

const LINE_FORMAT =
  'Ở cuối câu trả lời (trước dòng VERDICT), viết mục `Kết quả từng mục:` mỗi mục một dòng đúng mẫu ' +
  '`P1: ĐẠT — ghi chú ngắn`, `P1: CHƯA ĐẠT — lý do và cần sửa gì` hoặc `P1: BỎ QUA — lý do` (thay P1 bằng mã mục).';

/** A making step: the items to produce; when sent back, only the ones a check failed. */
function makeBlock(kind: StageKind, d: PNodeData, run: PipelineRun): string {
  const items = producedItems(kind, d, run.ac);
  const failed = items.filter((i) => run.marks?.[i.id]?.status === 'fail');
  if (failed.length)
    return (
      '\n\nLẦN LÀM LẠI: bước kiểm tra chấm CHƯA ĐẠT đúng các mục dưới đây. Chỉ sửa các mục này, giữ nguyên các mục đã đạt:\n' +
      failed.map((i) => `- ${i.id}. ${i.text}${run.marks?.[i.id]?.note ? `: ${run.marks[i.id].note}` : ''}`).join('\n') +
      (kind === 'code' ? '\nCuối câu trả lời, mỗi AC vừa sửa một dòng `ACn: ĐÃ SỬA — file:dòng`.' + SUBS : '\nViết lại các mục này đúng mẫu `## P1. Tên mục` với các ý gạch đầu dòng `- …`.')
    );
  if (kind === 'plan')
    return (
      '\n\nPLAN GỒM CÁC MỤC SAU. Mỗi mục là một phần có tiêu đề đúng mẫu `## P1. Tên mục` (giữ đúng mã để bước sau chấm), ' +
      'nội dung là các ý gạch đầu dòng `- …`, mỗi ý một việc, ngắn gọn (mục tiêu gồm những gì, phạm vi có những phần nào…):\n' +
      items.map((i) => `- ${i.id}. ${i.text}${i.hint ? ` (${i.hint})` : ''}${partsOf(i)}`).join('\n') +
      '\nTrong mỗi mục, viết các ý gạch đầu dòng theo đúng "ý con" ghi ở mục đó, mở đầu bằng tên ý (vd `- Mục tiêu: …`, `- Không làm: …`).'
    );
  // code: one piece of work per criterion, plus its own definition of done
  const done = checklistOf('code', d)
    .filter((i) => !i.ac)
    .map((i) => `- ${i.id}. ${i.text}${i.hint ? ` (${i.hint})` : ''}${partsOf(i)}`)
    .join('\n');
  return (
    (items.length ? '\n\nLÀM TỪNG TIÊU CHÍ ĐẠT:\n' + items.map((i) => `- ${i.id}. ${i.text}${partsOf(i)}`).join('\n') + '\nCuối câu trả lời, mỗi AC một dòng `ACn: ĐÃ LÀM — file:dòng`.' + SUBS : '') +
    '\n\nTRƯỚC KHI GIAO, TỰ KIỂM (mỗi mục một dòng kết quả, mã C…):\n' +
    done +
    '\nCuối câu trả lời, mỗi mục tự kiểm một dòng `C1: ĐẠT — ghi chú`, `C1: CHƯA ĐẠT — lý do` hoặc `C1: BỎ QUA — lý do`.' +
    SUBS
  );
}

/** A checking step: judge every item of the step before it (on a re-check only the ones not passed yet), and report on each of its own criteria / test kinds. */
function judgeBlock(kind: StageKind, d: PNodeData, run: PipelineRun, recheck: boolean, judged?: { label: string; items: ChecklistItem[] }): string {
  const own = checklistOf(kind, d).filter((i) => !i.ac);
  const ownText =
    kind === 'test'
      ? '\n\nCÁC LOẠI TEST (mỗi loại một dòng kết quả, mã T…; ý con: ' + TEST_PARTS.join('; ') + '):\n' + own.map((i) => `- ${i.id}. ${i.text} (${i.hint ?? ''})`).join('\n')
      : '\n\nTIÊU CHÍ SOÁT (dùng để chấm từng mục, và mỗi tiêu chí một dòng kết quả, mã ' + (own[0]?.id[0] ?? 'R') + '…):\n' + own.map((i) => `- ${i.id}. ${i.text}${i.hint ? ` (${i.hint})` : ''}${partsOf(i)}`).join('\n');
  const ownFormat =
    kind === 'test'
      ? 'Với mỗi loại test: `T1: ĐẠT — lệnh đã chạy, kết quả`, `T1: CHƯA ĐẠT — lỗi gì, file:dòng` hoặc `T1: BỎ QUA — vì sao không cần hoặc không có công cụ`.'
      : 'Với mỗi tiêu chí soát: `R1: ĐẠT` hoặc `R1: CHƯA ĐẠT — những mục nào vi phạm và vì sao` (thay R1 bằng mã tiêu chí).';
  if (!judged?.items.length) return ownText + '\n\nỞ cuối câu trả lời (trước dòng VERDICT), viết mục `Kết quả từng mục:`. ' + ownFormat + SUBS;
  const open = judged.items.filter((i) => run.marks?.[i.id] && (run.marks[i.id].status === 'fail' || run.marks[i.id].status === 'redo'));
  const list = recheck && open.length ? open : judged.items;
  return (
    `\n\nCHẤM TỪNG MỤC CỦA BƯỚC "${judged.label}"` +
    (list !== judged.items ? ' (các mục khác đã đạt ở lần trước, lần này CHỈ chấm lại những mục dưới)' : '') +
    ':\n' +
    list.map((i) => `- ${i.id}. ${i.text}${recheck && run.marks?.[i.id]?.note ? `. Lần trước: ${run.marks[i.id].note}` : ''}`).join('\n') +
    ownText +
    '\n\n' +
    LINE_FORMAT +
    ' Chỉ ghi CHƯA ĐẠT khi mục có lỗi làm bước này chấm trượt; lỗi nhỏ, góp ý thì ghi ĐẠT kèm ghi chú. Mục nào CHƯA ĐẠT thì ghi rõ cần sửa gì, vì bước trước chỉ sửa đúng các mục bạn chấm chưa đạt. Sau đó, cũng trong mục này: ' +
    ownFormat +
    SUBS
  );
}

/** The app's detailed rules for each kind of step. */
export function standardRules(kind: StageKind, d: PNodeData, run: PipelineRun, recheck: boolean, cfg: RunConfig): string {
  const head = '\n\n';
  switch (kind) {
    case 'plan':
      return (
        head +
        'HƯỚNG DẪN CHI TIẾT. Viết đủ các mục sau, đúng tên mục:\n' +
        '1. `Mục tiêu và phạm vi:` làm gì, và KHÔNG làm gì.\n' +
        '2. `Giả định:` chỗ yêu cầu chưa rõ thì tự chốt phương án hợp lý nhất và ghi ở đây.\n' +
        '3. `Tiêu chí đạt:` mỗi tiêu chí một dòng riêng bắt đầu bằng `AC1:`, `AC2:`… (không dùng bảng). Mỗi AC phải kiểm chứng được (hành động → kết quả quan sát được), ' +
        'không viết chung chung kiểu "chạy tốt".\n' +
        '4. `Các bước:` từng bước nhỏ, ghi file/thành phần sẽ đổi.\n' +
        `5. \`Kế hoạch test:\` mỗi AC kiểm bằng loại test nào (${TEST_NAMES}), test có sẵn hay cần viết mới.\n` +
        '6. `Rủi ro:` và cách lùi lại nếu hỏng.\n' +
        '7. Một dòng `Cỡ task: Nhỏ | Vừa | Lớn` (Nhỏ: vài file, không đổi API/dữ liệu; Lớn: nhiều module, đổi API/dữ liệu hoặc kiến trúc).\n' +
        'Task nhỏ thì viết ngắn, nhưng vẫn đủ mục và có AC.'
      );
    case 'review-plan':
      return (
        head +
        'HƯỚNG DẪN CHI TIẾT. Đối chiếu plan với yêu cầu và code thật. Soát:\n' +
        '- Plan có làm đúng và đủ yêu cầu không, có làm thừa ngoài phạm vi không.\n' +
        '- Mỗi AC có kiểm chứng được không; có thiếu AC cho phần quan trọng không.\n' +
        '- Các bước có khả thi với code hiện có không (file/hàm có thật, cách làm hợp kiến trúc).\n' +
        '- Kế hoạch test có phủ hết AC không; rủi ro lớn đã có cách xử lý chưa.\n' +
        (recheck && d.reviewMode !== 'full'
          ? 'Đây là lần chấm lại: chỉ xem các ý `Cần sửa` lần trước đã xử lý chưa và phần plan mới đổi, không soát lại từ đầu.\n'
          : '') +
        SEVERITY +
        failRule(d)
      );
    case 'code':
      return (
        head +
        'HƯỚNG DẪN CHI TIẾT. \n' +
        '- Làm đúng các bước của plan, không làm ngoài phạm vi.\n' +
        '- Viết hoặc cập nhật test theo `Kế hoạch test` của plan (unit, tích hợp… cho logic mới).\n' +
        (cfg.permission === 'exec' || cfg.permission === 'full'
          ? '- Trước khi kết thúc, tự chạy lint, typecheck và build của project; lỗi do bạn gây ra thì sửa luôn.\n'
          : '') +
        '- Cuối câu trả lời có bảng `AC | Đã làm ở đâu (file:dòng) | Ghi chú`.' +
        criteria(run)
      );
    case 'test':
      return (
        head +
        'HƯỚNG DẪN CHI TIẾT. Bạn chỉ kiểm tra, KHÔNG sửa code.\n' +
        '1. Xem phần thay đổi: `git status` và `git diff` (cả file mới chưa commit), cùng `Kế hoạch test` của plan.\n' +
        '2. Chọn loại test theo danh sách dưới. "Chạy khi …" nghĩa là chỉ chạy khi phần thay đổi khớp mô tả; ghi rõ vì sao chạy hoặc bỏ.\n' +
        testPlan(d) +
        '\n3. Thứ tự chạy: lint và typecheck, build, unit, tích hợp và API, luồng người dùng và giao diện, hồi quy, rồi các loại còn lại. ' +
        'Build lỗi thì bỏ những test cần chạy app, các loại khác VẪN chạy hết để báo mọi lỗi trong một lần.\n' +
        '4. Lỗi nằm ở phần code không bị đổi và không liên quan thay đổi lần này là lỗi CÓ SẴN: ghi vào `Lưu ý:`, không tính là FAIL.\n' +
        '5. Project không có công cụ cho một loại test (vd chưa có Playwright): ghi "không có công cụ", kiểm tay thay thế nếu được, không FAIL vì thiếu công cụ.\n' +
        '6. Báo cáo bằng bảng `| Loại test | Vì sao chạy/bỏ | Lệnh hoặc cách kiểm | Kết quả | Bằng chứng |` ' +
        '(bằng chứng: vài dòng log lỗi, file:dòng, hoặc mô tả ảnh chụp). Sau đó mỗi AC một dòng `ACn: ĐẠT` hoặc `ACn: CHƯA ĐẠT — lý do`.\n' +
        '7. Chấm `VERDICT: FAIL` khi có lỗi MỚI do thay đổi lần này hoặc có AC CHƯA ĐẠT; khi đó mục `Cần sửa:` ghi đúng lệnh, file:dòng và log gốc.' +
        criteria(run)
      );
    case 'review-code':
      return (
        head +
        'HƯỚNG DẪN CHI TIẾT. Phạm vi: phần code đã đổi (`git status`, `git diff`), không soát cả project.\n' +
        '- Với mỗi AC viết một dòng `ACn: ĐẠT` hoặc `ACn: CHƯA ĐẠT — lý do (file:dòng)`.\n' +
        '- Soát: đúng logic và trường hợp biên, xử lý lỗi, bảo mật (quyền, input), dữ liệu, hợp với cách viết sẵn có của project, có test cho logic mới.\n' +
        (recheck && d.reviewMode !== 'full'
          ? '- Đây là lần chấm lại: chỉ kiểm các ý `Cần sửa` lần trước và phần diff mới, không soát lại từ đầu.\n'
          : '') +
        SEVERITY +
        failRule(d) +
        ' AC nào CHƯA ĐẠT cũng là ý `Cần sửa`.' +
        criteria(run)
      );
  }
}
