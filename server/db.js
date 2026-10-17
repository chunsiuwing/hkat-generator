// SQLite database (built-in node:sqlite) — no native modules needed.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

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
  const scored = rows.map((r) => {
    let score = 0;
    if (language && r.language === language) score += 3;
    if (level && r.level === level) score += 3;
    let sampleTypes = [];
    try { sampleTypes = JSON.parse(r.question_types || '[]'); } catch { sampleTypes = []; }
    const overlap = types.filter((t) => sampleTypes.includes(t)).length;
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

export function saveHistory({ params, language, title, passage, wordCount, questions, source, error }) {
  const res = run(
    `INSERT INTO history (params, language, title, passage, word_count, questions, source, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [JSON.stringify(params), language, title, passage, wordCount, JSON.stringify(questions), source, error || null]
  );
  return res.lastInsertRowid;
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
