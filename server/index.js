// HKAT Comprehension Generator — local server
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  all, get, run, getSetting, setSetting, UPLOAD_DIR,
  listSamples, getSample, saveAnalysis, getAnalysis, processedSampleCount, safeParse,
} from './db.js';
import { extractPdfText, normalizePages, countWords } from './pdf.js';
import { structureSample, normaliseSample, fallbackSample } from './ingest.js';
import { computeStats, runAnalysis, analysisStale } from './analyze.js';
import { generatePaper } from './generate.js';
import { getAIConfigStatus, setAIConfig, AIError, PROVIDERS, testAIConnection, friendlyAIError } from './ai.js';
import { QUESTION_TYPES, LEVELS } from './question-types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const safe = basename(file.originalname, extname(file.originalname))
        .replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 60);
      cb(null, `${Date.now()}-${safe}${extname(file.originalname) || '.pdf'}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (/pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('只接受 PDF 檔案 (only PDF files are accepted)'));
  },
});

/* --------- tiny async job queue so AI work runs one at a time --------- */
let queue = Promise.resolve();
let pendingJobs = 0;
function enqueue(job) {
  pendingJobs += 1;
  queue = queue
    .then(job)
    .catch((err) => console.error('[job]', err?.message || err))
    .finally(() => {
      pendingJobs -= 1;
      if (pendingJobs === 0) maybeAutoAnalyse();
    });
  return queue;
}

/** "AI maintains the database": refresh the style profile after every batch of uploads. */
async function maybeAutoAnalyse() {
  if (getSetting('auto_analyse') === '0') return;
  if (getAIConfigStatus().mock) return; // never spend tokens in mock mode
  if (!analysisStale() || processedSampleCount() === 0) return;
  try {
    const { profile, sampleCount, languages } = await runAnalysis();
    saveAnalysis(profile, sampleCount, languages);
    console.log(`[analysis] auto-updated style profile (${sampleCount} samples)`);
  } catch (err) {
    console.error('[analysis] auto-analysis failed:', err?.message || err);
  }
}

function setSampleError(id, message) {
  run(`UPDATE samples SET status = 'failed', error = ? WHERE id = ?`, [String(message).slice(0, 500), id]);
}

/** Extract text (if needed) → ask the AI to structure it → store in the DB. */
async function processSample(id, filePath) {
  let row = get('SELECT * FROM samples WHERE id = ?', [id]);
  if (!row) return;

  run(`UPDATE samples SET status = 'extracting' WHERE id = ?`, [id]);
  let rawText = row.raw_text;
  let pages = row.pages;
  try {
    if (!rawText) {
      const buffer = readFileSync(filePath || join(UPLOAD_DIR, row.filename));
      const extracted = await extractPdfText(buffer);
      pages = extracted.totalPages;
      rawText = normalizePages(extracted.pages);
      if (!rawText || rawText.replace(/\s/g, '').length < 40) {
        throw new Error('PDF 內沒有可抽取的文字（可能是掃描圖片檔）。請改用文字版 PDF 或使用「貼上文字」。');
      }
      run(`UPDATE samples SET raw_text = ?, pages = ?, status = 'structuring' WHERE id = ?`, [rawText, pages, id]);
    } else {
      run(`UPDATE samples SET status = 'structuring' WHERE id = ?`, [id]);
    }

    let parsed;
    try {
      parsed = await structureSample(rawText);
    } catch (err) {
      if (err instanceof AIError && err.status === 400) {
        // No API key yet: keep the raw text safely, teacher can re-process later.
        const fb = fallbackSample(rawText);
        run(
          `UPDATE samples SET language = ?, level = ?, passage_text = ?, word_count = ?,
             status = 'pending', error = ? WHERE id = ?`,
          [fb.language, fb.level, fb.passage, countWords(fb.passage, fb.language), '尚未設定 AI Key，請設定後按「重新處理」', id]
        );
        return;
      }
      throw err;
    }

    run(
      `UPDATE samples SET language = ?, level = ?, title = ?, topic = ?, passage_text = ?,
         word_count = ?, question_count = ?, question_types = ?, questions = ?, style_notes = ?,
         status = 'processed', error = NULL WHERE id = ?`,
      [
        parsed.language, parsed.level, parsed.title || row.title, parsed.topic, parsed.passage,
        parsed.wordCount, parsed.questions.length, JSON.stringify(parsed.questionTypes),
        JSON.stringify(parsed.questions), parsed.styleNotes, id,
      ]
    );
    console.log(`[ingest] #${id} processed (${parsed.language}, ${parsed.level}, ${parsed.questions.length} questions)`);
  } catch (err) {
    console.error('[ingest]', id, err?.message || err);
    setSampleError(id, err?.message || '處理失敗');
  }
}

