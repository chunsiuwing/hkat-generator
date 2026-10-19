// SQLite database (built-in node:sqlite) — no native modules needed.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN_TO_ZH_TYPE } from './question-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(__dirname, '..');
export const DATA_DIR = join(ROOT_DIR, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const dbPath = process.env.DB_PATH
  ? join(ROOT_DIR, process.env.DB_PATH)
  : join(DATA_DIR, 'app.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS samples (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  filename       TEXT NOT NULL,
  file_hash      TEXT NOT NULL UNIQUE,
  file_size      INTEGER DEFAULT 0,
  pages          INTEGER DEFAULT 0,
  raw_text       TEXT DEFAULT '',
  language       TEXT DEFAULT 'unknown',
  level          TEXT DEFAULT 'unknown',
  title          TEXT DEFAULT '',
  topic          TEXT DEFAULT '',
  passage_text   TEXT DEFAULT '',
  word_count     INTEGER DEFAULT 0,
  question_count INTEGER DEFAULT 0,
  question_types TEXT DEFAULT '[]',
  questions      TEXT DEFAULT '[]',
  style_notes    TEXT DEFAULT '',
  status         TEXT DEFAULT 'pending',
  error          TEXT,
  created_at     TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS analysis (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  profile      TEXT NOT NULL,
  sample_count INTEGER DEFAULT 0,
  languages    TEXT DEFAULT '[]',
  generated_at TEXT
);

CREATE TABLE IF NOT EXISTS history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  params     TEXT NOT NULL,
  language   TEXT DEFAULT 'en',
  title      TEXT DEFAULT '',
  passage    TEXT DEFAULT '',
  word_count INTEGER DEFAULT 0,
  questions  TEXT DEFAULT '[]',
  source     TEXT DEFAULT 'ai',
  error      TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  set_id     TEXT,
  variant_no INTEGER DEFAULT 1,
  quality    TEXT,
  share_token TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id    INTEGER NOT NULL,
  student     TEXT DEFAULT '',
  answers     TEXT DEFAULT '{}',
  marking     TEXT DEFAULT '{}',
  score       INTEGER DEFAULT 0,
  max_score   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS bank_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id    INTEGER NOT NULL,
  language    TEXT DEFAULT 'en',
  level       TEXT DEFAULT 'p5',
  type        TEXT DEFAULT 'keywords',
  marks       INTEGER DEFAULT 1,
  instruction TEXT DEFAULT '',
  stem        TEXT DEFAULT '',
  options     TEXT DEFAULT '[]',
  answer      TEXT DEFAULT '',
  explanation TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_bank_paper ON bank_items(paper_id);
CREATE INDEX IF NOT EXISTS idx_bank_lang_level ON bank_items(language, level);
CREATE INDEX IF NOT EXISTS idx_bank_type ON bank_items(type);
`);

/* --------------- migrations for databases created before v1.1 --------------- */
function addColumn(table, column, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch { /* already exists */ }
}
addColumn('history', 'set_id', 'TEXT');
addColumn('history', 'variant_no', 'INTEGER DEFAULT 1');
addColumn('history', 'quality', 'TEXT');
addColumn('history', 'share_token', 'TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_history_share ON history(share_token) WHERE share_token IS NOT NULL`);

/* ---------------- helpers ---------------- */

export const all = (sql, params = []) => db.prepare(sql).all(...params);
export const get = (sql, params = []) => db.prepare(sql).get(...params);
export const run = (sql, params = []) => db.prepare(sql).run(...params);

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value == null ? '' : String(value)]
  );
}

/* ---------------- domain queries ---------------- */

export function listSamples() {
  return all(
    `SELECT id, filename, pages, language, level, title, topic, word_count,
            question_count, question_types, status, error, created_at,
            substr(passage_text, 1, 220) AS passage_preview
     FROM samples ORDER BY id DESC`
  ).map(shapeSample);
}

export function getSample(id) {
  const row = get('SELECT * FROM samples WHERE id = ?', [id]);
  return row ? shapeSample(row) : null;
}

