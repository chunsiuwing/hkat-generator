// Step 2: "AI analyses the database" — a style profile that guides every generation.
// English and Chinese samples are analysed with DIFFERENT question taxonomies:
//   en → 8 original types + main_idea / inferring / others
//   zh → HKAT 4-group, 12-category taxonomy (see question-types.js)
import { chatJSON } from './ai.js';
import { all, processedSampleCount } from './db.js';
import { countWords } from './pdf.js';
import { EN_CATEGORIES, ZH_CATEGORY_GROUPS, ZH_CATEGORIES, typeIdsFor } from './question-types.js';

// Bump when the taxonomies change, so stored profiles re-analyse automatically.
export const TAXONOMY_VERSION = 2;

/** Deterministic statistics computed straight from the DB (also shown in the UI). */
export function computeStats() {
  const rows = all(`SELECT * FROM samples WHERE status = 'processed'`);
  const zeroTypes = (list) => Object.fromEntries(list.map((t) => [t.id, 0]));
  const stats = {
    total: rows.length,
    byLanguage: { en: 0, zh: 0 },
    byLevel: { p4: 0, p5: 0, p6: 0, unknown: 0 },
    // Question-type distribution uses each language's OWN taxonomy.
    byType: { en: zeroTypes(EN_CATEGORIES), zh: zeroTypes(ZH_CATEGORIES) },
    passages: [],
  };

  for (const r of rows) {
    stats.byLanguage[r.language] = (stats.byLanguage[r.language] || 0) + 1;
    stats.byLevel[r.level] = (stats.byLevel[r.level] || 0) + 1;
    let types = [];
    try { types = JSON.parse(r.question_types || '[]'); } catch { types = []; }
    const bucket = stats.byType[r.language] || stats.byType.en;
    for (const t of types) if (t in bucket) bucket[t] += 1;
    stats.passages.push({
      id: r.id,
      title: r.title,
      topic: r.topic,
      language: r.language,
      level: r.level,
      wordCount: r.word_count,
      questionCount: r.question_count,
      types,
    });
  }
  return stats;
}

function passageStatsFor(rows) {
  const out = [];
  for (const r of rows) {
    const text = r.passage_text || '';
    const sentences = text.split(/(?<=[.!?。！？])\s*/).filter((s) => s.trim().length > 3);
    out.push({
      words: countWords(text, r.language),
      sentences: sentences.length || 1,
      avgSentenceWords: sentences.length ? Math.round(countWords(text, r.language) / sentences.length) : 0,
      paragraphs: (text.match(/\n\n/g) || []).length + 1,
      questions: r.question_count,
      types: JSON.parse(r.question_types || '[]'),
    });
  }
  const avg = (arr, f) => (arr.length ? Math.round((arr.reduce((s, x) => s + f(x), 0) / arr.length) * 10) / 10 : 0);
  return {
    count: rows.length,
    avgWords: avg(out, (o) => o.words),
    minWords: out.length ? Math.min(...out.map((o) => o.words)) : 0,
    maxWords: out.length ? Math.max(...out.map((o) => o.words)) : 0,
    avgSentenceWords: avg(out, (o) => o.avgSentenceWords),
    avgParagraphs: avg(out, (o) => o.paragraphs),
    avgQuestions: avg(out, (o) => o.questions),
  };
}

/** Short excerpts of the real samples, used to ground the AI analysis. */
function sampleExcerpts(rows, limit = 8) {
  return rows.slice(0, limit).map((r) => {
    let questions = [];
    try { questions = JSON.parse(r.questions || '[]'); } catch { questions = []; }
    const qText = questions
      .slice(0, 6)
      .map((q) => `   [${q.type}] ${q.instruction || ''} ${q.stem}${q.options?.length ? ` (${q.options.join(' / ')})` : ''} → ${q.answer}`)
      .join('\n');
    return `### ${r.title || r.filename} (level ${r.level}, ${r.word_count} words)\nTopic: ${r.topic}\nPassage excerpt: ${r.passage_text.slice(0, 700)}\nQuestions:\n${qText}\nStyle notes: ${r.style_notes}`;
  }).join('\n\n');
}

