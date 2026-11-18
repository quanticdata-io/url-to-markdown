/**
 * Estimates how many LLM tokens a text uses, without a tokenizer.
 *
 * Common BPE tokenizers average close to four characters per token on English
 * prose and fewer on code, URLs and non-Latin scripts. The estimate takes the
 * larger of a character-based and a word-based count, so it errs on the high
 * side; use it for budgets and chunk sizes, not for billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  // Characters outside Latin-1 (CJK, Cyrillic, ...) usually cost about one token each.
  const wide = (text.match(/[^\u0000-ÿ]/g) ?? []).length;
  const byChars = (chars - wide) / 4 + wide;
  const byWords = words * 1.3;
  return Math.ceil(Math.max(byChars, byWords));
}
