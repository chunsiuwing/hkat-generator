// Word (.docx) text extraction via mammoth (pure JS, no native modules).
import mammoth from 'mammoth';

/**
 * Extract raw text from a .docx buffer, preserving paragraph breaks.
 * Tables come out row by row — enough for the AI structuring step.
 */
export async function extractDocxText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  // mammoth joins paragraphs with \n; make blank line = new paragraph like PDFs.
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