export function analysisPrompt(rows) {
  const byLang = { en: rows.filter((r) => r.language === 'en'), zh: rows.filter((r) => r.language === 'zh') };
  const langBlock = (lang, label) => {
    const list = byLang[lang];
    if (!list.length) return '';
    return `--- ${label} samples (${list.length}) ---\nStatistics:\n${JSON.stringify(passageStatsFor(list), null, 2)}\n\nSample passages & questions:\n${sampleExcerpts(list)}\n`;
  };

  const enList = EN_CATEGORIES.map((t) => `"${t.id}" = ${t.en} / ${t.zh}`).join(', ');
  const zhList = ZH_CATEGORIES.map((t) => `"${t.id}" = ${t.zh}`).join(', ');

  return {
    system: `You are a senior Hong Kong primary school English/Chinese curriculum specialist.
You study a database of REAL HKAT-style comprehension exercises and produce a precise "style profile" that another AI can use to write brand-new exercises in exactly the same style.
Be concrete and data-grounded. Use the statistics and samples given.

The two languages use DIFFERENT question taxonomies:
- ENGLISH question_patterns keys (use only these): ${enList}
- CHINESE question_patterns keys (use only these, grouped by theme):
${ZH_CATEGORY_GROUPS.map((g) => `  ${g.zh}: ${g.items.map((i) => `"${i.id}"`).join(', ')}`).join('\n')}

Reply with ONLY a JSON object:
{
  "_v": ${TAXONOMY_VERSION},
  "summary": "3-4 sentence overview of the database",
  "languages": ["en","zh"],
  "by_language": {
    "en": {
      "levels": { "p4": {"passage_features": "...", "vocabulary_range": ["word1","word2"], "sentence_length_guide": "..."}, "p5": {}, "p6": {} },
      "passage_guidance": "how long, how many paragraphs, tone, genre mix, topic areas seen in the samples",
      "question_patterns": {
        "cloze": {"share": "rough % of questions", "sample_stems": ["exact wording patterns seen"], "answer_format": "how answers are given", "notes": "..."},
        "main_idea": {}, "inferring": {}, "others": {}
      },
      "conventions": "numbering, instruction wording, marks allocation, answer-key format"
    },
    "zh": {
      "levels": { "p4": {"passage_features": "...", "vocabulary_range": ["詞1","詞2"], "sentence_length_guide": "..."}, "p5": {}, "p6": {} },
      "passage_guidance": "篇幅、段落、文體、常見主題（記敘／說明／描寫等）",
      "question_patterns": {
        "detail_facts": {"share": "大約百分比", "sample_stems": ["文中實際出現的題干句式"], "answer_format": "答案如何書寫", "notes": "..."},
        "main_idea": {}, "inference": {}, "character_feeling": {}, "rhetoric": {}
      },
      "conventions": "題號、題干用語、分數分配、答案格式"
    }
  }
}
Only include question_patterns entries for categories that actually appear in the samples (or clearly belong to the school's style).`,
    user: `以下是資料庫中的真實 HKAT 樣本（真實統計與節錄）。請分析並產出風格檔。\n\n${langBlock('en', 'ENGLISH')}\n${langBlock('zh', 'CHINESE')}`,
  };
}

/**
 * Deterministic clean-up of the AI's profile: every question_patterns key must
 * belong to that language's OWN taxonomy, and languages without samples are dropped.
 * (The AI sometimes reuses English ids for Chinese patterns — we fix that here.)
 */
function sanitizeProfile(profile, rows) {
  if (!profile || typeof profile !== 'object' || !profile.by_language) return profile;
  const langsPresent = new Set(rows.map((r) => r.language));
  for (const [lang, block] of Object.entries(profile.by_language)) {
    if (!block || typeof block !== 'object') continue;
    if (!langsPresent.has(lang)) { delete profile.by_language[lang]; continue; }
    const valid = new Set(typeIdsFor(lang));
    const patterns = block.question_patterns || {};
    for (const key of Object.keys(patterns)) {
      if (!valid.has(key)) delete patterns[key];
    }
    block.question_patterns = patterns;
  }
  return profile;
}

/** Run (or re-run) the AI analysis of the whole database. */
export async function runAnalysis() {
  const rows = all(`SELECT * FROM samples WHERE status = 'processed' ORDER BY id DESC`);
  if (!rows.length) {
    const err = new Error('資料庫暫時沒有已處理的樣本。請先上載至少一份 HKAT comprehension PDF。 (No processed samples yet — upload a sample first.)');
    err.status = 400;
    throw err;
  }
  const prompt = analysisPrompt(rows);
  const profile = await chatJSON({
    system: prompt.system,
    user: prompt.user,
    temperature: 0.3,
    maxTokens: 5000,
    timeoutMs: 300000,
    mock: {
      summary: `資料庫目前有 ${rows.length} 份真實 HKAT 樣本。題目以短篇記敘文及說明文為主，題干用語直接，答案多為文中關鍵詞。 (Mock analysis — set a real API key for full analysis.)`,
      languages: [...new Set(rows.map((r) => r.language))],
      by_language: {},
    },
  });
  const languages = [...new Set(rows.map((r) => r.language))];
  sanitizeProfile(profile, rows);           // keep only valid per-language category ids
  profile._v = TAXONOMY_VERSION;            // marks which taxonomy generation this profile uses
  return { profile, sampleCount: rows.length, languages };
}

export function analysisStale() {
  const stored = all('SELECT sample_count, profile FROM analysis WHERE id = 1')[0];
  if (!stored) return true;
  if (stored.sample_count !== processedSampleCount()) return true;
  // A stored profile written with an older question taxonomy must be re-analysed.
  try {
    return JSON.parse(stored.profile || '{}')._v !== TAXONOMY_VERSION;
  } catch {
    return true;
  }
}
