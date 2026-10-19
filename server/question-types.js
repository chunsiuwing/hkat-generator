// Canonical question types used across prompts, DB and UI.

/* ---------- Generation types (the 8 question kinds the teacher can request) ---------- */

export const QUESTION_TYPES = [
  {
    id: 'cloze', en: 'Cloze', zh: '選詞填空',
    descEn: 'Multiple-choice gap-fill taken from the passage.',
    descZh: '在句子中挖空，學生從選項中選出正確答案（選擇題）。',
  },
  {
    id: 'sequencing', en: 'Sequencing', zh: '事件排序',
    descEn: 'Put events, steps or sentences in the correct order.',
    descZh: '把事件、步驟或句子按文中的先後次序排列。',
  },
  {
    id: 'true', en: 'True question', zh: '是非題（True）',
    descEn: 'Statements that ARE true according to the passage — students write "T".',
    descZh: '根據文章「正確」的陳述，學生寫 T。',
  },
  {
    id: 'not_true', en: 'Not true question', zh: '錯處更正（Not True）',
    descEn: 'Statements that are NOT true — students write "F" and give the correct version.',
    descZh: '根據文章「不正確」的陳述，學生寫 F 並寫出正確的句子。',
  },
  {
    id: 'referencing', en: 'Referencing', zh: '代詞指涉',
    descEn: 'What a pronoun or "this / that / such" refers to in the passage.',
    descZh: '文中「他 / 她 / 它 / 這 / 那」等指的是什麼。',
  },
  {
    id: 'keywords', en: 'Keywords', zh: '關鍵詞作答',
    descEn: 'Short answer — students answer in a sentence using key words from the passage.',
    descZh: '簡答題，學生須用文中的關鍵詞作答。',
  },
  {
    id: 'connection', en: 'Connection between ideas', zh: '內意連結',
    descEn: 'How ideas, reasons or events in the passage are linked (why / so / how).',
    descZh: '文章中事件、原因或意思之間的關係（為甚麼 / 所以 / 怎樣）。',
  },
  {
    id: 'unfamiliar_word', en: 'Unfamiliar word', zh: '生詞詞義',
    descEn: 'The meaning of a difficult word as used in the passage.',
    descZh: '解釋生詞在文章中的意思。',
  },
];

export const TYPE_IDS = QUESTION_TYPES.map((t) => t.id);

/* ---------- Analysis taxonomy — ENGLISH ----------
   The original 8 types, plus main idea / inferring / others. */

export const EN_CATEGORIES = [
  ...QUESTION_TYPES,
  {
    id: 'main_idea', en: 'Main idea', zh: '主旨歸納',
    descEn: "The overall message or the writer's main point (e.g. 'What is the passage mainly about?').",
    descZh: '歸納全篇或段落的主旨、中心思想。',
  },
  {
    id: 'inferring', en: 'Inferring', zh: '深層推論',
    descEn: 'Information not stated directly — students infer it from clues in the text.',
    descZh: '根據文中線索推斷沒有直接透露的訊息（言外之意、隱藏原因）。',
  },
  {
    id: 'others', en: 'Others', zh: '其他',
    descEn: 'Anything that does not fit the categories above (titles, open questions, true/false formats, etc.).',
    descZh: '不屬於以上類別的題目（如命題、開放式題目等）。',
  },
];

/* ---------- Analysis taxonomy — CHINESE ----------
   Four groups, twelve categories (HKAT 中文閱讀理解分類). */

