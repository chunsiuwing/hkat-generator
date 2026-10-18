// Step 3: generate brand-new comprehension papers in the database's style.
// Modes: single paper · 3 variants · same story at P4/P5/P6 (differentiated set).
import { randomUUID } from 'node:crypto';
import { chatJSON } from './ai.js';
import { TYPE_IDS, LEVELS } from './question-types.js';
import { getSamplesForPrompt, getAnalysis, saveHistory } from './db.js';
import { countWords } from './pdf.js';
import { selfCheck } from './quality.js';

const LANG_NAMES = { en: 'English', zh: 'Chinese (繁體中文)' };
const LEVEL_WORDS = { p4: 0.72, p5: 1, p6: 1.3 };

export const MODES = {
  single: { label: '單份 Single paper', papers: 1 },
  variants: { label: '3 份變體 3 variants', papers: 3 },
  levels: { label: '分程度 P4 / P5 / P6 set', papers: 3 },
};

export function validateParams(params) {
  const errors = [];
  const language = params.language === 'zh' ? 'zh' : 'en';
  const level = LEVELS.some((l) => l.id === params.level) ? params.level : 'p5';
  const wordLength = Math.min(900, Math.max(100, Number(params.wordLength) || 250));
  const questionCount = Math.min(20, Math.max(1, Number(params.questionCount) || 5));
  const types = (Array.isArray(params.types) ? params.types : []).filter((t) => TYPE_IDS.includes(t));
  if (!types.length) errors.push('請至少選擇一種題型 (Choose at least one question type).');
  const mode = MODES[params.mode] ? params.mode : 'single';
  return {
    language,
    level,
    topic: String(params.topic || '').trim(),
    theme: String(params.theme || '').trim(),
    wordLength,
    questionCount,
    types,
    extra: String(params.extra || '').trim(),
    mode,
    selfCheck: params.selfCheck !== false,
    errors,
  };
}

function typeGuide(types, language) {
  const zh = {
    cloze: '選詞填空：句子中挖空，學生從 3 個選項選出正確答案（提供 options）。',
    sequencing: '事件排序：把 4–5 個事件／步驟打亂，學生寫出正確次序（items 用 options 列出，如 "A. …"）。',
    true: '是非題（True）：根據文章「正確」的陳述，學生寫 T。',
    not_true: '錯處更正（Not True）：根據文章「不正確」的陳述，學生寫 F，並在 answer 寫出正確的句子。',
    referencing: '代詞指涉：問「它／這／他們」指的是甚麼。',
    keywords: '關鍵詞作答：簡答題，answer 必須包含文中的關鍵詞。',
    connection: '內意連結：問事件、原因或意思之間的關係（為甚麼／所以／怎樣）。',
    unfamiliar_word: '生詞詞義：解釋生詞在文中的意思。',
  };
  const en = {
    cloze: 'Cloze: a sentence from the passage with a gap; student picks the correct option (provide options).',
    sequencing: 'Sequencing: 4–5 events/steps out of order; student numbers them correctly (list the items as options "A. …", "B. …").',
    true: 'True question: a statement that IS true according to the passage; the student writes "T".',
    not_true: 'Not true question: a statement that is NOT true; the student writes "F" and the "answer" gives the corrected sentence.',
    referencing: 'Referencing: what a pronoun or "this/that" refers to.',
    keywords: 'Keywords: short answer; the "answer" must contain the key words from the passage.',
    connection: 'Connection between ideas: how ideas/reasons/events are linked (why / so / how).',
    unfamiliar_word: 'Unfamiliar word: the meaning of a difficult word as used in the passage.',
  };
  const dict = language === 'zh' ? zh : en;
  return types.map((t) => `- "${t}": ${dict[t]}`).join('\n');
}

