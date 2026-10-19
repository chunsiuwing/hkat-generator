// Word (.docx) export — student worksheet + teacher answer key, print-ready A4.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  Footer, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import { typeLabel } from './question-types.js';

const LEVEL_LABEL = { p4: 'Primary 4 / 小四', p5: 'Primary 5 / 小五', p6: 'Primary 6 / 小六' };
const label = (id) => typeLabel(id); // covers both EN (11) and ZH (12) taxonomies

const font = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '標楷體' };
const isCJK = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));

// Print-layout scaling (90–125%); set per buildDocx call.
let fontScale = 100;
const scaleSize = (size) => Math.max(12, Math.round((size ?? 22) * fontScale / 100));

const run = (text, opts = {}) => new TextRun({ text: String(text ?? ''), font, size: scaleSize(opts.size), ...opts });
const para = (children, opts = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [run(children)], spacing: { after: 120 }, ...opts });

function answerLines(q, language, lines = 'auto') {
  let count;
  if (lines === '0') count = 0;
  else if (lines === 'auto') count = Math.max(1, Math.min(3, Math.round((q.marks || 1) * 0.8) + 1));
  else count = Number(lines) || 1;
  const blank = language === 'zh' ? '＿'.repeat(28) : '_'.repeat(56);
  return Array.from({ length: count }, () =>
    new Paragraph({ children: [run(blank, { color: '888888' })], spacing: { after: 60 } })
  );
}

function buildQuestions(paper, { showAnswers, layout }) {
  const out = [];
  let lastInstruction = '';
  for (const q of paper.questions || []) {
    if (q.instruction && q.instruction !== lastInstruction) {
      lastInstruction = q.instruction;
      out.push(new Paragraph({
        children: [run(q.instruction, { bold: true })],
        spacing: { before: 200, after: 100 },
      }));
    }
    out.push(new Paragraph({
      children: [
        run(`${q.no}. `, { bold: true }),
        run(q.stem),
        run(`   [${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''} / 分]`, { size: 18, color: '666666' }),
        run(`   (${label(q.type)})`, { size: 18, color: '999999' }),
      ],
      spacing: { before: 120, after: 60 },
    }));
    if (q.options?.length) {
      for (const opt of q.options) {
        out.push(new Paragraph({ children: [run(`     ${opt}`)], spacing: { after: 30 }, indent: { left: 360 } }));
      }
      out.push(new Paragraph({ children: [run('')] }));
    } else if (!showAnswers) {
      out.push(...answerLines(q, paper.language, layout?.lines));
    }
    if (showAnswers) {
      out.push(new Paragraph({
        children: [run('Answer 答案：', { bold: true, color: '166534' }), run(q.answer, { color: '166534' })],
        indent: { left: 360 },
        spacing: { after: 40 },
      }));
      if (q.explanation) {
        out.push(new Paragraph({
          children: [run(`說明：${q.explanation}`, { italics: true, color: '555555', size: 20 })],
          indent: { left: 360 },
          spacing: { after: 100 },
        }));
      }
    }
  }
  return out;
}

function answerKeyTable(paper) {
  const cell = (text, opts = {}) =>
    new TableCell({ children: [new Paragraph({ children: [run(text, { size: 18, ...opts })] })], margins: { top: 40, bottom: 40, left: 80, right: 80 } });
  const header = new TableRow({
    tableHeader: true,
    children: ['No.', 'Type 題型', 'Marks 分', 'Answer 答案'].map((h) => cell(h, { bold: true })),
  });
  const rows = (paper.questions || []).map((q) =>
    new TableRow({ children: [cell(String(q.no)), cell(label(q.type)), cell(String(q.marks || 1)), cell(q.answer)] })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.SINGLE, size: 1, color: '999999' }, bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' }, left: { style: BorderStyle.SINGLE, size: 1, color: '999999' }, right: { style: BorderStyle.SINGLE, size: 1, color: '999999' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
    rows: [header, ...rows],
  });
}

/** Build the .docx buffer. version = 'student' | 'teacher'; layout = { lines, fontScale, nameField } */
export async function buildDocx(paper, version = 'student', layout = {}) {
  const showAnswers = version === 'teacher';
  fontScale = Number(layout.fontScale) || 100;
  const language = paper.language || paper.params?.language || 'en';
  const totalMarks = (paper.questions || []).reduce((s, q) => s + (q.marks || 1), 0);
  const quality = paper.quality?.score ? ` · 質量分 Quality ${paper.quality.score}` : '';

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [run(paper.title || 'Reading Comprehension', { bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [run(
        `${LEVEL_LABEL[paper.params?.level] || ''} · 約 ${paper.wordCount ?? paper.word_count ?? 0} 字 words · ${(paper.questions || []).length} 題 questions · ${totalMarks} 分 marks${showAnswers ? quality : ''}`,
        { size: 20, color: '666666' }
      )],
    }),
  ];

  if (!showAnswers && layout.nameField !== false) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [run('Name 姓名：____________________     Class 班別：________     Date 日期：____________', { size: 22 })],
    }));
  } else if (showAnswers) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [run('TEACHER COPY — 含答案及分數 / Answer key included', { bold: true, color: 'B91C1C', size: 22 })],
    }));
  }

  children.push(new Paragraph({ children: [run('')] }));
  for (const block of String(paper.passage || '').split(/\n\n+/)) {
    children.push(new Paragraph({
      children: [run(block)],
      spacing: { after: 140, line: 300 },
      alignment: AlignmentType.JUSTIFIED,
    }));
  }

  children.push(new Paragraph({ children: [run('')], spacing: { after: 200 } }));
  children.push(...buildQuestions(paper, { showAnswers, layout }));

  if (showAnswers) {
    children.push(new Paragraph({ children: [run('')], spacing: { after: 160 } }));
    children.push(new Paragraph({ children: [run('Answer Key 答案總表', { bold: true, size: 26 })], spacing: { after: 120 } }));
    children.push(answerKeyTable(paper));
    if (paper.notes) {
      children.push(new Paragraph({ children: [run(`💡 ${paper.notes}`, { italics: true, color: '555555' })], spacing: { before: 200 } }));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font, size: scaleSize(isCJK(language) ? 24 : 24) } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `${showAnswers ? 'Teacher copy' : 'Student worksheet'} — HKAT Generator   |   Page `, font, size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font, size: 16, color: '888888' })],
          })],
        }),
      },
      children,
    }],
  });

  const packed = await Packer.toBuffer(doc);
  fontScale = 100; // reset for the next build
  return packed;
}
