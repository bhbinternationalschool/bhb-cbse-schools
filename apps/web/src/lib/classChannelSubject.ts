import type { MastersState } from "@/lib/masters";

/**
 * What teachers actually type for a subject, mapped to the words in its
 * Masters name (9 Oct 2026: "maths" never matched "Mathematics", "sst" never
 * matched "Social Science", so the draft asked for a subject the teacher had
 * already given).
 */
const SUBJECT_ALIASES: Record<string, string[]> = {
  maths: ["mathematics", "math"],
  math: ["mathematics", "maths"],
  mat: ["mathematics", "maths"],
  sst: ["social science", "social studies"],
  "s.st": ["social science", "social studies"],
  evs: ["environmental", "evs"],
  sci: ["science"],
  eng: ["english"],
  hin: ["hindi"],
  comp: ["computer"],
  computers: ["computer"],
  gk: ["general knowledge", "g.k"],
  skt: ["sanskrit"],
  art: ["art", "drawing"],
  drawing: ["drawing", "art"],
};

export function matchSubject(
  masters: Pick<MastersState, "subjects">,
  hint: string,
): { id: string; name: string } | null {
  if (!hint) return null;
  const subjects = masters.subjects ?? [];
  const h = hint.toLowerCase().trim();
  const words = (en: string) => en.split(/[^a-z.]+/).filter(Boolean);
  // Exact name or code first; then the alias words; then a whole-word part
  // of the name — so "science" is Science, not Social Science.
  const exact = subjects.find((s) => (s.nameEn || "").toLowerCase() === h || (s.code || "").toLowerCase() === h);
  const alias = (SUBJECT_ALIASES[h] ?? []).map((a) => a.toLowerCase());
  const byAlias = exact
    ? undefined
    : alias
        .map((a) => subjects.find((s) => (s.nameEn || "").toLowerCase() === a) ?? subjects.find((s) => (s.nameEn || "").toLowerCase().startsWith(a)))
        .find(Boolean);
  const byWord = exact || byAlias
    ? undefined
    : subjects.find((s) => words((s.nameEn || "").toLowerCase())[0] === h) ??
      subjects.find((s) => (s.nameEn || "").toLowerCase().includes(h));
  const hit = exact ?? byAlias ?? byWord;
  if (!hit) return null;
  return { id: hit.id, name: hit.nameEn || hit.code || hit.id };
}
