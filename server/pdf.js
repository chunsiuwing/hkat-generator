// PDF text extraction with unpdf (pdf.js for Node, no native modules).
import { getDocumentProxy, extractText } from 'unpdf';

/** Extract raw text page by page from a PDF buffer. */
export async function extractPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: Array.isArray(text) ? text : [text] };
}

/**
 * Clean up PDF-extracted text:
 *  - drop repeating headers/footers (same short line on 3+ pages)
 *  - rebuild paragraphs: blank line = new paragraph, otherwise join lines
 *  - join hyphenated words at line breaks
 */
export function normalizePages(pages) {
  const linesByPage = pages.map((p) =>
    String(p || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim())
  );

  // Header/footer detection: identical short lines on >= 3 pages.
  const counts = new Map();
  for (const lines of linesByPage) {
    const seen = new Set();
    for (const line of lines) {
      if (!line || line.length > 60) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  const repeatThreshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const boilerplate = new Set(
    [...counts.entries()].filter(([, n]) => n >= repeatThreshold).map(([line]) => line)
  );

  const isCJK = (s) => /[\u4e00-\u9fff]/.test(s);
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length) paragraphs.push(current.join(isCJK(current.join('')) && !/[A-Za-z]/.test(current.join('')) ? '' : ' '));
    current = [];
  };

  for (const lines of linesByPage) {
    for (const line of lines) {
      if (boilerplate.has(line)) continue;
      if (!line) { flush(); continue; }
      // A line that clearly ends a page section (short + ends with punctuation / page-ish) still joins.
      if (current.length && /-\s*$/.test(current[current.length - 1])) {
        // hyphenated line break: join without space, drop the hyphen
        current[current.length - 1] = current[current.length - 1].replace(/-\s*$/, '') + line;
        continue;
      }
      current.push(line);
      if (/[。．！？.!?]["'”’）)]?$/.test(line)) {
        // sentence end: keep flowing, paragraph break only on blank lines
      }
    }
    flush(); // page break = paragraph break fallback
  }
  flush();

  return paragraphs
    .map((p) => p.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?、。，；：！？])/g, '$1').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

export function countWords(text, language) {
  if (!text) return 0;
  if (language === 'zh' || /[\u4e00-\u9fff]/.test(text.slice(0, 200))) {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
    return cjk + latin;
  }
  return (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
}
