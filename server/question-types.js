// Canonical question types used across prompts, DB and UI.
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

export const LEVELS = [
  { id: 'p4', en: 'Primary 4', zh: '小四' },
  { id: 'p5', en: 'Primary 5', zh: '小五' },
  { id: 'p6', en: 'Primary 6', zh: '小六' },
];

export function typeLabel(id) {
  const t = QUESTION_TYPES.find((x) => x.id === id);
  return t ? `${t.zh} / ${t.en}` : id;
}
