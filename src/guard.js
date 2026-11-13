// Hallucination guard for the AI-written brief: the model may only restate numbers
// that already appear in the facts it was given. Any other number rejects the text.
const numbersIn = (text) => (String(text).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ''));

export function groundedNumbers(text, facts) {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  const extra = numbersIn(text).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
  return { ok: extra.length === 0, extra };
}
