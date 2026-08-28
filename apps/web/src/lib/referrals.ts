/**
 * Parent referrals & testimonials.
 *
 * Referrals: an enrolled household gets a stable code (derived from its
 * SIS household code/mobile, so no table is needed to resolve it); the
 * code travels on the public enquiry link (?ref=CODE) or is typed by the
 * counsellor; attribution = leads whose `referredByHouseholdId` (or
 * unresolved `referralCode`) points at the household. Rewards stay a note
 * — no money moves here.
 *
 * Testimonials: request → parent's raw words → AI polish (grammar/length
 * only, every claim and number must already be in the raw text) → parent
 * approval → usable by the Marketing generator as a fact line. Nothing
 * unapproved leaves this module.
 * Persisted through module_local_state ("referrals").
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";
import type { AdmissionLead } from "@/lib/admissions";
import { ungroundedNumbers } from "@/lib/aiGrounding";

export type ReferralInvite = {
  householdId: string;
  code: string;
  invitedAt: string;
  channel: string;
  note: string;
};

export type TestimonialStatus = "requested" | "received" | "polished" | "approved" | "declined";

export type Testimonial = {
  id: string;
  householdId: string;
  parentName: string;
  /** "Aarav, Class VI" — public-safe label */
  studentLabel: string;
  rawText: string;
  polishedText: string;
  status: TestimonialStatus;
  requestedAt: string;
  receivedAt: string;
  approvedAt: string;
  /** How consent was recorded: "WhatsApp YES 2026-08-20" */
  consentNote: string;
  /** Parent allowed the name to be shown */
  showName: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type ReferralsState = {
  version: 1;
  invites: ReferralInvite[];
  testimonials: Testimonial[];
  /** Reward policy text shown to staff (e.g. "₹1,000 fee credit per enrolment") — informational */
  rewardNote: string;
  /**
   * The structured reward policy (lib/referralRewards.ts owns its shape and
   * defaults). Kept as an opaque record here so this module stays free of
   * the fee/masters imports the award engine needs.
   */
  rewardPolicy?: Record<string, unknown>;
  updatedAt: string;
};

const STORAGE_KEY = "bhb_referrals_v1";
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function emptyReferrals(): ReferralsState {
  return { version: 1, invites: [], testimonials: [], rewardNote: "", updatedAt: "" };
}

function normStatus(v: unknown): TestimonialStatus {
  return v === "received" || v === "polished" || v === "approved" || v === "declined" ? v : "requested";
}

export function normalizeReferrals(raw: unknown): ReferralsState {
  const d = emptyReferrals();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<ReferralsState>;
  const seen = new Set<string>();
  const invites: ReferralInvite[] = [];
  for (const i of Array.isArray(r.invites) ? r.invites : []) {
    const x = (i ?? {}) as Partial<ReferralInvite>;
    const householdId = str(x.householdId, 40);
    const code = str(x.code, 20).toUpperCase();
    if (!householdId || !code || seen.has(householdId)) continue;
    seen.add(householdId);
    invites.push({ householdId, code, invitedAt: str(x.invitedAt, 40), channel: str(x.channel, 20), note: str(x.note, 200) });
  }
  const tseen = new Set<string>();
  const testimonials: Testimonial[] = [];
  for (const t of Array.isArray(r.testimonials) ? r.testimonials : []) {
    const x = (t ?? {}) as Partial<Testimonial>;
    const id = str(x.id, 40);
    if (!id || tseen.has(id)) continue;
    tseen.add(id);
    testimonials.push({
      id,
      householdId: str(x.householdId, 40),
      parentName: str(x.parentName, 120),
      studentLabel: str(x.studentLabel, 120),
      rawText: str(x.rawText, 2000),
      polishedText: str(x.polishedText, 2000),
      status: normStatus(x.status),
      requestedAt: str(x.requestedAt, 40),
      receivedAt: str(x.receivedAt, 40),
      approvedAt: str(x.approvedAt, 40),
      consentNote: str(x.consentNote, 200),
      showName: x.showName === true,
      updatedAt: str(x.updatedAt, 40),
      updatedBy: str(x.updatedBy, 120),
    });
  }
  const rewardPolicy =
    r.rewardPolicy && typeof r.rewardPolicy === "object"
      ? (r.rewardPolicy as Record<string, unknown>)
      : undefined;
  return {
    version: 1,
    invites,
    testimonials,
    rewardNote: str(r.rewardNote, 300),
    ...(rewardPolicy ? { rewardPolicy } : {}),
    updatedAt: str(r.updatedAt, 40),
  };
}

