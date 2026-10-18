// Deterministic auto-marking for the student online mode.
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'in', 'on', 'at',
  'and', 'or', 'so', 'that', 'this', 'it', 'its', 'for', 'with', 'from', 'by', 'as', 'his', 'her',
  'they', 'them', 'he', 'she', 'we', 'you', 'i', 'my', 'their', 'there', 'which', 'who', 'whom',
  '的', '了', '在', '是', '和', '與', '也', '就', '都', '很', '把', '被', '她', '他', '它', '我', '你', '們',
]);

export const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[.,;:!?。，；：！？、'"“”()（）\[\]]/g, '')
    .trim();

const contentWords = (s) =>
  normalize(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

const cjkChars = (s) => String(s || '').match(/[\u4e00-\u9fff]/g) || [];

/** Correctness 0..1 for one answer, judged by question type. */
export function similarity(q, given) {
  const student = normalize(given);
  if (!student) return 0;

  const expected = normalize(q.answer);
  const type = q.type;

  // True / False and letter answers: accept T/F/true/false or A/B/C.
  if (type === 'true' || type === 'not_true') {
    const s = student.slice(0, 6);
    const e = expected.slice(0, 6);
    if (/^(t|true)/.test(s) && /^(t|true)/.test(e)) return 1;
    if (/^(f|false)/.test(s) && /^(f|false)/.test(e)) return 1;
    if (student === expected) return 1;
  }

  // Multiple choice: accept the letter OR the full option text.
  const options = q.options || [];
  const matchedOption = options.find((o) => normalize(o) === student || normalize(o).replace(/^[a-d][.、)]?\s*/, '') === student);
  if (options.length && matchedOption) {
    return normalize(matchedOption) === expected ||
      normalize(matchedOption).replace(/^[a-d][.、)]?\s*/, '') === expected ? 1 : 0;
  }
  if (/^[a-d]$/.test(student) && expected.length <= 2) return student === expected ? 1 : 0;

  // Exact / near-exact match.
  if (student === expected) return 1;
  if (student && expected.includes(student) && student.length >= Math.max(4, expected.length * 0.6)) return 1;

  // Chinese: character bigram overlap.
  const sCjk = cjkChars(student);
  const eCjk = cjkChars(expected);
  if (sCjk.length && eCjk.length) {
    const bigrams = (arr) => new Set(arr.slice(0, -1).map((c, i) => c + arr[i + 1]));
    const sb = bigrams(sCjk);
    const eb = bigrams(eCjk);
    if (!eb.size) return 0;
    const hit = [...eb].filter((b) => sb.has(b)).length;
    return hit / eb.size;
  }

  // English / mixed: keyword recall with a length guard.
  const expectedWords = contentWords(q.answer);
  if (!expectedWords.length) return student === expected ? 1 : 0;
  const studentWords = new Set(contentWords(given));
  const hit = expectedWords.filter((w) => studentWords.has(w)).length;
  return hit / expectedWords.length;
}

/** Mark a whole submission: returns per-question breakdown plus totals. */
export function markSubmission(paper, answers = {}) {
  const perQuestion = (paper.questions || []).map((q) => {
    const given = answers[q.no] ?? answers[String(q.no)] ?? '';
    const sim = similarity(q, given);
    const correct = sim >= 0.6;
    return {
      no: q.no,
      given: String(given || ''),
      expected: q.answer,
      marks: q.marks || 1,
      score: correct ? (q.marks || 1) : Math.round(sim * (q.marks || 1) * 10) / 10,
      correct,
    };
  });
  const score = Math.round(perQuestion.reduce((s, q) => s + q.score, 0) * 10) / 10;
  const max = perQuestion.reduce((s, q) => s + q.marks, 0);
  return { perQuestion, score, max };
}
