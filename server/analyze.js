// Step 2: "AI analyses the database" — a style profile that guides every generation.
import { chatJSON } from './ai.js';
import { all, processedSampleCount } from './db.js';
import { countWords } from './pdf.js';
import { QUESTION_TYPES, LEVELS } from './question-types.js';

/** Deterministic statistics computed straight from the DB (also shown in the UI). */
export function computeStats() {
  const rows = all(`SELECT * FROM samples WHERE status = 'processed'`);
  const stats = {
    total: rows.length,
    byLanguage: { en: 0, zh: 0 },
    byLevel: { p4: 0, p5: 0, p6: 0, unknown: 0 },
    byType: Object.fromEntries(QUESTION_TYPES.map((t) => [t.id, 0])),
    passages: [],
  };

  for (const r of rows) {
    stats.byLanguage[r.language] = (stats.byLanguage[r.language] || 0) + 1;
    stats.byLevel[r.level] = (stats.byLevel[r.level] || 0) + 1;
    let types = [];
    try { types = JSON.parse(r.question_types || '[]'); } catch { types = []; }
    for (const t of types) if (t in stats.byType) stats.byType[t] += 1;
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

  return {
    system: `You are a senior Hong Kong primary school English/Chinese curriculum specialist.
You study a database of REAL HKAT-style comprehension exercises and produce a precise "style profile" that another AI can use to write brand-new exercises in exactly the same style.
Be concrete and data-grounded. Use the statistics and samples given. Reply with ONLY a JSON object:
{
  "summary": "3-4 sentence overview of the database",
  "languages": ["en","zh"],
  "by_language": {
    "en": {
      "levels": { "p4": {"passage_features": "...", "vocabulary_range": ["word1","word2"], "sentence_length_guide": "..."}, "p5": {}, "p6": {} },
      "passage_guidance": "how long, how many paragraphs, tone, genre mix, topic areas seen in the samples",
      "question_patterns": {
        "cloze": {"share": "rough % of questions", "sample_stems": ["exact wording patterns seen"], "answer_format": "how answers are given", "notes": "..."},
        "sequencing": {}, "true": {}, "not_true": {}, "referencing": {}, "keywords": {}, "connection": {}, "unfamiliar_word": {}
      },
      "conventions": "numbering, instruction wording, marks allocation, answer-key format"
    },
    "zh": { ...same structure... }
  }
}`,
    user: `以下是資料庫中的真實 HKAT 樣本（真實統計與節錄）。請分析並產出風格檔。\n\n${langBlock('en', 'ENGLISH')}\n${langBlock('zh', 'CHINESE')}`,
  };
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
  return { profile, sampleCount: rows.length, languages };
}

export function analysisStale() {
  const stored = all('SELECT sample_count FROM analysis WHERE id = 1')[0];
  return !stored || stored.sample_count !== processedSampleCount();
}

export { LEVELS };
