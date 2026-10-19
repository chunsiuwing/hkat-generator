// Print-ready A4 HTML view for a paper (browser Ctrl+P or "列印" button).
// Used by GET /api/papers/:id/print — no JS framework needed, pure template.
import { typeLabel } from './question-types.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LEVEL_LABEL = { p4: '小四 Primary 4', p5: '小五 Primary 5', p6: '小六 Primary 6' };

function answerLines(q, { lines, language }) {
  const blank = language === 'zh' ? '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿' : '______________________________________________________';
  let count;
  if (lines === '0') count = 0;
  else if (lines === 'auto') count = Math.max(1, Math.min(3, Math.round((q.marks || 1) * 0.8) + 1));
  else count = Number(lines);
  return Array.from({ length: count }, () => `<div class="line">${blank}</div>`).join('');
}

export function renderPrintHtml(paper, { version = 'student', lines = 'auto', fontScale = '100' } = {}) {
  const lang = paper.language === 'zh' ? '中文' : 'English';
  const level = LEVEL_LABEL[paper.params?.level] || '';
  const isStudent = version === 'student';

  let lastInstruction = '';
  const questionsHtml = (paper.questions || []).map((q) => {
    let head = '';
    if (q.instruction && q.instruction !== lastInstruction) {
      lastInstruction = q.instruction;
      head = `<div class="group-title">${esc(q.instruction)}</div>`;
    }
    const options = q.options?.length
      ? `<ul class="options">${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`
      : '';
    const answerBlock = isStudent
      ? (q.options?.length ? '' : answerLines(q, { lines, language: paper.language }))
      : `<div class="answer"><strong>答案：</strong>${esc(q.answer)}${q.explanation ? `<div class="exp">說明：${esc(q.explanation)}</div>` : ''}</div>`;
    const typeTag = isStudent ? '' : `<span class="tag">[${esc(typeLabel(q.type))}]</span>`;
    return `${head}<div class="q">
      <div class="q-head"><span class="q-no">${q.no}.</span> ${typeTag}<span class="marks">（${q.marks || 1} 分）</span></div>
      <div class="stem">${esc(q.stem)}</div>
      ${options}
      ${answerBlock}
    </div>`;
  }).join('');

  const infoRow = isStudent
    ? `<div class="info-row">姓名 Class：＿＿＿＿＿＿＿＿＿　學號 No.：＿＿＿＿＿＿　日期 Date：＿＿＿＿＿＿＿＿</div>`
    : '';
  const notes = !isStudent && paper.notes ? `<div class="notes">💡 ${esc(paper.notes)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<title>${esc(paper.title || 'Reading Comprehension')}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Times New Roman", "Songti TC", "SimSun", "PMingLiU", serif;
    font-size: ${fontScale}%; line-height: 1.5; color: #111; margin: 0; padding: 18mm 16mm;
    background: #fff;
  }
  h1 { font-size: 1.3em; text-align: center; margin: 0 0 4px; }
  .meta { text-align: center; font-size: .85em; color: #444; margin-bottom: 10px; }
  .info-row { border: 1px solid #999; padding: 6px 10px; margin: 10px 0; font-size: .9em; }
  .passage { white-space: pre-wrap; text-align: justify; margin: 10px 0 16px; }
  .group-title { font-weight: bold; margin: 14px 0 6px; border-bottom: 1px solid #666; padding-bottom: 2px; }
  .q { margin: 0 0 12px; page-break-inside: avoid; }
  .q-head { margin-bottom: 2px; }
  .q-no { font-weight: bold; }
  .marks { color: #555; font-size: .9em; }
  .tag { color: #888; font-size: .8em; margin-left: 6px; }
  .stem { margin-left: 14px; }
  .options { margin: 4px 0 4px 30px; padding: 0; list-style: none; }
  .options li { margin-bottom: 2px; }
  .line { color: #999; margin: 6px 0 0 30px; letter-spacing: 1px; }
  .answer { margin: 6px 0 0 30px; color: #166534; }
  .exp { color: #555; font-style: italic; font-size: .9em; }
  .notes { margin-top: 16px; border: 1px dashed #999; padding: 8px 10px; font-size: .9em; color: #333; }
  .print-bar { position: fixed; top: 10px; right: 10px; }
  .print-bar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
  @media print { .print-bar { display: none; } body { padding: 0; } }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">🖨 列印 Print</button></div>
  <h1>${esc(paper.title || 'Reading Comprehension')}</h1>
  <div class="meta">${lang}${level ? ` · ${esc(level)}` : ''}${(paper.questions || []).length ? ` · 共 ${(paper.questions || []).length} 題` : ''}${isStudent ? '' : ' · 教師版（含答案）'}</div>
  ${infoRow}
  ${paper.passage ? `<div class="passage">${esc(paper.passage)}</div>` : ''}
  ${questionsHtml}
  ${notes}
</body>
</html>`;
}
