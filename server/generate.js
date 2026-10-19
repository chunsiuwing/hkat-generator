// Step 3: generate brand-new comprehension papers in the database's style.
// Modes: single paper · 3 variants · same story at P4/P5/P6 (differentiated set).
// Question types follow EACH language's own taxonomy (EN: 11, ZH: 12),
// and the teacher can set how many questions of each type.
import { randomUUID } from 'node:crypto';
import { chatJSON } from './ai.js';
import { LEVELS, EN_CATEGORIES, ZH_CATEGORIES, typeIdsFor } from './question-types.js';
import { getSamplesForPrompt, getAnalysis, saveHistory } from './db.js';
import { countWords } from './pdf.js';
import { selfCheck } from './quality.js';

const LANG_NAMES = { en: 'English', zh: 'Chinese (繁體中文)' };
const LEVEL_WORDS = { p4: 0.72, p5: 1, p6: 1.3 };
const MAX_PER_TYPE = 10;

export const MODES = {
  single: { label: '單份 Single paper', papers: 1 },
  variants: { label: '3 份變體 3 variants', papers: 3 },
  levels: { label: '分程度 P4 / P5 / P6 set', papers: 3 },
};

/* Per-type authoring instructions for the generation prompt. */
const GEN_GUIDE = {
  en: {
    cloze: 'a sentence from the passage with a gap; student picks the correct option (provide options).',
    sequencing: '4–5 events/steps out of order; student numbers them correctly (list the items as options "A. …", "B. …").',
    true: 'a statement that IS true according to the passage; the student writes "T".',
    not_true: 'a statement that is NOT true; the student writes "F" and the "answer" gives the corrected sentence.',
    referencing: 'what a pronoun or "this/that" refers to.',
    keywords: 'short answer; the "answer" must contain the key words from the passage.',
    connection: 'how ideas/reasons/events are linked (why / so / how).',
    unfamiliar_word: 'the meaning of a difficult word as used in the passage.',
    main_idea: "the overall message or the writer's main point (e.g. 'What is the passage mainly about?').",
    inferring: 'information not stated directly — students infer it from clues in the text.',
    others: 'any other sensible HKAT-style question that does not fit the categories above (e.g. a title question or an open response).',
  },
  zh: {
    word_meaning: '詞義辨析與替換：近義詞辨析、成語運用，或選出文中最適當的替換詞語（選擇題，提供 options）。',
    pronoun_ref: '指稱代詞理解：問「這／那／他們／此」具體指代前文的什麼內容或人物。',
    sentence_meaning: '句義／重組解析：句子的深層含義、修辭效果，或將句子重新排序（排列次序題）。',
    detail_facts: '細節尋找與直接事實題：從文中直接尋找時間、人物、地點、原因或結果等資訊。',
    true_false: '正誤判斷題：判斷敘述是否符合文意（是／否／未能確定），或選出正確／不正確選項。',
    info_organising: '訊息整理與填表／整合題：將事件起因經過結果、人物特徵或比較項整合填入圖表／結構（可用 options 呈現要填的項目）。',
    main_idea: '主旨與段意歸納：概括全篇或指定段落的核心思想（如「這篇文章的主旨是甚麼？」）。',
    structure_infer: '文章線索與結構推斷：段落間銜接關係、線索演變（時間／空間／事理順序）或段落作用。',
    inference: '深層推論（隱含意思）：根據字裏行間的線索推斷沒有直接透露的訊息（言外之意、隱藏原因）。',
    character_feeling: '人物性格與思想感情分析：分析人物性格特徵，或作者抒發的情感／態度（讚賞、諷刺、同情、反思）。',
    author_purpose: '寫作意圖與文章實用目的：判斷作者寫作此文的最終目的（勸誡、推廣、啟發思考、告知訊息）。',
    rhetoric: '修辭手法與寫作手法辨析：辨識並分析比喻、擬人、排比、對比、設問、反問等手法及其表達效果。',
  },
};