export function buildPrompt(p, { hint = '', basePaper = null } = {}) {
  const lang = LANG_NAMES[p.language];
  const level = LEVELS.find((l) => l.id === p.level);
  const profile = getAnalysis();
  const profileText = profile?.profile
    ? JSON.stringify(profile.profile).slice(0, 9000)
    : '(尚未分析資料庫 — the database has not been analysed yet; use standard HKAT conventions)';
  const refs = basePaper ? [] : getSamplesForPrompt({ language: p.language, level: p.level, types: p.types, topic: p.topic });

  const refText = refs.length
    ? `Real samples from the database (use them ONLY as a style reference — do NOT copy their story, characters or wording):\n\n${refs
        .map((r) => {
          let qs = [];
          try { qs = JSON.parse(r.questions || '[]'); } catch { qs = []; }
          return `### ${r.title || r.filename} (level ${r.level}, ${r.word_count} words)\n${(r.passage_text || '').slice(0, 1200)}\nQuestions: ${qs
            .slice(0, 5)
            .map((q) => `[${q.type}] ${q.stem}${q.options?.length ? ` (${q.options.join(' / ')})` : ''} → ${q.answer}`)
            .join(' | ')}`;
        })
        .join('\n\n')}`
    : 'No reference samples are available — follow the style profile and standard HKAT conventions.';

  const rewriteText = basePaper
    ? `You are writing ANOTHER VERSION of an existing paper (same story world, different difficulty).
Use this paper as your source — keep the same characters, events and theme, but rewrite for the new level.
Mark it clearly as a rewrite: do NOT copy sentences verbatim; change sentence structure and vocabulary to suit the level.

SOURCE PAPER (level ${basePaper.params?.level}, ${basePaper.wordCount} words):
Title: ${basePaper.title}
${String(basePaper.passage || '').slice(0, 3500)}`
    : '';

  return {
    system: `You are a Hong Kong primary school comprehension writer who has written many HKAT-style papers.
You write a COMPLETE, publication-ready reading comprehension in ${lang} for ${level.en} (${level.zh}).
Hard rules:
1. The passage must be original fiction/non-fiction — NEVER copy the reference samples' plots, names or sentences.
2. Length: about ${p.wordLength} words (allow ±10%). Chinese is measured in characters/words; keep close to the target.
3. Difficulty must match ${level.en}: vocabulary, sentence length, ideas and inference load.
4. Write exactly ${p.questionCount} questions in total, using ONLY these types, in a sensible paper order (objective first, then short answer):
${typeGuide(p.types, p.language)}
   Distribute the types sensibly; if a type needs 2+ questions for a balanced paper, that is fine.
5. Every question must be answerable from the passage alone. Answers must be exact and unambiguous.
6. Give marks per question (1–3) so the total is realistic.
7. Number questions 1..${p.questionCount}. Give a short instruction line for each question or question group.
8. Write "explanation" for each question: why the answer is correct, in one sentence (same language as the passage).
9. Answers live inside each question's "answer" field — do not add a separate answer section.
10. ${p.extra || 'No extra requirements.'}
${hint ? `11. IMPORTANT: ${hint}` : ''}

Reply with ONLY this JSON object:
{
  "title": "title in the same language",
  "passage": "the full passage, paragraphs separated by \\n\\n",
  "word_count": <actual number>,
  "questions": [
    { "no": 1, "type": "${p.types[0]}", "marks": 1, "instruction": "…", "stem": "…", "options": ["…"], "answer": "…", "explanation": "…" }
  ],
  "notes": "1-2 sentences telling the teacher what to watch for when marking"
}`,
    user: `請為老師生成一份全新的 HKAT 閱讀理解。
Generate a brand-new HKAT reading comprehension.

Language: ${lang}
Level: ${level.en} (${level.zh})
Theme / topic: ${p.topic || '(teacher did not specify — choose a sensible HK primary school topic)'}
Teacher's notes about the passage: ${p.theme || '(none)'}
Target length: ${p.wordLength} words
Number of questions: ${p.questionCount}
Question types: ${p.types.join(', ')}

Style profile of the teacher's own sample database:
${profileText}

${rewriteText ? rewriteText + '\n\n' : ''}${refText}`,
    mock: () => mockPaper(p),
  };
}

function normalisePaper(data, p) {
  const questions = (Array.isArray(data.questions) ? data.questions : []).map((q, i) => ({
    no: Number(q.no) || i + 1,
    type: TYPE_IDS.includes(q.type) ? q.type : p.types[i % p.types.length],
    marks: Number(q.marks) || 1,
    instruction: String(q.instruction || ''),
    stem: String(q.stem || q.question || ''),
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    answer: String(q.answer || ''),
    explanation: String(q.explanation || ''),
  }));

  const passage = String(data.passage || '').trim();
  if (!passage || !questions.length) {
    const err = new Error('AI 返回的內容不完整（生成失敗），請再試一次。 (The AI returned an incomplete paper — please try again.)');
    err.status = 502;
    throw err;
  }

  return {
    title: String(data.title || p.topic || 'Reading Comprehension'),
    passage,
    wordCount: countWords(passage, p.language) || Number(data.word_count) || 0,
    questions,
    notes: String(data.notes || ''),
  };
}

async function generateOne(p, options = {}) {
  const prompt = buildPrompt(p, options);
  const data = await chatJSON({
    system: prompt.system,
    user: prompt.user,
    temperature: 0.8,
    maxTokens: 6000,
    timeoutMs: 300000,
    mock: prompt.mock,
  });
  const paper = normalisePaper(data, p);
  paper.params = p;
  paper.language = p.language;
  return paper;
}

const VARIANT_HINTS = [
  'This is version 1 of 3. Make the setting, characters and events completely your own (e.g. a school/sport/shop/animal story).',
  'This is version 2 of 3. Use a DIFFERENT genre and setting from a typical school story — e.g. science, nature, community, food, technology, or a personal-holiday narrative. Different characters, different events.',
  'This is version 3 of 3. Again choose a different world from the other two: e.g. an outdoor/adventure, friendship-problem, or how-something-works explanatory text. Different characters, different events.',
];

