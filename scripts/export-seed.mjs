/* Export the shareable parts of the database as seed/seed.json, so other
   teachers who clone the repo get them automatically on first run.

   EXCLUDED on purpose (never uploaded to GitHub):
     - settings     → contains the personal API key
     - submissions  → contains student answers
     - share_token  → personal share links (also has a UNIQUE index)

   Run after adding new samples / papers / bank items:  npm run seed:export   */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const tables = {
  samples: db.prepare('SELECT * FROM samples').all(),
  analysis: db.prepare('SELECT * FROM analysis').all(),
  history: db.prepare(
    `SELECT id, params, language, title, passage, word_count, questions, source,
            error, set_id, variant_no, quality, created_at
     FROM history ORDER BY id`
  ).all(),
  bank_items: db.prepare('SELECT * FROM bank_items ORDER BY id').all(),
};

const seed = {
  version: 1,
  exportedAt: new Date().toISOString(),
  note: 'Shared seed data — samples style library, generated papers and question bank. Does NOT include settings (API key) or submissions (student answers).',
  counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
  tables,
};

mkdirSync(join(ROOT, 'seed'), { recursive: true });
const out = join(ROOT, 'seed', 'seed.json');
writeFileSync(out, JSON.stringify(seed), 'utf8');
console.log('seed written:', out);
console.log('counts:', JSON.stringify(seed.counts));
