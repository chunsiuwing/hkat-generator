// Self-check: a second AI pass that verifies the paper before the teacher sees it.
import { chatJSON } from './ai.js';

/**
 * Verify every answer against the passage, check level/length/question-count,
 * and return { score, issues, fixes } — fixes are applied to the paper in place.
 */
export async function selfCheck(paper, params) {
  const langName = params.language === 'zh' ? '中文' : 'English';
  const levelName = { p4: 'Primary 4 小四', p5: 'Primary 5 小五', p6: 'Primary 6 小六' }[params.level] || params.level;

  const questionsJson = JSON.stringify(
    (paper.questions || []).map((q) => ({
      no: q.no, type: q.type, marks: q.marks, instruction: q.instruction,
      stem: q.stem, options: q.options, answer: q.answer, explanation: q.explanation,
    })),
    null, 1
  );

  const result = await chatJSON({
    system: `You are a meticulous HKAT chief marker checking a newly written comprehension paper.
Check, in this order:
1. ANSWERABILITY — is every answer directly found in, or clearly inferable from, the passage? Any question that cannot be answered from the passage alone is a serious error.
2. ANSWER ACCURACY — is each "answer" exactly right? Is each explanation correct?
3. NO LEAKAGE — for cloze questions, the correct option must NOT also appear verbatim elsewhere in the gap sentence.
4. SPEC COMPLIANCE — the passage is ${langName}, aimed at ${levelName}; the word count target is about ${params.wordLength} words (±15%); the question count and question types match the teacher's request.
5. LANGUAGE — natural, idiomatic ${langName}; no mixed languages; numbering 1..N is correct.
Reply with ONLY this JSON:
{
  "score": <0-100 integer, start at 100 and dock 15 per serious error, 5 per minor one>,
  "issues": ["short description of each problem found, or an empty array"],
  "fixes": [
    { "no": <question number>, "stem": <corrected stem or null>, "answer": <corrected answer or null>, "explanation": <corrected explanation or null> }
  ]
}
Only include a fix when you actually changed something. Fix, don't rewrite: keep the teacher's style.`,
    user: `TARGET: ${langName} · ${levelName} · about ${params.wordLength} words · ${params.questionCount} questions · types: ${params.types.join(', ')}
THEME: ${params.topic || '(any)'} ${params.theme || ''}

PASSAGE:
${paper.passage}

QUESTIONS:
${questionsJson}`,
    temperature: 0.2,
    maxTokens: 3000,
    timeoutMs: 180000,
    mock: { score: 95, issues: [], fixes: [] },
  });

  const fixes = Array.isArray(result.fixes) ? result.fixes : [];
  let applied = 0;
  for (const fix of fixes) {
    const q = (paper.questions || []).find((x) => String(x.no) === String(fix.no));
    if (!q) continue;
    if (fix.stem) { q.stem = String(fix.stem); applied += 1; }
    if (fix.answer) { q.answer = String(fix.answer); applied += 1; }
    if (fix.explanation) q.explanation = String(fix.explanation);
    if (fix.instruction) q.instruction = String(fix.instruction);
  }

  return {
    score: Math.max(0, Math.min(100, Number(result.score) || 0)),
    issues: Array.isArray(result.issues) ? result.issues.map(String) : [],
    fixesApplied: applied,
    checkedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}
