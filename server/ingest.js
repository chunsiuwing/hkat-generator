// Step 1 of "AI maintains the database": turn an uploaded PDF's raw text into a structured sample.
import { chatJSON } from './ai.js';
import { LEVELS, typeIdsFor, fallbackTypeFor, EN_TO_ZH_TYPE, EN_CATEGORIES, ZH_CATEGORIES } from './question-types.js';
import { countWords } from './pdf.js';

export function structurePrompt(rawText) {
  const enList = EN_CATEGORIES.map((t) => `  - "${t.id}" = ${t.en} / ${t.zh} — ${t.descEn}`).join('\n');
  const zhList = ZH_CATEGORIES.map((t) => `  - "${t.id}" = ${t.zh} — ${t.descZh}`).join('\n');
  const levelList = LEVELS.map((l) => `  - "${l.id}" = ${l.en} (${l.zh})`).join('\n');

  return {
    system: `You are an expert Hong Kong primary school English/Chinese reading-comprehension editor.
You extract a clean, faithful digital copy of ONE HKAT-style comprehension exercise from messy PDF text.
Rules:
- NEVER invent or rewrite content. Copy the passage and questions exactly as they appear (you may fix obvious PDF line-break/hyphen artefacts and spacing).
- If the PDF holds several exercises, use the FIRST complete one (one passage + its questions).
- Detect the language of the passage: "en" (English) or "zh" (Chinese).
- Detect the level from the content difficulty: "p4", "p5", "p6" or "unknown".
- Classify every question with exactly one type id from the list matching the passage's language.
  ENGLISH passages — use ONLY these ids:
${enList}
  CHINESE passages — use ONLY these ids (HKAT 中文閱讀理解分類):
${zhList}
- Levels: 
${levelList}
- Keep every answer key / marking scheme that appears in the PDF.
Reply with ONLY a JSON object of this shape:
{
  "language": "en" | "zh",
  "level": "p4" | "p5" | "p6" | "unknown",
  "title": "short title you infer from the topic",
  "topic": "main topic in 2-5 words",
  "passage": "the full passage text, paragraphs separated by \\n\\n",
  "questions": [
    { "no": 1, "type": "cloze", "marks": 1, "instruction": "wording shown in the paper", "stem": "question sentence", "options": ["A", "B", "C"], "answer": "answer from the key", "explanation": "" }
  ],
  "style_notes": "1-2 sentences: how this paper words its instructions, allocates marks, and formats answers"
}`,
    user: `以下是從 HKAT comprehension PDF 抽取的文字（可能有雜訊）。請整理成 JSON。\n\n--- PDF TEXT START ---\n${rawText.slice(0, 24000)}\n--- PDF TEXT END ---`,
  };
}

/** Deterministic fallback when the AI is unavailable: keep the raw text so nothing is lost. */
export function fallbackSample(rawText) {
  return {
    language: /[\u4e00-\u9fff]/.test(rawText.slice(0, 400)) ? 'zh' : 'en',
    level: 'unknown',
    title: '',
    topic: '',
    passage: rawText.slice(0, 20000),
    questions: [],
    style_notes: '',
  };
}

export function normaliseSample(parsed, rawText) {
  const language = parsed.language === 'zh' ? 'zh' : parsed.language === 'en' ? 'en' : (/[\u4e00-\u9fff]/.test((parsed.passage || '').slice(0, 200)) ? 'zh' : 'en');
  const level = LEVELS.some((l) => l.id === parsed.level) ? parsed.level : 'unknown';
  const passage = String(parsed.passage || '').trim() || rawText.slice(0, 20000).trim();
  const valid = typeIdsFor(language);
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.map((q, i) => ({
        no: Number(q.no) || i + 1,
        // Accept only ids from the language's own taxonomy; map legacy 8-type ids for Chinese.
        type: valid.includes(q.type)
          ? q.type
          : language === 'zh' && EN_TO_ZH_TYPE[q.type]
            ? EN_TO_ZH_TYPE[q.type]
            : fallbackTypeFor(language),
        marks: Number(q.marks) || 1,
        instruction: String(q.instruction || ''),
        stem: String(q.stem || q.question || ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        answer: String(q.answer || ''),
        explanation: String(q.explanation || ''),
      }))
    : [];
  const types = [...new Set(questions.map((q) => q.type))];
  return {
    language,
    level,
    title: String(parsed.title || '').trim(),
    topic: String(parsed.topic || '').trim(),
    passage,
    wordCount: countWords(passage, language),
    questions,
    questionTypes: types,
    styleNotes: String(parsed.style_notes || parsed.styleNotes || '').trim(),
  };
}

export async function structureSample(rawText) {
  const prompt = structurePrompt(rawText);
  const parsed = await chatJSON({
    system: prompt.system,
    user: prompt.user,
    temperature: 0.2,
    maxTokens: 6000,
    mock: () => mockStructuredSample(rawText),
  });
  return normaliseSample(parsed, rawText);
}

/* ------------------- mock data (MOCK_AI=1) ------------------- */

export function mockStructuredSample(rawText) {
  const isCJK = /[\u4e00-\u9fff]/.test(rawText.slice(0, 400));
  if (isCJK) {
    return {
      language: 'zh', level: 'p5', title: '難忘的生日會', topic: '家庭 生日',
      passage: '上星期六是奶奶的七十歲生日……\n\n一大早，媽媽便到街市買菜……',
      questions: [
        { no: 1, type: 'detail_facts', marks: 2, instruction: '根據文章，回答下列問題。', stem: '家人怎樣為奶奶準備生日會？', options: [], answer: '他們買菜、訂蛋糕和佈置客廳。', explanation: '' },
        { no: 2, type: 'pronoun_ref', marks: 1, instruction: '「它」在文中指的是甚麼？', stem: '第三段中的「它」指的是甚麼？', options: [], answer: '生日蛋糕', explanation: '' },
        { no: 3, type: 'word_meaning', marks: 1, instruction: '解釋下列詞語在文中的意思。', stem: '「欣喜」在文中的意思是甚麼？', options: [], answer: '高興、開心', explanation: '' },
      ],
      style_notes: '題目用語簡潔，每題 1–2 分。',
    };
  }
  return {
    language: 'en', level: 'p5', title: 'The Lost Umbrella', topic: 'a rainy day story',
    passage: 'It was pouring with rain when Mei left school……\n\nShe looked left and right, but the umbrella was gone……',
    questions: [
      { no: 1, type: 'cloze', marks: 1, instruction: 'Choose the correct answer.', stem: 'Mei left school _____.', options: ['early', 'late', 'in sunshine'], answer: 'early', explanation: '' },
      { no: 2, type: 'true', marks: 1, instruction: 'Write T (true) or F (false).', stem: 'Mei found her umbrella under the bench.', options: [], answer: 'F', explanation: '' },
      { no: 3, type: 'unfamiliar_word', marks: 1, instruction: 'What does the word mean?', stem: 'What does "pouring" mean?', options: [], answer: 'falling heavily', explanation: '' },
    ],
    style_notes: 'Instructions are short; one mark per objective question.',
  };
}