export function loadReferrals(): ReferralsState {
  if (typeof window === "undefined") return emptyReferrals();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeReferrals(JSON.parse(raw)) : emptyReferrals();
  } catch {
    return emptyReferrals();
  }
}

export function saveReferrals(state: ReferralsState): ReferralsState {
  const next = normalizeReferrals({ ...state, updatedAt: new Date().toISOString() });
  if (!assertModulePermission("admissions", "edit", "saveReferrals")) return next;
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("referrals", next));
    window.dispatchEvent(new CustomEvent("bhb-referrals"));
  }
  return next;
}

export function writeReferralsLocalRaw(state: ReferralsState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeReferrals(state)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new CustomEvent("bhb-referrals"));
}

export function referralsIsEmpty(s: ReferralsState): boolean {
  return s.invites.length === 0 && s.testimonials.length === 0 && !s.updatedAt;
}

/* ─── Referral codes ───────────────────────────────────────────────── */

/**
 * Stable, human-typeable code for a household: BHB-<4 chars from the
 * household code or id>-<last 3 of mobile>. Deterministic, so the same
 * family always gets the same code and an old flyer still resolves.
 */
export function referralCodeFor(h: { id: string; code?: string; mobile?: string }): string {
  const base = (h.code || h.id || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const tail = (h.mobile || "").replace(/\D/g, "").slice(-3).padStart(3, "0");
  return `BHB-${(base.slice(-4) || "XXXX").padStart(4, "X")}-${tail}`;
}

export function normalizeReferralCode(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^BHB-[A-Z0-9]{4}-\d{3}$/.test(s) ? s : "";
}

/** Resolve a typed / linked code to a household id (exact match on derived code). */
export function resolveReferralCode(
  code: string,
  households: { id: string; code?: string; mobile?: string }[],
): string {
  const c = normalizeReferralCode(code);
  if (!c) return "";
  return households.find((h) => referralCodeFor(h) === c)?.id || "";
}

export type ReferralAttribution = {
  householdId: string;
  code: string;
  leads: number;
  registered: number;
  enrolled: number;
  leadIds: string[];
};

/** Leads per referrer: by resolved household id, or by unresolved code typed on the lead. */
export function referralAttribution(
  leads: AdmissionLead[],
  households: { id: string; code?: string; mobile?: string }[],
): ReferralAttribution[] {
  const byHh = new Map<string, ReferralAttribution>();
  const codeToHh = new Map(households.map((h) => [referralCodeFor(h), h.id]));
  for (const l of leads) {
    const hh = l.referredByHouseholdId || (l.referralCode ? codeToHh.get(normalizeReferralCode(l.referralCode)) || "" : "");
    if (!hh) continue;
    const cur = byHh.get(hh) ?? { householdId: hh, code: referralCodeFor(households.find((h) => h.id === hh) || { id: hh }), leads: 0, registered: 0, enrolled: 0, leadIds: [] };
    cur.leads += 1;
    cur.leadIds.push(l.id);
    if (l.stage === "applied" || l.stage === "verified" || l.stage === "enrolled" || l.registrationPaymentStatus === "paid") cur.registered += 1;
    if (l.stage === "enrolled") cur.enrolled += 1;
    byHh.set(hh, cur);
  }
  return [...byHh.values()].sort((a, b) => b.enrolled - a.enrolled || b.leads - a.leads);
}

export function markInvited(state: ReferralsState, householdId: string, code: string, channel: string): ReferralsState {
  const rest = state.invites.filter((i) => i.householdId !== householdId);
  const prev = state.invites.find((i) => i.householdId === householdId);
  return { ...state, invites: [...rest, { householdId, code, invitedAt: new Date().toISOString(), channel, note: prev?.note || "" }] };
}

/* ─── Testimonials ─────────────────────────────────────────────────── */

function tid() {
  return `tst_${Math.random().toString(36).slice(2, 10)}`;
}

export function upsertTestimonial(
  state: ReferralsState,
  input: Partial<Testimonial> & { by: string },
): { ok: true; state: ReferralsState; testimonial: Testimonial } | { ok: false; error: string } {
  const existing = input.id ? state.testimonials.find((t) => t.id === input.id) : undefined;
  const merged: Testimonial = {
    id: existing?.id || input.id || tid(),
    householdId: str(input.householdId ?? existing?.householdId, 40),
    parentName: str(input.parentName ?? existing?.parentName, 120),
    studentLabel: str(input.studentLabel ?? existing?.studentLabel, 120),
    rawText: str(input.rawText ?? existing?.rawText, 2000),
    polishedText: str(input.polishedText ?? existing?.polishedText, 2000),
    status: normStatus(input.status ?? existing?.status),
    requestedAt: str(input.requestedAt ?? existing?.requestedAt, 40),
    receivedAt: str(input.receivedAt ?? existing?.receivedAt, 40),
    approvedAt: str(input.approvedAt ?? existing?.approvedAt, 40),
    consentNote: str(input.consentNote ?? existing?.consentNote, 200),
    showName: (input.showName ?? existing?.showName) === true,
    updatedAt: new Date().toISOString(),
    updatedBy: input.by,
  };
  if (!merged.parentName && !merged.householdId) return { ok: false, error: "Pick the family" };
  if (merged.status === "approved" && !merged.consentNote) return { ok: false, error: "Record how the parent approved (e.g. WhatsApp YES on a date) before marking approved" };
  if (merged.status === "approved" && !(merged.polishedText || merged.rawText)) return { ok: false, error: "Nothing to approve yet" };
  const exists = state.testimonials.some((t) => t.id === merged.id);
  return {
    ok: true,
    testimonial: merged,
    state: { ...state, testimonials: exists ? state.testimonials.map((t) => (t.id === merged.id ? merged : t)) : [merged, ...state.testimonials] },
  };
}

export function removeTestimonial(state: ReferralsState, id: string): ReferralsState {
  return { ...state, testimonials: state.testimonials.filter((t) => t.id !== id) };
}

/**
 * Polish guard: the polished text may fix grammar and trim, but must not
 * add numbers the parent did not say, grow by more than 20 %, or drop
 * below a third of the original. Returns the reasons it fails.
 */
export function testimonialPolishProblems(raw: string, polished: string): string[] {
  const out: string[] = [];
  if (!polished.trim()) return ["empty"];
  const added = ungroundedNumbers(polished, raw);
  if (added.length) out.push(`adds numbers not in the parent's words: ${added.join(", ")}`);
  if (polished.length > raw.length * 1.2 + 40) out.push("longer than the parent's words — polish must not add content");
  if (polished.length < raw.length / 3) out.push("cut too much — keep the parent's meaning");
  return out;
}

/** Fact lines for the Marketing generator — approved only, name only if allowed. */
export function approvedTestimonialLines(state: ReferralsState): string[] {
  return state.testimonials
    .filter((t) => t.status === "approved" && (t.polishedText || t.rawText))
    .map((t) => `Parent testimonial (approved${t.approvedAt ? ` ${t.approvedAt.slice(0, 10)}` : ""}${t.showName && t.parentName ? `, ${t.parentName}` : ", name withheld"}${t.studentLabel ? `, ${t.studentLabel}` : ""}): "${(t.polishedText || t.rawText).replace(/\s+/g, " ")}"`);
}
