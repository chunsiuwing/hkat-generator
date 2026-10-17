// Creates a small valid English HKAT-style sample PDF for testing the upload pipeline.
// Usage: node scripts/make-test-pdf.mjs [output.pdf]
import { writeFileSync } from 'node:fs';

const lines = [
  'Green Valley Primary School',
  'English Reading Comprehension - Primary 5',
  '',
  'The Little Umbrella',
  '',
  'It was pouring with rain when Mei left school at four o\u2019clock.',
  'She looked for her little red umbrella under the bench, but it was gone.',
  'Mei\u2019s eyes filled with tears. Her grandmother had given her that umbrella.',
  '',
  'Just then, an old man smiled and held up the red umbrella. "Did you lose this?"',
  'he asked. Mei nodded and thanked him again and again.',
  'On the way home, Mei shared the umbrella with the old man, and they became',
  'the best of friends.',
  '',
  'Answer all the questions. [12 marks]',
  '',
  '1. Where was Mei when it started to rain? (1 mark)',
  '   ________________________________________________',
  '2. Why was the umbrella important to Mei? (2 marks)',
  '   ________________________________________________',
  '3. Who gave Mei the umbrella back? (1 mark)',
  '   A. her teacher   B. an old man   C. her grandmother',
  '4. Write T (true) or F (false): Mei went home alone. (1 mark)',
  '5. What does the word "nodded" mean? (1 mark)',
  '   ________________________________________________',
  '',
  'Answer key: 1. outside her school 2. her grandmother gave it to her 3. B 4. F 5. moved her head down to say yes',
];

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const content = ['BT', '/F1 11 Tf', '14 TL', '56 790 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefStart = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

const out = process.argv[2] || 'scripts/test-sample.pdf';
writeFileSync(out, pdf, 'latin1');
console.log('written:', out, Buffer.byteLength(pdf), 'bytes');
