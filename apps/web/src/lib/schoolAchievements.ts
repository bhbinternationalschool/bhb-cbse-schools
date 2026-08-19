/**
 * School achievements — the facts marketing content is generated from:
 * board results per year, competition wins, sports, recognitions, alumni
 * notes, facilities. Typed by the office from the real CBSE result / the
 * real certificate, never generated. Each entry is a title, a short detail
 * and named metrics ("Pass %" → "100", "Distinctions" → "42") so the
 * generator interpolates numbers rather than writing them.
 * Persisted through module_local_state ("school_achievements").
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";

export type AchievementKind =
  | "board_result"
  | "competition"
  | "sports"
  | "recognition"
  | "alumni"
  | "facility"
  | "event"
  | "other";

export const ACHIEVEMENT_KINDS: { id: AchievementKind; label: string; hint: string }[] = [
  { id: "board_result", label: "Board result", hint: "Class X / XII: pass %, distinctions, toppers — from the CBSE result sheet" },
  { id: "competition", label: "Competition / olympiad", hint: "Name, level (district/state/national), position, student(s)" },
  { id: "sports", label: "Sports", hint: "Event, level, medal / position" },
  { id: "recognition", label: "Award / recognition", hint: "Who gave it, for what, when" },
  { id: "alumni", label: "Alumni", hint: "Public-safe, with the alumnus's consent" },
  { id: "facility", label: "Facility / infrastructure", hint: "New lab, library, ground — counts and dates" },
  { id: "event", label: "Event highlight", hint: "Annual day, science fair — what happened, numbers" },
  { id: "other", label: "Other", hint: "" },
];

export type AchievementMetric = { label: string; value: string };

export type Achievement = {
  id: string;
  kind: AchievementKind;
  academicYearCode: string;
  title: string;
  detail: string;
  metrics: AchievementMetric[];
  /** YYYY-MM-DD of the result / event; "" = not on record */
  date: string;
  publicSafe: boolean;
  /** Where the numbers came from, e.g. "CBSE result PDF 13-May-2026" */
  sourceNote: string;
  updatedAt: string;
  updatedBy: string;
};

export type MarketingPositioning = {
  /** Our USPs the office stands behind, one per line */
  ours: string;
  /** What nearby schools advertise (for differentiation only) */
  others: string;
  /** Names that must never appear in output */
  competitorNames: string;
  /** Brand lines the generator may reuse verbatim */
  brandLines: string;
};

export type SchoolAchievementsState = {
  version: 1;
  achievements: Achievement[];
  positioning: MarketingPositioning;
  updatedAt: string;
};

const STORAGE_KEY = "bhb_school_achievements_v1";
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
function nid() {
  return `ach_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAchievementKind(v: unknown): AchievementKind {
  const s = String(v ?? "");
  return ACHIEVEMENT_KINDS.some((k) => k.id === s) ? (s as AchievementKind) : "other";
}
export function achievementKindLabel(k: AchievementKind): string {
  return ACHIEVEMENT_KINDS.find((x) => x.id === k)?.label ?? k;
}

export function emptySchoolAchievements(): SchoolAchievementsState {
  return { version: 1, achievements: [], positioning: { ours: "", others: "", competitorNames: "", brandLines: "" }, updatedAt: "" };
}

export function normalizeAchievement(raw: unknown): Achievement | null {
  const x = (raw ?? {}) as Partial<Achievement>;
  const title = str(x.title, 160);
  if (!title) return null;
  return {
    id: str(x.id, 40) || nid(),
    kind: normalizeAchievementKind(x.kind),
    academicYearCode: str(x.academicYearCode, 12),
    title,
    detail: str(x.detail, 1200),
    metrics: Array.isArray(x.metrics)
      ? x.metrics
          .map((m) => ({ label: str((m as AchievementMetric)?.label, 60), value: str((m as AchievementMetric)?.value, 60) }))
          .filter((m) => m.label && m.value)
          .slice(0, 12)
      : [],
    date: date(x.date),
    publicSafe: x.publicSafe !== false,
    sourceNote: str(x.sourceNote, 200),
    updatedAt: str(x.updatedAt, 40),
    updatedBy: str(x.updatedBy, 120),
  };
}

export function normalizeSchoolAchievements(raw: unknown): SchoolAchievementsState {
  const d = emptySchoolAchievements();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<SchoolAchievementsState>;
  const seen = new Set<string>();
  const achievements: Achievement[] = [];
  for (const a of Array.isArray(r.achievements) ? r.achievements : []) {
    const n = normalizeAchievement(a);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    achievements.push(n);
  }
  const p = (r.positioning ?? {}) as Partial<MarketingPositioning>;
  return {
    version: 1,
    achievements,
    positioning: {
      ours: str(p.ours, 2000),
      others: str(p.others, 2000),
      competitorNames: str(p.competitorNames, 600),
      brandLines: str(p.brandLines, 600),
    },
    updatedAt: str(r.updatedAt, 40),
  };
}

export function loadSchoolAchievements(): SchoolAchievementsState {
  if (typeof window === "undefined") return emptySchoolAchievements();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeSchoolAchievements(JSON.parse(raw)) : emptySchoolAchievements();
  } catch {
    return emptySchoolAchievements();
  }
}

export function saveSchoolAchievements(state: SchoolAchievementsState): SchoolAchievementsState {
  const next = normalizeSchoolAchievements({ ...state, updatedAt: new Date().toISOString() });
  if (!assertModulePermission("admissions", "edit", "saveSchoolAchievements")) return next;
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("school_achievements", next));
    window.dispatchEvent(new CustomEvent("bhb-school-achievements"));
  }
  return next;
}

export function writeSchoolAchievementsLocalRaw(state: SchoolAchievementsState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeSchoolAchievements(state)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new CustomEvent("bhb-school-achievements"));
}

export function schoolAchievementsIsEmpty(s: SchoolAchievementsState): boolean {
  return s.achievements.length === 0 && !s.updatedAt && !s.positioning.ours && !s.positioning.brandLines;
}

export function upsertAchievement(
  state: SchoolAchievementsState,
  input: Partial<Achievement> & { by: string },
): { ok: true; state: SchoolAchievementsState; achievement: Achievement } | { ok: false; error: string } {
  const n = normalizeAchievement({ ...input, updatedAt: new Date().toISOString(), updatedBy: input.by });
  if (!n) return { ok: false, error: "Give the achievement a title" };
  const exists = state.achievements.some((a) => a.id === n.id);
  return {
    ok: true,
    achievement: n,
    state: { ...state, achievements: exists ? state.achievements.map((a) => (a.id === n.id ? n : a)) : [n, ...state.achievements] },
  };
}

export function removeAchievement(state: SchoolAchievementsState, id: string): SchoolAchievementsState {
  return { ...state, achievements: state.achievements.filter((a) => a.id !== id) };
}

/** Prompt-ready lines for a set of achievements (only what was entered). */
export function achievementsToFactLines(list: Achievement[]): string[] {
  return list.map((a) => {
    const m = a.metrics.map((x) => `${x.label}: ${x.value}`).join("; ");
    return `${achievementKindLabel(a.kind)}${a.academicYearCode ? ` ${a.academicYearCode}` : ""}${a.date ? ` (${a.date})` : ""} — ${a.title}${a.detail ? `. ${a.detail}` : ""}${m ? `. ${m}` : ""}`;
  });
}
