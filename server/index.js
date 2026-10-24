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
  getPaper, getPaperByToken, setShareToken, saveSubmission, listSubmissions, submissionCount, saveHistory,
  indexPaperIntoBank, removeBankForPaper, searchBank, deleteBankItem, getBankItem,
} from './db.js';
import { extractPdfText, normalizePages, countWords } from './pdf.js';
import { structureSample, normaliseSample, fallbackSample } from './ingest.js';
import { computeStats, runAnalysis, analysisStale } from './analyze.js';
import { generateSet, MODES } from './generate.js';
import { buildDocx } from './docx.js';
import { renderPrintHtml } from './print.js';
import { markSubmission } from './mark.js';
import { ocrPdf, ocrImage, OCR_LANGUAGES } from './ocr.js';
import { getAIConfigStatus, setAIConfig, AIError, PROVIDERS, testAIConnection, friendlyAIError } from './ai.js';
import { QUESTION_TYPES, LEVELS, categoryMeta, typeLabel } from './question-types.js';
import {
  requireAuth, checkPassword, createSession, destroySession, cookieToken,
  sessionValid, setAuthCookie, clearAuthCookie, passwordSet, setWebPassword,
} from './auth.js';
import { randomBytes } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

/* Everything below requires login (when a password is set). Static files,
   /api/auth/*, /api/health and student share links stay open. */
app.use(requireAuth);

/* ---------------- web login ---------------- */
app.get('/api/auth/status', (req, res) => {
  res.json({ passwordSet: passwordSet(), authed: sessionValid(cookieToken(req)) });
});

app.post('/api/auth/login', (req, res) => {
  const { password = '' } = req.body || {};
  const r = checkPassword(password);
  if (!r.ok) {
    return res.status(401).json({
      error: r.locked ? `嘗試次數過多，請等 ${r.retryAfter} 秒再試 Too many attempts` : '密碼唔正確 Wrong password',
    });
  }
  setAuthCookie(res, createSession());
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(cookieToken(req));
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/password', (req, res) => {
  const { newPassword = '' } = req.body || {};
  if (String(newPassword).length < 4) {
    return res.status(400).json({ error: '密碼至少要 4 個字 Password must be at least 4 characters' });
  }
  setWebPassword(String(newPassword)); // clears every session…
  setAuthCookie(res, createSession());  // …but keeps THIS browser logged in
  res.json({ ok: true });
});

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
    if (/pdf$/i.test(file.mimetype) || /\.(pdf|jpe?g|png|docx)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('只接受 PDF、Word (.docx) 或圖片檔（掃描檔會自動 OCR）/ PDF, Word (.docx) or images only'));
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
      const ocrLang = getSetting('ocr_languages') || 'eng+chi_tra';

      if (/\.(jpe?g|png)$/i.test(row.filename)) {
        // Photo / scan of a page → straight to OCR.
        run(`UPDATE samples SET status = 'ocring' WHERE id = ?`, [id]);
        rawText = await ocrImage(buffer, { languages: ocrLang });
        pages = 1;
      } else if (/\.docx$/i.test(row.filename)) {
        // Word document → extract paragraphs directly (no OCR needed).
        const { extractDocxText } = await import('./office.js');
        rawText = await extractDocxText(buffer);
        pages = 1;
      } else {
        const extracted = await extractPdfText(buffer);
        pages = extracted.totalPages;
        rawText = normalizePages(extracted.pages);

        if (!rawText || rawText.replace(/\s/g, '').length < 60) {
          // Scanned PDF (image-only): render each page and OCR it.
          console.log(`[ingest] #${id} little text found — trying OCR…`);
          run(`UPDATE samples SET status = 'ocring' WHERE id = ?`, [id]);
          const ocrPages = await ocrPdf(buffer, { languages: ocrLang });
          const ocrText = normalizePages(ocrPages);
          if (ocrText.replace(/\s/g, '').length > (rawText || '').replace(/\s/g, '').length) rawText = ocrText;
        }
      }

      if (!rawText || rawText.replace(/\s/g, '').length < 40) {
        throw new Error('這份檔案抽不到文字（可能是圖片質素太低或並非文字檔）。可以試下：用文字版 PDF、上載清晰啲的相片、或者用「貼上文字」。');
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
  res.json({
    questionTypes: QUESTION_TYPES,
    levels: LEVELS,
    categories: categoryMeta(),  // per-language analysis taxonomies: { en: [...], zh: [groups] }
    ai: getAIConfigStatus(),
    providers: PROVIDERS,
    modes: MODES,
    ocrLanguages: OCR_LANGUAGES,
    ocrLanguage: getSetting('ocr_languages') || 'eng+chi_tra',
  });
});

app.get('/api/providers', (req, res) => res.json({ providers: PROVIDERS }));

app.get('/api/health', (req, res) => res.json({ ok: true, processed: processedSampleCount() }));

/* Camera diagnostics: the browser UI beacons camera milestones/errors here so
   failures in any browser can be diagnosed from the server side. */
