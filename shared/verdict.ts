/** Sections a reviewer is asked to write before its VERDICT line (see server/pipeline.ts). */
const SECTIONS = ['Cần sửa', 'Nên sửa', 'Gợi ý', 'Câu hỏi', 'Lưu ý', 'Giả định'];

const clean = (line: string) => line.replace(/^[#>\s*_`-]+/, '').replace(/[*_`]+/g, '').trim();

/** "**Cần sửa:**", "## Lưu ý", "Câu hỏi: …" → the section name */
const header = (line: string) => {
  const c = clean(line).toLowerCase();
  return SECTIONS.find((s) => c.startsWith(s.toLowerCase()) && /^\s*([:：]|$)/.test(c.slice(s.length)));
};

/** Pull "Cần sửa: / Câu hỏi: / Lưu ý:" out of a step's answer so the approval card can show them. */
export function reviewSections(text: string): { title: string; body: string }[] {
  const lines = text.split('\n');
  const out: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | undefined;
  for (const line of lines) {
    if (/VERDICT\s*[:：]/i.test(line)) break;
    const h = header(line);
    if (h) {
      cur = { title: h, body: [] };
      out.push(cur);
      // "Cần sửa: a, b" on the same line
      const rest = clean(line).slice(h.length).replace(/^\s*[:：]\s*/, '');
      if (rest) cur.body.push(rest);
      continue;
    }
    // a new markdown heading ends the section
    if (cur && /^#{1,6}\s/.test(line)) cur = undefined;
    if (cur) cur.body.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.body);
}