export function validateParams(params) {
  const errors = [];
  const language = params.language === 'zh' ? 'zh' : 'en';
  const level = LEVELS.some((l) => l.id === params.level) ? params.level : 'p5';
  const wordLength = Math.min(900, Math.max(100, Number(params.wordLength) || 250));
  const validIds = new Set(typeIdsFor(language));

  // Preferred input: { typeCounts: { typeId: count } }
  const typeCounts = {};
  if (params.typeCounts && typeof params.typeCounts === 'object' && !Array.isArray(params.typeCounts)) {
    for (const [id, n] of Object.entries(params.typeCounts)) {
      const c = Math.min(MAX_PER_TYPE, Math.max(0, Math.round(Number(n) || 0)));
      if (!validIds.has(id)) { errors.push(`題型「${id}」不屬於${language === 'zh' ? '中文' : '英文'}分類，已忽略。`); continue; }
      if (c > 0) typeCounts[id] = c;
    }
  } else {
    // Legacy input: types array (each 1 question) + questionCount distributed evenly.
    const types = (Array.isArray(params.types) ? params.types : []).filter((t) => validIds.has(t));
    if (types.length) {
      const total = Math.min(20, Math.max(types.length, Number(params.questionCount) || types.length));
      const each = Math.floor(total / types.length);
      let remainder = total - each * types.length;
      for (const t of types) { typeCounts[t] = each + (remainder-- > 0 ? 1 : 0); }
    }
  }
  if (!Object.keys(typeCounts).length) errors.push('請至少選擇一種題型，並設定題數。 (Choose at least one question type with a count.)');
  const questionCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  if (questionCount > 20) errors.push('總題數最多 20 題。 (Maximum 20 questions.)');

  const mode = MODES[params.mode] ? params.mode : 'single';
  const ownPassage = String(params.passage || '').trim();
  return {
    language,
    level,
    topic: String(params.topic || '').trim(),
    theme: String(params.theme || '').trim(),
    // Own-passage mode: word length follows the actual supplied text.
    wordLength: ownPassage ? (countWords(ownPassage, language) || wordLength) : wordLength,
    questionCount,
    typeCounts,
    types: Object.keys(typeCounts),
    extra: String(params.extra || '').trim(),
    mode,
    selfCheck: params.selfCheck !== false,
    // Own-passage mode: the teacher supplies the text; AI writes only questions.
    ownPassage: ownPassage ? true : false,
    passage: ownPassage || '',
    errors,
  };
}

function categoryLabel(language, id) {
  const list = language === 'zh' ? ZH_CATEGORIES : EN_CATEGORIES;
  const c = list.find((x) => x.id === id);
  return c ? `${c.zh}${c.en ? ` / ${c.en}` : ''}` : id;
}