function levelPlans(p) {
  const unique = [p.level, ...['p4', 'p5', 'p6'].filter((lv) => lv !== p.level)];
  return unique.map((lv) => ({
    params: { ...p, level: lv, wordLength: Math.round((p.wordLength * (LEVEL_WORDS[lv] || 1)) / 10) * 10 },
    label: LEVELS.find((l) => l.id === lv)?.zh || lv,
    hint: lv === p.level ? '' : 'Keep the same story, characters and events as the source paper, but re-tell it at this new level: simpler/shorter sentences and easier words for a lower level; more complex sentences, richer vocabulary and deeper inference for a higher level. Write a fresh set of questions at the new level.',
  }));
}

/** Generate 1 or 3 papers, self-check each, save as one set, return them. */
export async function generateSet(rawParams) {
  const p = validateParams(rawParams);
  if (p.errors.length) {
    const err = new Error(p.errors.join(' '));
    err.status = 400;
    throw err;
  }

  let plans;
  if (p.mode === 'variants') {
    plans = VARIANT_HINTS.map((hint, i) => ({ params: p, hint, label: `變體 ${i + 1} Variant ${i + 1}` }));
  } else if (p.mode === 'levels') {
    plans = levelPlans(p);
  } else {
    plans = [{ params: p, label: '' }];
  }

  const setId = randomUUID();
  const papers = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const paper = await generateOne(plan.params, {
      hint: plan.hint,
      basePaper: p.mode === 'levels' && i > 0 ? papers[0] : null,
    });

    if (p.selfCheck) {
      try {
        paper.quality = await selfCheck(paper, plan.params);
      } catch (err) {
        paper.quality = { error: String(err?.message || err).slice(0, 200) };
      }
    }

    paper.setId = setId;
    paper.variantNo = i + 1;
    paper.variantLabel = plan.label;
    paper.id = saveHistory({
      params: plan.params,
      language: plan.params.language,
      title: paper.title,
      passage: paper.passage,
      wordCount: paper.wordCount,
      questions: paper.questions,
      source: 'ai',
      setId,
      variantNo: i + 1,
      quality: paper.quality || null,
    });
    papers.push(paper);
  }

  return { setId, papers, params: p, mode: p.mode };
}

/* ------------------- mock paper (MOCK_AI=1) ------------------- */

function mockPaper(p) {
  const isZh = p.language === 'zh';
  const questions = Array.from({ length: p.questionCount }, (_, i) => {
    const type = p.types[i % p.types.length];
    const no = i + 1;
    if (isZh) {
      return {
        no, type, marks: type === 'keywords' || type === 'connection' ? 2 : 1,
        instruction: type === 'cloze' ? '選擇最適當的答案。' : '根據文章，回答下列問題。',
        stem: `（模擬題目）第 ${no} 題 — 請設定 API Key 以產生真實題目。`,
        options: type === 'cloze' || type === 'sequencing' ? ['A. 選項一', 'B. 選項二', 'C. 選項三'] : [],
        answer: type === 'true' ? 'T' : type === 'not_true' ? 'F：正確句子……' : '（答案）',
        explanation: '模擬答案。',
      };
    }
    return {
      no, type, marks: type === 'keywords' || type === 'connection' ? 2 : 1,
      instruction: type === 'cloze' ? 'Choose the correct answer.' : type === 'true' ? 'Write T (true) or F (false).' : 'Answer the questions according to the passage.',
      stem: `(Mock question ${no}) Set an API key in Settings to generate a real paper.`,
      options: type === 'cloze' || type === 'sequencing' ? ['option A', 'option B', 'option C'] : [],
      answer: type === 'true' ? 'T' : type === 'not_true' ? 'F: corrected sentence…' : '(answer)',
      explanation: 'Mock answer.',
    };
  });

  const target = p.wordLength;
  const para = isZh
    ? '（這是模擬段落。）老師請到「⚙️ 設定」貼上 OpenAI 相容的 API Key，程式便會按照資料庫的風格，為你生成真正的文章和題目。'
    : '(This is a mock paragraph.) Go to Settings and paste an OpenAI-compatible API key to generate a real passage and questions in your database style.';
  const repeats = Math.max(1, Math.round(target / (isZh ? 40 : 60)));
  const passage = Array.from({ length: Math.min(repeats, 12) }, () => para).join('\n\n');

  return {
    title: isZh ? `模擬文章：${p.topic || '未命名'}` : `Mock passage: ${p.topic || 'untitled'}`,
    passage,
    word_count: countWords(passage, p.language),
    questions,
    notes: isZh ? '這是模擬版本，只用來測試介面。' : 'Mock version — interface test only.',
  };
}