/* ----------------------------- API: meta ----------------------------- */

app.get('/api/meta', (req, res) => {
  res.json({ questionTypes: QUESTION_TYPES, levels: LEVELS, ai: getAIConfigStatus(), providers: PROVIDERS });
});

app.get('/api/providers', (req, res) => res.json({ providers: PROVIDERS }));

app.get('/api/health', (req, res) => res.json({ ok: true, processed: processedSampleCount() }));

/* ----------------------------- API: samples ----------------------------- */

app.post('/api/samples/upload', upload.array('files', 20), (req, res) => {
  const results = { added: [], duplicates: [], errors: [] };
  for (const file of req.files || []) {
    const buffer = readFileSync(file.path);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = get('SELECT id, filename FROM samples WHERE file_hash = ?', [hash]);
    if (existing) {
      results.duplicates.push({ filename: file.originalname, existingId: existing.id, existingName: existing.filename });
      continue;
    }
    const guess = basename(file.originalname, extname(file.originalname)).replace(/[_-]+/g, ' ').trim();
    const out = run(
      `INSERT INTO samples (filename, file_hash, file_size, raw_text, title, status) VALUES (?, ?, ?, '', ?, 'queued')`,
      [file.originalname, hash, file.size, guess]
    );
    const id = Number(out.lastInsertRowid);
    results.added.push({ id, filename: file.originalname });
    enqueue(() => processSample(id, file.path));
  }
  res.json(results);
});

// Paste text instead of uploading a PDF (for typed-in or scanned-then-OCR'd samples).
app.post('/api/samples/text', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '請先貼上文章及題目文字 (paste the passage text first)' });
  const hash = createHash('sha256').update(text).digest('hex');
  const existing = get('SELECT id FROM samples WHERE file_hash = ?', [hash]);
  if (existing) return res.json({ added: [], duplicates: [{ filename: '貼上的文字', existingId: existing.id }], errors: [] });

  const out = run(
    `INSERT INTO samples (filename, file_hash, file_size, raw_text, title, status) VALUES (?, ?, ?, ?, ?, 'structuring')`,
    ['pasted-text.txt', hash, text.length, text, String(req.body?.filename || '貼上的文字 / Pasted text')]
  );
  const id = Number(out.lastInsertRowid);
  enqueue(() => processSample(id, null));
  res.json({ added: [{ id, filename: '貼上的文字 / Pasted text' }], duplicates: [], errors: [] });
});

app.get('/api/samples', (req, res) => {
  res.json({ samples: listSamples(), stats: computeStats(), stale: analysisStale(), ai: getAIConfigStatus() });
});

app.get('/api/samples/:id', (req, res) => {
  const sample = getSample(Number(req.params.id));
  if (!sample) return res.status(404).json({ error: '找不到這個樣本 (sample not found)' });
  res.json({ sample, raw: sample.raw_text || '' });
});