export const ZH_CATEGORY_GROUPS = [
  {
    id: 'semantic', zh: '一、語意與詞彙理解', en: 'Meaning & vocabulary',
    items: [
      {
        id: 'word_meaning', zh: '詞義辨析與替換', en: 'Word meaning & replacement',
        descZh: '近義詞辨析、成語運用，或要求選出在文中最適當的替換詞語。',
      },
      {
        id: 'pronoun_ref', zh: '指稱代詞理解（代詞指代）', en: 'Pronoun reference',
        descZh: '考查「這」「那」「他們」「此」等代詞具體指代前文的什麼內容或人物。',
      },
      {
        id: 'sentence_meaning', zh: '句義／重組解析', en: 'Sentence meaning / rearrangement',
        descZh: '句子在文中的深層含義或修辭效果，或將句子重新排序以符合邏輯。',
      },
    ],
  },
  {
    id: 'content', zh: '二、文章內容擷取與整理', en: 'Extracting & organising content',
    items: [
      {
        id: 'detail_facts', zh: '細節尋找與直接事實題', en: 'Details & direct facts',
        descZh: '從文中直接尋找時間、人物、地點、事件原因或結果等特定資訊。',
      },
      {
        id: 'true_false', zh: '正誤判斷題', en: 'True / false judgement',
        descZh: '判斷敘述是否符合文意（是／否／未能確定），或選出正確／不正確選項。',
      },
      {
        id: 'info_organising', zh: '訊息整理與填表／整合題', en: 'Information organising',
        descZh: '將演變過程、起因經過結果、人物特徵或比較項整合填入圖表或結構圖。',
      },
    ],
  },
  {
    id: 'structure', zh: '三、結構與主旨歸納', en: 'Structure & main idea',
    items: [
      {
        id: 'main_idea', zh: '主旨與段意歸納', en: 'Main idea & paragraph summary',
        descZh: '概括全篇或指定段落的核心思想（如「這篇文章的主旨是什麼？」）。',
      },
      {
        id: 'structure_infer', zh: '文章線索與結構推斷', en: 'Clues & structure',
        descZh: '段落間的銜接關係、線索演變（時間／空間／事理順序）或段落作用。',
      },
    ],
  },
  {
    id: 'deep', zh: '四、深層理解、推論與賞析', en: 'Deep comprehension & appreciation',
    items: [
      {
        id: 'inference', zh: '深層推論（隱含意思）', en: 'Implicit meaning',
        descZh: '根據字裏行間的線索推斷沒有直接透露的訊息（如人物的言外之意或行動背後的原因）。',
      },
      {
        id: 'character_feeling', zh: '人物性格與思想感情分析', en: 'Character & emotion',
        descZh: '分析人物的性格特徵，或作者透過文字抒發的情感／態度（讚賞、諷刺、同情、反思）。',
      },
      {
        id: 'author_purpose', zh: '寫作意圖與文章實用目的', en: "Author's purpose",
        descZh: '判斷作者寫作此文的最終目的（勸誡、推廣、啟發思考、告知訊息）。',
      },
      {
        id: 'rhetoric', zh: '修辭手法與寫作手法辨析', en: 'Rhetorical devices',
        descZh: '辨識並分析比喻、擬人、排比、對比、設問、反問等修辭／寫作手法及其表達效果。',
      },
    ],
  },
];

export const ZH_CATEGORIES = ZH_CATEGORY_GROUPS.flatMap((g) => g.items);
export const EN_TYPE_IDS = EN_CATEGORIES.map((t) => t.id);
export const ZH_TYPE_IDS = ZH_CATEGORIES.map((t) => t.id);

/** Valid type ids for the analysis/ingest pipeline, per language. */
export function typeIdsFor(language) {
  return language === 'zh' ? ZH_TYPE_IDS : EN_TYPE_IDS;
}

/** Where a question lands when its type cannot be recognised. */
export function fallbackTypeFor(language) {
  return language === 'zh' ? 'detail_facts' : 'keywords';
}

/** Old 8-type ids → nearest Chinese category (keeps earlier Chinese samples meaningful). */
export const EN_TO_ZH_TYPE = {
  cloze: 'word_meaning',
  sequencing: 'sentence_meaning',
  true: 'true_false',
  not_true: 'true_false',
  referencing: 'pronoun_ref',
  keywords: 'detail_facts',
  connection: 'inference',
  unfamiliar_word: 'word_meaning',
  main_idea: 'main_idea',
  inferring: 'inference',
};

/** Label lookup across BOTH taxonomies (for old papers & the UI). */
export function typeLabel(id) {
  const en = EN_CATEGORIES.find((x) => x.id === id);
  if (en) return `${en.zh} / ${en.en}`;
  const zh = ZH_CATEGORIES.find((x) => x.id === id);
  if (zh) return `${zh.zh} / ${zh.en}`;
  return id;
}

/** Everything the frontend needs to label the two taxonomies. */
export function categoryMeta() {
  return { en: EN_CATEGORIES, zh: ZH_CATEGORY_GROUPS };
}

export const LEVELS = [
  { id: 'p4', en: 'Primary 4', zh: '小四' },
  { id: 'p5', en: 'Primary 5', zh: '小五' },
  { id: 'p6', en: 'Primary 6', zh: '小六' },
];
