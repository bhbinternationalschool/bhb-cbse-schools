/**
 * Shared grounding checks for AI drafts that will be read by the public.
 * Deterministic, pure. The model is told to use only the facts; these
 * catch the cases where it did not, so the UI can mark a draft "check
 * numbers" instead of trusting it.
 */

/** Normalise for comparison: drop thousands separators and spaces. */
function squash(s: string): string {
  return (s || "").replace(/[,\s]/g, "");
}

/**
 * Numbers in `text` that do not appear in `factText`: ₹ amounts, numbers of
 * 3+ digits (years, fees, counts), d/m/y dates, and percentages. Two-digit
 * counts ("12 students") are allowed through — too many false positives.
 */
export function ungroundedNumbers(text: string, factText: string): string[] {
  const facts = squash(factText);
  const out = new Set<string>();
  const re = /(?:₹\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]{2,}(?:\.\d+)?\s*%?|\b\d{1,2}(?:\.\d+)?\s*%|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b)/g;
  for (const m of (text || "").matchAll(re)) {
    const raw = m[0];
    const tok = squash(raw).replace(/^₹/, "").replace(/%$/, "");
    if (!tok) continue;
    if (!facts.includes(tok)) out.add(raw.trim());
  }
  return [...out];
}

/** Case-insensitive whole-word hits of any forbidden name (competitor schools). */
export function forbiddenNameHits(text: string, names: string[]): string[] {
  const hits: string[] = [];
  const hay = (text || "").toLowerCase();
  for (const n of names.map((x) => x.trim()).filter((x) => x.length >= 3)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u");
    if (re.test(hay)) hits.push(n);
  }
  return hits;
}

/**
 * CBSE / ASCI-sensitive claims that always need a human eye before going
 * public: absolute superlatives and rank claims. Returns the phrases found.
 */
export function sensitiveClaims(text: string): string[] {
  const phrases = [
    /\b100\s*%\s*(result|pass|success|placement)/i,
    /\b(no\.?\s*1|number\s*one|#1|best school|top school|rank(ed)?\s*(1|first|one)\b)/i,
    /\bguarantee[ds]?\b/i,
    /\bonly school\b/i,
  ];
  const out: string[] = [];
  for (const re of phrases) {
    const m = (text || "").match(re);
    if (m) out.push(m[0]);
  }
  return out;
}