export function getSamplesForPrompt({ language, level, types = [], topic = '' }) {
  const rows = all(`SELECT * FROM samples WHERE status = 'processed' AND passage_text != ''`);
  const topicWords = topic.toLowerCase().split(/[\s,，。、]+/).filter((w) => w.length > 1);
  // Generation types are the original 8; Chinese samples are tagged with the Chinese
  // taxonomy, so map each requested type to its nearest Chinese equivalent too.
  const zhEquiv = new Set(types.map((t) => EN_TO_ZH_TYPE[t]).filter(Boolean));
  const scored = rows.map((r) => {
    let score = 0;
    if (language && r.language === language) score += 3;
    if (level && r.level === level) score += 3;
    let sampleTypes = [];
    try { sampleTypes = JSON.parse(r.question_types || '[]'); } catch { sampleTypes = []; }
    const overlap = types.filter((t) => sampleTypes.includes(t)).length
      + (r.language === 'zh' ? [...zhEquiv].filter((t) => sampleTypes.includes(t)).length : 0);
    score += overlap;
    const hay = `${r.topic} ${r.title} ${r.passage_text}`.toLowerCase();
    score += topicWords.filter((w) => hay.includes(w)).length * 2;
    return { row: r, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || b.row.id - a.row.id)
    .slice(0, 3)
    .map((s) => s.row);
}

export function processedSampleCount() {
  return get(`SELECT COUNT(*) AS n FROM samples WHERE status = 'processed'`)?.n ?? 0;
}

export function saveAnalysis(profile, sampleCount, languages) {
  run(
    `INSERT INTO analysis (id, profile, sample_count, languages, generated_at)
     VALUES (1, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(id) DO UPDATE SET
       profile = excluded.profile,
       sample_count = excluded.sample_count,
       languages = excluded.languages,
       generated_at = excluded.generated_at`,
    [JSON.stringify(profile), sampleCount, JSON.stringify(languages)]
  );
}

export function getAnalysis() {
  const row = get('SELECT * FROM analysis WHERE id = 1');
  if (!row) return null;
  let profile = null;
  try { profile = JSON.parse(row.profile); } catch { profile = null; }
  return { profile, sample_count: row.sample_count, languages: safeParse(row.languages, []), generated_at: row.generated_at };
}

export function saveHistory({ params, language, title, passage, wordCount, questions, source, error, setId = null, variantNo = 1, quality = null, shareToken = null }) {
  const res = run(
    `INSERT INTO history (params, language, title, passage, word_count, questions, source, error, set_id, variant_no, quality, share_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(params), language, title, passage, wordCount, JSON.stringify(questions), source, error || null,
      setId, variantNo, quality ? JSON.stringify(quality) : null, shareToken,
    ]
  );
  const paperId = Number(res.lastInsertRowid);
  // Every generated paper seeds the reusable question bank.
  // Composed papers borrow existing bank items — do NOT re-index them.
  if (source !== 'compose') indexPaperIntoBank(paperId, language, params?.level || 'p5', questions);
  return paperId;
}

/* ---------------- question bank ---------------- */

/** Save a paper's questions into the searchable bank. */
export function indexPaperIntoBank(paperId, language, level, questions) {
  const ids = [];
  for (const q of questions || []) {
    const res = run(
      `INSERT INTO bank_items (paper_id, language, level, type, marks, instruction, stem, options, answer, explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(paperId), language || 'en', level || 'p5', q.type || 'keywords', Number(q.marks) || 1,
        String(q.instruction || ''), String(q.stem || ''), JSON.stringify(q.options || []),
        String(q.answer || ''), String(q.explanation || ''),
      ]
    );
    ids.push(Number(res.lastInsertRowid));
  }
  return ids;
}

/** Remove bank entries that came from a paper (e.g. when it is deleted or re-indexed). */
export function removeBankForPaper(paperId) {
  const res = run('DELETE FROM bank_items WHERE paper_id = ?', [Number(paperId)]);
  return res.changes;
}

/** Search the bank. `types` is a Set/array of type ids to filter by (optional). */
export function searchBank({ language = '', level = '', q = '', types = [], page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (language) { where.push('b.language = ?'); params.push(language); }
  if (level) { where.push('b.level = ?'); params.push(level); }
  if (Array.isArray(types) && types.length) {
    where.push(`b.type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (q) { where.push('(b.stem LIKE ? OR b.answer LIKE ? OR b.instruction LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = Number(get(`SELECT COUNT(*) AS c FROM bank_items b ${whereSql}`, params)?.c || 0);
  const pageSizeNum = Math.min(200, Math.max(10, Number(pageSize) || 50));
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * pageSizeNum;
  const rows = all(
    `SELECT b.*, h.title AS source_title FROM bank_items b
     LEFT JOIN history h ON h.id = b.paper_id
     ${whereSql} ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSizeNum, offset]
  ).map((r) => ({
    id: r.id,
    paperId: r.paper_id,
    sourceTitle: r.source_title || '',
    language: r.language,
    level: r.level,
    type: r.type,
    marks: r.marks,
    instruction: r.instruction,
    stem: r.stem,
    options: safeParse(r.options, []),
    answer: r.answer,
    explanation: r.explanation,
    createdAt: r.created_at,
  }));
  return { items: rows, total, page: pageNum, pageSize: pageSizeNum };
}

export function getBankItem(id) {
  const r = get('SELECT * FROM bank_items WHERE id = ?', [Number(id)]);
  if (!r) return null;
  return {
    id: r.id, paperId: r.paper_id, language: r.language, level: r.level, type: r.type,
    marks: r.marks, instruction: r.instruction, stem: r.stem,
    options: safeParse(r.options, []), answer: r.answer, explanation: r.explanation,
  };
}

export function deleteBankItem(id) {
  const res = run('DELETE FROM bank_items WHERE id = ?', [Number(id)]);
  return res.changes;
}

/* ---------------- share links & student submissions ---------------- */

export function getPaper(id) {
  const row = get('SELECT * FROM history WHERE id = ?', [Number(id)]);
  return row ? shapePaper(row) : null;
}

export function getPaperByToken(token) {
  const row = get('SELECT * FROM history WHERE share_token = ?', [String(token || '')]);
  return row ? shapePaper(row) : null;
}

export function setShareToken(id, token) {
  run('UPDATE history SET share_token = ? WHERE id = ?', [token, Number(id)]);
  return token;
}

export function setPaperQuality(id, quality) {
  run('UPDATE history SET quality = ? WHERE id = ?', [quality ? JSON.stringify(quality) : null, Number(id)]);
}

export function saveSubmission({ paperId, student, answers, marking, score, maxScore }) {
  const res = run(
    `INSERT INTO submissions (paper_id, student, answers, marking, score, max_score) VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(paperId), String(student || ''), JSON.stringify(answers), JSON.stringify(marking), Number(score), Number(maxScore)]
  );
  return Number(res.lastInsertRowid);
}

export function listSubmissions(paperId) {
  return all('SELECT * FROM submissions WHERE paper_id = ? ORDER BY id DESC', [Number(paperId)]).map((r) => ({
    id: r.id,
    student: r.student,
    score: r.score,
    maxScore: r.max_score,
    answers: safeParse(r.answers, {}),
    marking: safeParse(r.marking, {}),
    createdAt: r.created_at,
  }));
}

export function submissionCount(paperId) {
  return get('SELECT COUNT(*) AS n FROM submissions WHERE paper_id = ?', [Number(paperId)])?.n ?? 0;
}

function shapePaper(row) {
  return {
    ...row,
    wordCount: row.word_count, // camelCase alias for API consumers
    params: safeParse(row.params, {}),
    questions: safeParse(row.questions, []),
    quality: safeParse(row.quality, null),
  };
}

function shapeSample(row) {
  return {
    ...row,
    question_types: safeParse(row.question_types, []),
    questions: safeParse(row.questions, []),
    passage_preview: row.passage_preview ?? (row.passage_text || '').slice(0, 220),
  };
}

export function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