app.post('/api/samples/:id/reprocess', (req, res) => {
  const id = Number(req.params.id);
  const row = get('SELECT id, raw_text FROM samples WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '找不到這個樣本 (sample not found)' });
  if (!row.raw_text) return res.status(400).json({ error: '這個樣本沒有原始文字，請重新上載 PDF。' });
  run(`UPDATE samples SET status = 'structuring', error = NULL WHERE id = ?`, [id]);
  enqueue(() => processSample(id, null));
  res.json({ ok: true });
});

app.delete('/api/samples/:id', (req, res) => {
  run('DELETE FROM samples WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

/* ----------------------------- API: analysis ----------------------------- */

app.get('/api/analysis', (req, res) => {
  res.json({
    analysis: getAnalysis(),
    stats: computeStats(),
    stale: analysisStale(),
    processed: processedSampleCount(),
  });
});

app.post('/api/analysis/run', async (req, res, next) => {
  try {
    const { profile, sampleCount, languages } = await runAnalysis();
    saveAnalysis(profile, sampleCount, languages);
    res.json({ analysis: getAnalysis(), stale: false });
  } catch (err) { next(err); }
});

/* ----------------------------- API: generate ----------------------------- */

app.post('/api/generate', async (req, res, next) => {
  try {
    const paper = await generatePaper(req.body || {});
    res.json({ paper });
  } catch (err) { next(err); }
});

/* ----------------------------- API: history ----------------------------- */

app.get('/api/history', (req, res) => {
  const rows = all('SELECT id, params, language, title, word_count, questions, source, error, created_at FROM history ORDER BY id DESC LIMIT 100');
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      language: r.language,
      title: r.title,
      wordCount: r.word_count,
      questionCount: safeParse(r.questions, []).length,
      params: safeParse(r.params, {}),
      source: r.source,
      error: r.error,
      createdAt: r.created_at,
    })),
  });
});

app.get('/api/history/:id', (req, res) => {
  const row = get('SELECT * FROM history WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: '找不到這份練習 (paper not found)' });
  res.json({
    paper: {
      id: row.id,
      title: row.title,
      passage: row.passage,
      wordCount: row.word_count,
      questions: safeParse(row.questions, []),
      notes: '',
      params: safeParse(row.params, {}),
      language: row.language,
      createdAt: row.created_at,
    },
  });
});

app.delete('/api/history/:id', (req, res) => {
  run('DELETE FROM history WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

/* ----------------------------- API: settings ----------------------------- */

app.get('/api/config', (req, res) => {
  res.json({ ...getAIConfigStatus(), autoAnalyse: getSetting('auto_analyse') !== '0' });
});

app.post('/api/config', (req, res) => {
  const { baseUrl, apiKey, model, autoAnalyse } = req.body || {};
  if (autoAnalyse !== undefined) setSetting('auto_analyse', autoAnalyse ? '1' : '0');
  res.json({ ...setAIConfig({ baseUrl, apiKey, model }), autoAnalyse: getSetting('auto_analyse') !== '0' });
});

// Real 1-token request: verifies key + base URL + model actually work together.
app.post('/api/config/test', async (req, res, next) => {
  try {
    const body = req.body || {};
    const dirty = body.baseUrl !== undefined || body.model !== undefined || body.apiKey !== undefined;
    // Allow testing unsaved values from the settings form without changing the real config.
    const saved = {};
    for (const [dbKey, apiKey] of [['ai_base_url', 'baseUrl'], ['ai_api_key', 'apiKey'], ['ai_model', 'model']]) {
      const v = getSetting(dbKey);
      if (v) saved[apiKey] = v;
    }
    if (dirty) setAIConfig(body);
    const result = await testAIConnection();
    if (dirty) setAIConfig(saved);
    res.json(result);
  } catch (err) { next(err); }
});

/* ----------------------------- errors ----------------------------- */

app.use((err, req, res, next) => {
  const status = err instanceof AIError ? err.status : err.status || (err.message?.includes('PDF') ? 400 : 500);
  console.error('[error]', err?.message || err);
  if (err.detail) console.error('[error detail]', err.detail);
  res.status(status).json({ error: err?.message || '伺服器錯誤 (server error)', detail: err?.detail || undefined });
});

app.listen(PORT, () => {
  const status = getAIConfigStatus();
  console.log(`\n  ✍️  HKAT Comprehension Generator`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  AI: ${status.mock ? 'MOCK mode' : status.configured ? `${status.model} @ ${status.baseUrl}` : 'not configured (set a key in ⚙️ Settings)'}\n`);
});
