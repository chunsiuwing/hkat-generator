// OCR for scanned PDFs — renders pages to images, then reads them with Tesseract.
import { getDocumentProxy, renderPageAsImage } from 'unpdf';

/**
 * @returns {Promise<string[]>} text of each OCR'd page
 */
export async function ocrPdf(buffer, { languages = 'eng+chi_tra', maxPages = 8 } = {}) {
  let createWorker;
  try {
    ({ createWorker } = await import('tesseract.js'));
  } catch {
    const err = new Error('OCR 模組未安裝（npm install tesseract.js）。');
    err.status = 500;
    throw err;
  }

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const total = Math.min(maxPages, pdf.numPages);
  const worker = await createWorker(languages);
  const pages = [];
  try {
    for (let i = 1; i <= total; i++) {
      const png = new Uint8Array(
        await renderPageAsImage(pdf, i, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 })
      );
      const { data } = await worker.recognize(png);
      pages.push(String(data?.text || ''));
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return pages;
}

export const OCR_LANGUAGES = [
  { id: 'eng', label: '英文 English' },
  { id: 'chi_tra', label: '繁體中文 Traditional Chinese' },
  { id: 'eng+chi_tra', label: '中英混合 Mixed（較慢 slower）' },
];

/** OCR a single image file (jpg/png) — for photo/scan uploads. */
export async function ocrImage(buffer, { languages = 'eng+chi_tra' } = {}) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(languages);
  try {
    const { data } = await worker.recognize(new Uint8Array(buffer));
    return String(data?.text || '');
  } finally {
    await worker.terminate().catch(() => {});
  }
}