const cameraLog = [];
app.post('/api/camera-log', (req, res) => {
  const { step = '', detail = '', ua = '' } = req.body || {};
  const entry = { at: new Date().toISOString(), step: String(step), detail: String(detail).slice(0, 300), ua: String(ua).slice(0, 160) };
  cameraLog.unshift(entry);
  if (cameraLog.length > 30) cameraLog.pop();
  console.log(`[camera] ${entry.step} ${entry.detail}`);
  res.json({ ok: true });
});
app.get('/api/camera-log', (req, res) => res.json({ events: cameraLog }));

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
    const result = await generateSet(req.body || {});
    res.json(result);
  } catch (err) { next(err); }
});

/* ------------------------- API: share & marking ------------------------- */

// Turn any paper into a student link (no answers shown, auto-marked).
app.post('/api/papers/:id/share', (req, res) => {
  const id = Number(req.params.id);
  const paper = getPaper(id);
  if (!paper) return res.status(404).json({ error: '找不到這份練習 (paper not found)' });
  let token = paper.share_token;
  if (!token) {
    token = randomBytes(6).toString('hex');
    setShareToken(id, token);
  }
  res.json({ token, url: `/s/${token}` });
});

// The student's view: passage + questions, NO answers.
app.get('/api/share/:token', (req, res) => {
  const paper = getPaperByToken(req.params.token);
  if (!paper) return res.status(404).json({ error: '連結無效或已取消 (invalid link)' });
  res.json({
    paper: {
      id: paper.id,
      title: paper.title,
      passage: paper.passage,
      wordCount: paper.word_count,
      language: paper.language,
      level: paper.params?.level,
      questions: (paper.questions || []).map((q) => ({
        no: q.no, type: q.type, label: typeLabel(q.type), marks: q.marks, instruction: q.instruction, stem: q.stem, options: q.options,
      })),
    },
  });
});

app.post('/api/share/:token/submit', (req, res) => {
  const paper = getPaperByToken(req.params.token);
  if (!paper) return res.status(404).json({ error: '連結無效或已取消 (invalid link)' });
  const answers = req.body?.answers || {};
  const student = String(req.body?.student || '').slice(0, 40);
  const marking = markSubmission(paper, answers);
  saveSubmission({ paperId: paper.id, student, answers, marking, score: marking.score, maxScore: marking.max });
  res.json({ score: marking.score, max: marking.max, perQuestion: marking.perQuestion });
});

// Teacher view: who has submitted and how they scored.
app.get('/api/papers/:id/submissions', (req, res) => {
  res.json({ submissions: listSubmissions(Number(req.params.id)) });
});

/* ------------------------- API: Word export ------------------------- */

