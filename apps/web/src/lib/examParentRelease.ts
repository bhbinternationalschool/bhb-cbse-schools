/**
 * What the school has deliberately shown to parents, per exam term.
 *
 * Two switches per exam, both OFF until a person turns them on:
 *   - results:   the term's marks / report card appear in the parent app and
 *                the /parent portal.
 *   - dateSheet: the term's date sheet appears there.
 *
 * Nothing about an exam reaches a family because marks happen to exist or a
 * date sheet happens to be typed in: the exams desk was barely used in prod
 * (2026-09-15 audit), half-entered sheets are normal, and a parent who sees a
 * provisional 34/80 sees a fact. An exam missing here is "not released",
 * never "released".
 *
 * Stored as one module_local_state row (RELEASE_STATE_KEY) that is NOT in
 * the generic module-state registry, so the only writer is
 * /api/v1/staff/exams/parent-release (exams.edit, audited).
 */

export const EXAM_PARENT_RELEASE_KEY = "exam_parent_release";

export type ReleaseKind = "results" | "dateSheet";

export type ReleaseSwitch = {
  on: boolean;
  /** When it was last switched (either way). */
  at: string;
  /** Who switched it (staff name). */
  by: string;
};

export type TermRelease = {
  termId: string;
  results: ReleaseSwitch | null;
  dateSheet: ReleaseSwitch | null;
};

export type ExamParentReleaseState = {
  version: 1;
  terms: TermRelease[];
};

export function emptyExamParentRelease(): ExamParentReleaseState {
  return { version: 1, terms: [] };
}

function normalizeSwitch(raw: unknown): ReleaseSwitch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Only a literal true is "on": a damaged row must never release anything.
  return {
    on: r.on === true,
    at: typeof r.at === "string" ? r.at : "",
    by: typeof r.by === "string" ? r.by.slice(0, 120) : "",
  };
}

export function normalizeExamParentRelease(raw: unknown): ExamParentReleaseState {
  if (!raw || typeof raw !== "object") return emptyExamParentRelease();
  const list = (raw as { terms?: unknown }).terms;
  if (!Array.isArray(list)) return emptyExamParentRelease();
  const seen = new Set<string>();
  const terms: TermRelease[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const termId = typeof t.termId === "string" ? t.termId.trim() : "";
    if (!termId || seen.has(termId)) continue;
    seen.add(termId);
    terms.push({
      termId,
      results: normalizeSwitch(t.results),
      dateSheet: normalizeSwitch(t.dateSheet),
    });
  }
  return { version: 1, terms };
}

/** Pure — is this term's `kind` switched on for parents? Absent = no. */
export function isReleasedToParents(
  state: ExamParentReleaseState | null | undefined,
  termId: string,
  kind: ReleaseKind,
): boolean {
  if (!state) return false;
  const t = state.terms.find((x) => x.termId === termId);
  return t?.[kind]?.on === true;
}

/** Pure — the release record for one switch, or null when never touched. */
export function releaseSwitchFor(
  state: ExamParentReleaseState | null | undefined,
  termId: string,
  kind: ReleaseKind,
): ReleaseSwitch | null {
  return state?.terms.find((x) => x.termId === termId)?.[kind] ?? null;
}

/** Pure — the state with one switch set. Other terms and switches untouched. */
export function withReleaseSwitch(
  state: ExamParentReleaseState,
  input: { termId: string; kind: ReleaseKind; on: boolean; at: string; by: string },
): ExamParentReleaseState {
  const termId = input.termId.trim();
  const next: ReleaseSwitch = { on: input.on, at: input.at, by: input.by.slice(0, 120) };
  const existing = state.terms.find((t) => t.termId === termId);
  const terms = existing
    ? state.terms.map((t) => (t.termId === termId ? { ...t, [input.kind]: next } : t))
    : [
        ...state.terms,
        {
          termId,
          results: input.kind === "results" ? next : null,
          dateSheet: input.kind === "dateSheet" ? next : null,
        },
      ];
  return { version: 1, terms };
}

export function isReleaseKind(v: unknown): v is ReleaseKind {
  return v === "results" || v === "dateSheet";
}
