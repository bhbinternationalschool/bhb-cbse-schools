/**
 * App pop-ups (director, 9 Oct 2026): a poster, an announcement or a short
 * form shown full-screen when someone opens the parent or staff app — to
 * everyone, to some classes, or by a rule that reads the live record:
 *
 *   missing_docs     — a child's required documents are not uploaded
 *   missing_aadhaar  — the child's, father's or mother's Aadhaar number is missing
 *   consent_pending  — a consent (APAAR, or one the school writes) is not answered
 *
 * Posted from the web ERP (Comms → App pop-ups), stored in module_local_state
 * "app_popups". Who saw / dismissed / completed one is in app_popup_events.
 * A rule pop-up stops by itself once the record is complete — a family that
 * already gave the Aadhaar never sees the Aadhaar pop-up. Pure.
 */

export type AppPopupKind = "poster" | "info" | "form";
export type AppPopupForm = "none" | "aadhaar" | "consent" | "documents";
export type AppPopupAudience = "parents" | "staff";
export type AppPopupRule = "" | "missing_docs" | "missing_aadhaar" | "consent_pending";
export type AppPopupFrequency = "once" | "until_done" | "daily";
/** Whose Aadhaar an Aadhaar pop-up asks for (director, 10 Oct 2026). */
export type AadhaarScope = "all" | "child" | "parents";

export type AppPopup = {
  id: string;
  title: string;
  titleHi: string;
  body: string;
  bodyHi: string;
  /** Poster image (public URL). */
  imageUrl: string;
  kind: AppPopupKind;
  form: AppPopupForm;
  /** For consent forms: "apaar" (writes the APAAR consent on the record) or a key of the school's own. */
  consentKey: string;
  consentText: string;
  consentTextHi: string;
  /** Aadhaar form / rule: the child's, the parents', or both (default). */
  aadhaarScope: AadhaarScope;
  audience: AppPopupAudience;
  targetMode: "all" | "classes" | "rule";
  classIds: string[];
  rule: AppPopupRule;
  /** YYYY-MM-DD, inclusive; "" = open-ended. */
  startsOn: string;
  endsOn: string;
  frequency: AppPopupFrequency;
  /** A button that opens an app screen, e.g. "/fees" (optional). */
  ctaLabel: string;
  ctaRoute: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AppPopupsState = { version: 1; popups: AppPopup[] };

export type PopupEvent = { popupId: string; event: "shown" | "dismissed" | "done"; createdAt: string };

const s = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : dflt;
const isoDay = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

export function emptyAppPopupsState(): AppPopupsState {
  return { version: 1, popups: [] };
}

export function normalizeAppPopup(raw: unknown): AppPopup | null {
  const r = (raw ?? {}) as Partial<AppPopup>;
  const id = s(r.id, 40).trim();
  const title = s(r.title, 160).trim();
  if (!id || !title) return null;
  const form = pick(r.form, ["none", "aadhaar", "consent", "documents"] as const, "none");
  const kind = form !== "none" ? "form" : pick(r.kind, ["poster", "info", "form"] as const, "info");
  const rule = pick(r.rule, ["", "missing_docs", "missing_aadhaar", "consent_pending"] as const, "");
  const targetMode = pick(r.targetMode, ["all", "classes", "rule"] as const, "all");
  return {
    id,
    title,
    titleHi: s(r.titleHi, 160),
    body: s(r.body, 2000),
    bodyHi: s(r.bodyHi, 2000),
    imageUrl: /^https:\/\//.test(s(r.imageUrl, 600)) ? s(r.imageUrl, 600) : "",
    kind: kind === "form" && form === "none" ? "info" : kind,
    form,
    consentKey: s(r.consentKey, 40).trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""),
    consentText: s(r.consentText, 3000),
    consentTextHi: s(r.consentTextHi, 3000),
    aadhaarScope: pick(r.aadhaarScope, ["all", "child", "parents"] as const, "all"),
    audience: pick(r.audience, ["parents", "staff"] as const, "parents"),
    targetMode: targetMode === "rule" && !rule ? "all" : targetMode,
    classIds: (Array.isArray(r.classIds) ? r.classIds : []).map((c) => s(c, 60)).filter(Boolean).slice(0, 60),
    rule: targetMode === "rule" ? rule : "",
    startsOn: isoDay(r.startsOn),
    endsOn: isoDay(r.endsOn),
    frequency: pick(r.frequency, ["once", "until_done", "daily"] as const, "once"),
    ctaLabel: s(r.ctaLabel, 40),
    ctaRoute: /^\/[a-z0-9/_-]*$/i.test(s(r.ctaRoute, 80)) ? s(r.ctaRoute, 80) : "",
    active: r.active !== false,
    createdBy: s(r.createdBy, 120),
    createdAt: s(r.createdAt, 40),
    updatedAt: s(r.updatedAt, 40),
  };
}

export function normalizeAppPopupsState(raw: unknown): AppPopupsState {
  const r = (raw ?? {}) as Partial<AppPopupsState>;
  const popups = (Array.isArray(r.popups) ? r.popups : []).map(normalizeAppPopup).filter((p): p is AppPopup => !!p);
  return { version: 1, popups };
}