function typeGuide(typeCounts, language) {
  const dict = GEN_GUIDE[language] || GEN_GUIDE.en;
  const labels = language === 'zh' ? ZH_CATEGORIES : EN_CATEGORIES;
  return Object.entries(typeCounts)
    .map(([id, n]) => {
      const label = labels.find((x) => x.id === id);
      const name = label ? `${label.zh}${label.en ? ` (${label.en})` : ''}` : id;
      return `- ${n} question${n > 1 ? 's' : ''} of type "${id}" — ${name}: ${dict[id] || 'an HKAT-style question.'}`;
    })
    .join('\n');
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

  const isOwn = !!p.ownPassage;
  const passageRules = isOwn
    ? `1. The teacher supplied the passage below — use it EXACTLY as given. Do NOT rewrite, paraphrase, shorten or "improve" it. Return it verbatim in the "passage" field.
2. Every question must be answerable from THIS passage alone — quote/reference it faithfully.
3. Judge the difficulty of the questions against ${level.en} (${level.zh}), but do not alter the text.`
    : `1. The passage must be original fiction/non-fiction — NEVER copy the reference samples' plots, names or sentences.
2. Length: about ${p.wordLength} words (allow ±10%). Chinese is measured in characters/words; keep close to the target.
3. Difficulty must match ${level.en}: vocabulary, sentence length, ideas and inference load.`;

  return {
    system: `You are a Hong Kong primary school comprehension writer who has written many HKAT-style papers.
You write a COMPLETE, publication-ready reading comprehension in ${lang} for ${level.en} (${level.zh}).
Hard rules:
${passageRules}
4. Question types use the ${p.language === 'zh' ? 'CHINESE HKAT taxonomy (語意與詞彙理解／內容擷取／結構主旨／深層推論賞析)' : 'ENGLISH taxonomy'} below. Write EXACTLY this many questions of each type — the counts must match precisely:
${typeGuide(p.typeCounts, p.language)}
   Total must be exactly ${p.questionCount} questions. Order them sensibly in the paper (objective/factual first, then deeper questions last).
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
    user: isOwn
      ? `老師已自備文章，請只為呢篇文章出題，千祈唔好改寫文章。
The teacher supplied their own passage. Write ONLY the questions for it; do NOT rewrite the text.

Language: ${lang}
Level: ${level.en} (${level.zh})
Number of questions: ${p.questionCount}
Question plan: ${Object.entries(p.typeCounts).map(([id, n]) => `${n}×${id}(${categoryLabel(p.language, id)})`).join(', ')}

Style profile of the teacher's own sample database:
${profileText}

TEACHER'S PASSAGE (use verbatim):
${p.passage}

${refText}`
      : `請為老師生成一份全新的 HKAT 閱讀理解。
Generate a brand-new HKAT reading comprehension.

Language: ${lang}
Level: ${level.en} (${level.zh})
Theme / topic: ${p.topic || '(teacher did not specify — choose a sensible HK primary school topic)'}
Teacher's notes about the passage: ${p.theme || '(none)'}
Target length: ${p.wordLength} words
Number of questions: ${p.questionCount}
Question plan: ${Object.entries(p.typeCounts).map(([id, n]) => `${n}×${id}(${categoryLabel(p.language, id)})`).join(', ')}

Style profile of the teacher's own sample database:
${profileText}

${rewriteText ? rewriteText + '\n\n' : ''}${refText}`,
    mock: () => mockPaper(p),
  };
}

function normalisePaper(data, p) {
  const validIds = new Set(typeIdsFor(p.language));
  const requested = Object.keys(p.typeCounts);
  const questions = (Array.isArray(data.questions) ? data.questions : []).map((q, i) => ({
    no: Number(q.no) || i + 1,
    type: validIds.has(q.type) ? q.type : requested[i % requested.length],
    marks: Number(q.marks) || 1,
    instruction: String(q.instruction || ''),
    stem: String(q.stem || q.question || ''),
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    answer: String(q.answer || ''),
    explanation: String(q.explanation || ''),
  }));

  // Own-passage mode: NEVER trust an AI echo of the teacher's text — use theirs verbatim.
  const passage = p.ownPassage ? p.passage : String(data.passage || '').trim();
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

// own-passage variants: same text, but write a DIFFERENT question set each time
const OWN_VARIANT_HINTS = [
  'Version 1 of 3: write a balanced question set covering a broad mix of the requested types.',
  'Version 2 of 3: write a DIFFERENT question set from version 1 — different items/details of the same passage, different wording; do not repeat v1 questions.',
  'Version 3 of 3: write another DIFFERENT question set again; avoid repeating v1 or v2 questions.',
];

function levelPlans(p) {
  const unique = [p.level, ...['p4', 'p5', 'p6'].filter((lv) => lv !== p.level)];
  if (p.ownPassage) {
    // Teacher supplied the text: keep it verbatim, only vary the question difficulty.
    return unique.map((lv) => ({
      params: { ...p, level: lv },
      label: LEVELS.find((l) => l.id === lv)?.zh || lv,
      hint: `The teacher-supplied passage must stay EXACTLY the same (do not rewrite it). Write a fresh set of ${p.questionCount} questions pitched at ${lv.toUpperCase()} level: for a lower level favour literal/detail questions with simpler wording; for a higher level add inference, structure and evaluation questions.`,
    }));
  }
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
    const hints = p.ownPassage ? OWN_VARIANT_HINTS : VARIANT_HINTS;
    plans = hints.map((hint, i) => ({ params: p, hint, label: `變體 ${i + 1} Variant ${i + 1}` }));
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
  // Expand the { type: count } plan into a flat list of types.
  const plan = Object.entries(p.typeCounts).flatMap(([id, n]) => Array.from({ length: n }, () => id));
  const questions = plan.map((type, i) => {
    const no = i + 1;
    if (isZh) {
      const objTypes = ['word_meaning', 'true_false', 'info_organising'];
      return {
        no, type, marks: ['detail_facts', 'inference', 'character_feeling'].includes(type) ? 2 : 1,
        instruction: objTypes.includes(type) ? '選擇最適當的答案。' : '根據文章，回答下列問題。',
        stem: `（模擬題目）第 ${no} 題 [${type}] — 請設定 API Key 以產生真實題目。`,
        options: objTypes.includes(type) ? ['A. 選項一', 'B. 選項二', 'C. 選項三'] : [],
        answer: type === 'true_false' ? 'T' : '（答案）',
        explanation: '模擬答案。',
      };
    }
    const objTypes = ['cloze', 'sequencing'];
    return {
      no, type, marks: ['keywords', 'connection', 'inferring', 'main_idea'].includes(type) ? 2 : 1,
      instruction: type === 'cloze' ? 'Choose the correct answer.' : type === 'true' ? 'Write T (true) or F (false).' : 'Answer the questions according to the passage.',
      stem: `(Mock question ${no} — ${type}) Set an API key in Settings to generate a real paper.`,
      options: objTypes.includes(type) ? ['option A', 'option B', 'option C'] : [],
      answer: type === 'true' ? 'T' : type === 'not_true' ? 'F: corrected sentence…' : '(answer)',
      explanation: 'Mock answer.',
    };
  });

  const target = p.wordLength;
  const para = isZh
    ? '（這是模擬段落。）老師請到「⚙️ 設定」貼上 OpenAI 相容的 API Key，程式便會按照資料庫的風格，為你生成真正的文章和題目。'
    : '(This is a mock paragraph.) Go to Settings and paste an OpenAI-compatible API key to generate a real passage and questions in your database style.';
  const repeats = Math.max(1, Math.round(target / (isZh ? 40 : 60)));
  const passage = p.ownPassage
    ? p.passage
    : Array.from({ length: Math.min(repeats, 12) }, () => para).join('\n\n');

  return {
    title: p.ownPassage
      ? (isZh ? '老師文章練習（模擬題目）' : 'Teacher passage practice (mock questions)')
      : (isZh ? `模擬文章：${p.topic || '未命名'}` : `Mock passage: ${p.topic || 'untitled'}`),
    passage,
    word_count: countWords(passage, p.language),
    questions,
    notes: isZh ? '這是模擬版本，只用來測試介面。' : 'Mock version — interface test only.',
  };
}