app.get('/api/papers/:id/docx', async (req, res, next) => {
  try {
    const paper = getPaper(Number(req.params.id));
    if (!paper) return res.status(404).json({ error: '找不到這份練習 (paper not found)' });
    const version = req.query.version === 'teacher' ? 'teacher' : 'student';
    const layout = {
      lines: ['0', '1', '2', '3'].includes(String(req.query.lines)) ? String(req.query.lines) : 'auto',
      fontScale: ['90', '100', '110', '125'].includes(String(req.query.font)) ? Number(req.query.font) : 100,
      nameField: String(req.query.name || '') === '1',
    };
    const buffer = await buildDocx(paper, version, layout);
    const name = `${String(paper.title || 'comprehension').replace(/[\\/:*?"<>|]+/g, '_')}-${version}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

/* ----------------------------- API: history ----------------------------- */

app.get('/api/history', (req, res) => {
  const rows = all(`SELECT id, params, language, title, word_count, questions, source, error, created_at,
                           set_id, variant_no, quality, share_token
                    FROM history ORDER BY id DESC LIMIT 150`);
  res.json({
    items: rows.map((r) => {
      const quality = safeParse(r.quality, null);
      return {
        id: r.id,
        language: r.language,
        title: r.title,
        wordCount: r.word_count,
        questionCount: safeParse(r.questions, []).length,
        params: safeParse(r.params, {}),
        source: r.source,
        error: r.error,
        createdAt: r.created_at,
        setId: r.set_id,
        variantNo: r.variant_no,
        quality: quality ? { score: quality.score, issues: quality.issues || [], error: quality.error } : null,
        shareToken: r.share_token,
        submissions: submissionCount(r.id),
      };
    }),
  });
});

app.get('/api/history/:id', (req, res) => {
  const row = get('SELECT * FROM history WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: '找不到這份練習 (paper not found)' });
  const quality = safeParse(row.quality, null);
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
      setId: row.set_id,
      variantNo: row.variant_no,
      quality,
      shareToken: row.share_token,
      submissions: submissionCount(row.id),
    },
  });
});

app.delete('/api/history/:id', (req, res) => {
  run('DELETE FROM history WHERE id = ?', [Number(req.params.id)]);
  removeBankForPaper(Number(req.params.id)); // drop its questions from the bank too
  res.json({ ok: true });
});

/* ----------------------------- API: question bank ----------------------------- */

// Search the reusable question bank (built from every generated paper).
app.get('/api/bank', (req, res) => {
  const { language = '', level = '', q = '', page = 1, pageSize = 50 } = req.query;
  const types = String(req.query.types || '').split(',').map((s) => s.trim()).filter(Boolean);
  res.json(searchBank({ language, level, q, types, page: Number(page), pageSize: Number(pageSize) }));
});

// Remove a single question from the bank (does not touch the source paper).
app.delete('/api/bank/:id', (req, res) => {
  deleteBankItem(Number(req.params.id));
  res.json({ ok: true });
});

// Compose a brand-new paper from hand-picked bank questions.
app.post('/api/bank/compose', (req, res) => {
  const { title = '', items = [] } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: '請先選擇要加入的題目。' });
  const rows = items.map((it) => getBankItem(Number(it.id ?? it))).filter(Boolean);
  if (!rows.length) return res.status(400).json({ error: '找不到所選題目。' });

  const questions = rows.map((r, i) => ({
    no: i + 1, type: r.type, marks: r.marks || 1, instruction: r.instruction || '',
    stem: r.stem, options: r.options || [], answer: r.answer, explanation: r.explanation,
  }));
  const language = rows[0].language || 'en';
  const level = rows[0].level || 'p5';
  const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0);

  const paperId = saveHistory({
    params: { mode: 'compose', language, level, questionCount: questions.length, composed: true },
    language,
    title: String(title || '').trim() || `自組練習 Composed set (${questions.length} 題)`,
    passage: '',
    wordCount: 0,
    questions,
    source: 'compose',
  });
  const paper = getPaper(paperId);
  res.json({ paper, totalMarks });
});

/* ----------------------------- API: edit a paper ----------------------------- */

// Update a paper's questions / metadata in place (also re-seeds its bank entries).
app.patch('/api/papers/:id', (req, res) => {
  const id = Number(req.params.id);
  const paper = getPaper(id);
  if (!paper) return res.status(404).json({ error: '找不到這份練習 (paper not found)' });
  const { title, passage, notes, questions } = req.body || {};
  const qs = Array.isArray(questions)
    ? questions.map((q, i) => ({
        no: i + 1, type: q.type, marks: Number(q.marks) || 1, instruction: String(q.instruction || ''),
        stem: String(q.stem || ''), options: Array.isArray(q.options) ? q.options.map(String) : [],
        answer: String(q.answer || ''), explanation: String(q.explanation || ''),
      }))
    : paper.questions;
  run('UPDATE history SET title = ?, passage = ?, questions = ?, word_count = ? WHERE id = ?', [
    title != null ? String(title) : paper.title,
    passage != null ? String(passage) : paper.passage,
    JSON.stringify(qs),
    passage != null ? countWords(String(passage), paper.language) : (paper.word_count ?? paper.wordCount ?? 0),
    id,
  ]);
  // refresh this paper's bank entries so the bank matches the edited questions
  // (composed papers borrow existing items — never re-index them)
  if (paper.source !== 'compose') {
    removeBankForPaper(id);
    indexPaperIntoBank(id, paper.language, paper.params?.level || 'p5', qs);
  }
  res.json({ ok: true, paper: getPaper(id) });
});

/* ----------------------------- API: print layout ----------------------------- */

app.get('/api/papers/:id/print', (req, res) => {
  const paper = getPaper(Number(req.params.id));
  if (!paper) return res.status(404).send('找不到這份練習 (paper not found)');
  const version = req.query.version === 'teacher' ? 'teacher' : 'student';
  const lines = ['0', '1', '2', '3'].includes(String(req.query.lines)) ? String(req.query.lines) : 'auto';
  const fontScale = ['90', '100', '110', '125'].includes(String(req.query.font)) ? String(req.query.font) : '100';
  const html = renderPrintHtml(paper, { version, lines, fontScale });
  res.type('html').send(html);
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

// OCR language for scanned papers / photos.
app.post('/api/config/ocr', (req, res) => {
  const language = String(req.body?.language || 'eng+chi_tra');
  setSetting('ocr_languages', language);
  res.json({ ocrLanguage: language });
});

/* ------------------------- student worksheet page ------------------------- */

app.get('/s/:token', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'student.html'));
});

/* ----------------------- startup: backfill question bank ----------------------- */
// Papers created before the bank existed (or whose questions were edited) get indexed once.
function backfillBank() {
  const rows = all(`SELECT h.id, h.language, h.params, h.questions, h.source FROM history h WHERE h.error IS NULL`);
  let added = 0;
  for (const row of rows) {
    const questions = safeParse(row.questions, []);
    if (!questions.length) continue;
    const params = safeParse(row.params, {});
    // only index original papers that have no bank rows yet
    if (row.source === 'compose') continue;
    const already = Number(get('SELECT COUNT(*) AS c FROM bank_items WHERE paper_id = ?', [row.id])?.c || 0);
    if (already) continue;
    added += indexPaperIntoBank(row.id, row.language, params.level || 'p5', questions).length;
  }
  if (added) console.log(`[bank] backfilled ${added} questions into the question bank`);
}
backfillBank();

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