/** What the rule found for this family (or staff member) right now. */
export type RuleFacts = {
  /** Children (ids) whose required documents are missing. */
  missingDocs: string[];
  /** Whose Aadhaar is missing: student ids, plus "father" / "mother". */
  missingAadhaar: string[];
  /** Consent keys this family has not answered (e.g. "apaar"). */
  pendingConsents: string[];
};

/** The missing Aadhaar entries this pop-up asks about ("father"/"mother" are the parents; the rest are children). */
export function aadhaarInScope(missing: string[], scope: AadhaarScope): string[] {
  if (scope === "parents") return missing.filter((k) => k === "father" || k === "mother");
  if (scope === "child") return missing.filter((k) => k !== "father" && k !== "mother");
  return missing;
}

export type AadhaarGapCounts = {
  families: number;
  children: number;
  childrenMissing: number;
  familiesChildMissing: number;
  fatherMissing: number;
  motherMissing: number;
  familiesParentMissing: number;
  /** Families a pop-up would reach, per scope. */
  reach: Record<AadhaarScope, number>;
};

/** Whole-school Aadhaar gaps from each family's facts (one entry per family). */
export function countAadhaarGaps(families: { children: number; missing: string[] }[]): AadhaarGapCounts {
  const out: AadhaarGapCounts = {
    families: 0,
    children: 0,
    childrenMissing: 0,
    familiesChildMissing: 0,
    fatherMissing: 0,
    motherMissing: 0,
    familiesParentMissing: 0,
    reach: { all: 0, child: 0, parents: 0 },
  };
  for (const f of families) {
    if (!f.children) continue;
    out.families += 1;
    out.children += f.children;
    const kids = aadhaarInScope(f.missing, "child").length;
    const parents = aadhaarInScope(f.missing, "parents");
    out.childrenMissing += kids;
    if (kids) out.familiesChildMissing += 1;
    if (parents.includes("father")) out.fatherMissing += 1;
    if (parents.includes("mother")) out.motherMissing += 1;
    if (parents.length) out.familiesParentMissing += 1;
    if (f.missing.length) out.reach.all += 1;
    if (kids) out.reach.child += 1;
    if (parents.length) out.reach.parents += 1;
  }
  return out;
}

/**
 * Should this person see this pop-up on this app open?
 *
 * - live: active, within its dates, for this audience;
 * - aimed at them: everyone, one of their children's classes, or a rule that
 *   matches their record NOW;
 * - not over-shown: "once" = never after it was shown, "daily" = not again
 *   today, "until_done" = every open until the form is done (or the rule
 *   stops matching).
 *
 * "Done" ends a pop-up — except an Aadhaar or documents form, which ends
 * only when the family's record is complete (10 Oct 2026): a parent who
 * saves one child's number and leaves a sibling's empty is asked again for
 * the sibling, and only for what is still missing (popupsFor lists the gaps
 * and drops the pop-up once there are none).
 */
export function popupApplies(
  p: AppPopup,
  who: { audience: AppPopupAudience; classIds: string[]; facts: RuleFacts; today: string },
  events: PopupEvent[],
): boolean {
  if (!p.active || p.audience !== who.audience) return false;
  if (p.startsOn && who.today < p.startsOn) return false;
  if (p.endsOn && who.today > p.endsOn) return false;

  if (p.targetMode === "classes" && !p.classIds.some((c) => who.classIds.includes(c))) return false;
  if (p.targetMode === "rule") {
    if (p.rule === "missing_docs" && who.facts.missingDocs.length === 0) return false;
    if (p.rule === "missing_aadhaar" && aadhaarInScope(who.facts.missingAadhaar, p.aadhaarScope).length === 0) return false;
    if (p.rule === "consent_pending" && !who.facts.pendingConsents.includes(p.consentKey || "apaar")) return false;
  }

  const mine = events.filter((e) => e.popupId === p.id);
  const recordDriven = p.form === "aadhaar" || p.form === "documents";
  if (!recordDriven && mine.some((e) => e.event === "done")) return false;
  if (p.frequency === "once") return !mine.some((e) => e.event === "shown");
  if (p.frequency === "daily") return !mine.some((e) => e.event === "shown" && e.createdAt.slice(0, 10) === who.today);
  return true;
}

/** Aadhaar's own checksum (Verhoeff) — catches a typed digit wrong or two swapped. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** A real Aadhaar: 12 digits, not starting 0 or 1, checksum right. */
export function isValidAadhaar(raw: string): boolean {
  const n = String(raw ?? "").replace(/\s|-/g, "");
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  let c = 0;
  const digits = n.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c]![P[i % 8]![digits[i]!]!]!;
  return c === 0;
}

export function maskAadhaarNumber(raw: string): string {
  const n = String(raw ?? "").replace(/\D/g, "");
  return n.length === 12 ? `XXXX-XXXX-${n.slice(8)}` : "";
}
