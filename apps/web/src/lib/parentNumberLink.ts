/**
 * A parent links a new phone number to their family from the app
 * (director, 10 Oct 2026).
 *
 * Most failed app logins are a parent on a phone the school never recorded
 * (the other parent's phone, a new SIM) — 15 of 19 numbers on 10 Oct were
 * nowhere in the school's records. The app now lets them link it:
 *
 *   1. they name the child — admission number OR the child's name — and the
 *      exact date of birth (always required);
 *   2. exactly one child on roll must match; several → the class is asked;
 *   3. a WhatsApp code goes to the family's REGISTERED number (shown masked);
 *      typing it links the new number automatically and signs them in;
 *   4. without that phone, or with no match, the request goes to the office,
 *      who approve it with one tap.
 *
 * Nobody joins a family on a phone number alone: identity needs the date of
 * birth, and the link needs the registered phone or the office.
 *
 * module_local_state "parent_linked_mobiles" (server-only). Pure.
 */

import type { SisStudent } from "@/lib/sis";

export type LinkedMobile = {
  mobile10: string;
  householdId: string;
  childName: string;
  via: "registered_code" | "office";
  linkedAt: string;
  by: string;
};

export type LinkRequest = {
  id: string;
  mobile10: string;
  /** What the parent typed. */
  childName: string;
  admissionNo: string;
  dob: string;
  className: string;
  note: string;
  /** The family the details matched, when exactly one did. */
  householdId: string;
  matchedChild: string;
  status: "pending" | "approved" | "refused";
  createdAt: string;
  decidedAt: string;
  decidedBy: string;
};

/** A code sent to the registered number, waiting to be typed (10 minutes). */
export type PendingLink = {
  id: string;
  mobile10: string;
  householdId: string;
  registeredMobile10: string;
  childName: string;
  createdAt: string;
};

export type ParentLinkState = {
  version: 1;
  linked: LinkedMobile[];
  requests: LinkRequest[];
  pending: PendingLink[];
};

export const PENDING_TTL_MS = 10 * 60_000;

export function emptyParentLinkState(): ParentLinkState {
  return { version: 1, linked: [], requests: [], pending: [] };
}

const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const m10 = (v: unknown) => (/^\d{10}$/.test(String(v ?? "")) ? String(v) : "");

export function normalizeParentLinkState(raw: unknown): ParentLinkState {
  const r = (raw ?? {}) as Partial<ParentLinkState>;
  return {
    version: 1,
    linked: (Array.isArray(r.linked) ? r.linked : [])
      .filter((x) => m10(x?.mobile10) && x?.householdId)
      .map((x) => ({
        mobile10: m10(x.mobile10),
        householdId: str(x.householdId, 80),
        childName: str(x.childName),
        via: x.via === "office" ? "office" : "registered_code",
        linkedAt: str(x.linkedAt, 40),
        by: str(x.by),
      })),
    requests: (Array.isArray(r.requests) ? r.requests : [])
      .filter((x) => x?.id && m10(x?.mobile10))
      .map((x) => ({
        id: str(x.id, 40),
        mobile10: m10(x.mobile10),
        childName: str(x.childName),
        admissionNo: str(x.admissionNo, 40),
        dob: str(x.dob, 10),
        className: str(x.className, 40),
        note: str(x.note, 300),
        householdId: str(x.householdId, 80),
        matchedChild: str(x.matchedChild),
        status: x.status === "approved" || x.status === "refused" ? x.status : "pending",
        createdAt: str(x.createdAt, 40),
        decidedAt: str(x.decidedAt, 40),
        decidedBy: str(x.decidedBy),
      })),
    pending: (Array.isArray(r.pending) ? r.pending : [])
      .filter((x) => x?.id && m10(x?.mobile10) && m10(x?.registeredMobile10))
      .map((x) => ({
        id: str(x.id, 40),
        mobile10: m10(x.mobile10),
        householdId: str(x.householdId, 80),
        registeredMobile10: m10(x.registeredMobile10),
        childName: str(x.childName),
        createdAt: str(x.createdAt, 40),
      })),
  };
}

/** Names compared the way people spell them: case, spaces, titles and common swaps evened out. */
export function nameKey(name: string): string[] {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/sh/g, "s")
    .replace(/w/g, "v")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ph/g, "f")
    .replace(/(.)\1+/g, "$1")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["kumar", "kumari", "km", "md", "mohd"].includes(t));
}

/** Typed and recorded names agree when one's words are all in the other's (e.g. "Aarav" ~ "Aarav Singh"). */
export function namesAgree(typed: string, recorded: string): boolean {
  const a = nameKey(typed);
  const b = nameKey(recorded);
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((t) => long.includes(t));
}

/** "BHB-2024-25-1139", "1139", "bhb 2024-25 1139" — the serial at the end decides. */
export function admissionAgrees(typed: string, recorded: string): boolean {
  const t = String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const r = String(recorded ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t || !r) return false;
  if (t === r) return true;
  // The serial is the LAST group of digits as written ("…-25-1139" → 1139);
  // stripping the dashes first would run it into the year.
  const serial = (s: string) => String(s ?? "").match(/(\d+)\D*$/)?.[1]?.replace(/^0+/, "") ?? "";
  const typedSerial = serial(typed);
  return /^\d{1,6}$/.test(String(typed ?? "").trim()) && typedSerial !== "" && typedSerial === serial(recorded);
}

export type ChildMatch =
  | { kind: "one"; student: SisStudent }
  | { kind: "many"; classes: string[] }
  | { kind: "none" };

/**
 * The child the parent means, among children ON ROLL. Date of birth must be
 * exact; then the admission number or the name; then the class, if given.
 */
export function matchChild(
  onRoll: SisStudent[],
  input: { childName?: string; admissionNo?: string; dob: string; className?: string },
  classNameOf: (classId: string) => string,
): ChildMatch {
  const dob = String(input.dob ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { kind: "none" };
  let hits = onRoll.filter((s) => String(s.dob ?? "").slice(0, 10) === dob);
  if (input.admissionNo?.trim()) hits = hits.filter((s) => admissionAgrees(input.admissionNo!, s.admissionNo));
  else if (input.childName?.trim()) hits = hits.filter((s) => namesAgree(input.childName!, s.fullName));
  else return { kind: "none" };
  if (input.className?.trim() && hits.length > 1) {
    const want = input.className.trim().toLowerCase();
    hits = hits.filter((s) => classNameOf(s.classId).trim().toLowerCase() === want);
  }
  if (hits.length === 1) return { kind: "one", student: hits[0]! };
  if (hits.length > 1) return { kind: "many", classes: [...new Set(hits.map((s) => classNameOf(s.classId)).filter(Boolean))] };
  return { kind: "none" };
}

export function maskMobile(m: string): string {
  return /^\d{10}$/.test(m) ? `******${m.slice(-4)}` : "";
}

/** The household a linked number belongs to ("" if none). */
export function linkedHousehold(state: ParentLinkState, mobile10: string): string {
  return state.linked.find((l) => l.mobile10 === mobile10)?.householdId ?? "";
}

/** Add (or move) a linked number. */
export function withLinked(state: ParentLinkState, link: LinkedMobile): ParentLinkState {
  return { ...state, linked: [link, ...state.linked.filter((l) => l.mobile10 !== link.mobile10)].slice(0, 2000) };
}

/** Pending codes still within their 10 minutes. */
export function livePending(state: ParentLinkState, now: number): PendingLink[] {
  return state.pending.filter((p) => now - Date.parse(p.createdAt) < PENDING_TTL_MS);
}
