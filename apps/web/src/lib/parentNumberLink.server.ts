/**
 * Server side of linking a parent's new phone number (lib/parentNumberLink).
 */

import { randomBytes } from "node:crypto";
import { childrenOnRoll } from "@/lib/appPopups";
import { loadMasters } from "@/lib/masters";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import {
  emptyParentLinkState,
  linkedHousehold,
  livePending,
  matchChild,
  maskMobile,
  normalizeParentLinkState,
  withLinked,
  type LinkRequest,
  type ParentLinkState,
} from "@/lib/parentNumberLink";
import { householdMobile10 } from "@/lib/parentHousehold.server";
import { issueParentOtp, normalizeMobile10, verifyParentOtp } from "@/lib/parentOtp.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";

const KEY = "parent_linked_mobiles" as const;

/** null = could not read (never treated as "nothing linked"). */
export async function readParentLinks(): Promise<ParentLinkState | null> {
  const row = await readModuleLocalState<unknown>(KEY);
  if (!row) return null;
  return row.state ? normalizeParentLinkState(row.state) : emptyParentLinkState();
}

export async function writeParentLinks(state: ParentLinkState): Promise<boolean> {
  const w = await writeModuleLocalState(KEY, state);
  return w.ok;
}

/** The household a number was linked to from the app ("" = none, or unreadable). */
export async function householdLinkedTo(mobile10: string): Promise<string> {
  const s = await readParentLinks();
  return s ? linkedHousehold(s, mobile10) : "";
}

/** A family's WhatsApp-able number on record, where the code is sent. */
export function registeredMobileOf(h: Household, children: SisStudent[]): string {
  const ok = (v: string | undefined) => {
    const m = householdMobile10(v || "");
    return /^[6-9]\d{9}$/.test(m) ? m : "";
  };
  return (
    ok(h.whatsappMobile) ||
    ok(h.mobile) ||
    ok(h.altMobile) ||
    children.map((c) => ok(c.fatherMobile) || ok(c.motherMobile)).find(Boolean) ||
    ""
  );
}

// Guessing an admission number + date of birth must not be cheap.
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60 * 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export type LinkStart =
  | { kind: "code_sent"; linkId: string; maskedRegistered: string; childFirstName: string }
  | { kind: "need_class"; classes: string[] }
  | { kind: "no_match" }
  | { kind: "no_registered_phone" }
  | { kind: "error"; message: string; status: number };

async function onRollChildren(): Promise<{ onRoll: SisStudent[]; classNameOf: (id: string) => string }> {
  await ensureSisHydratedServer();
  const ay = (await resolveLoginAcademicYearCode(undefined).catch(() => null)) || "";
  const classes = new Map((loadMasters().classes ?? []).map((c) => [c.id, c.name]));
  return { onRoll: childrenOnRoll(loadSis().students, ay), classNameOf: (id) => classes.get(id) ?? "" };
}

export async function startNumberLink(input: {
  mobile: string;
  childName?: string;
  admissionNo?: string;
  dob: string;
  className?: string;
  ip: string;
}): Promise<LinkStart> {
  const mobile10 = normalizeMobile10(input.mobile);
  if (!mobile10 || !/^[6-9]\d{9}$/.test(mobile10)) return { kind: "error", message: "Enter a valid 10-digit mobile number.", status: 400 };
  if (tooMany(`m:${mobile10}`, 6) || tooMany(`ip:${input.ip}`, 15)) {
    return { kind: "error", message: "Too many tries — please wait an hour, or ask the school office.", status: 429 };
  }
  const { onRoll, classNameOf } = await onRollChildren();
  const match = matchChild(onRoll, input, classNameOf);
  if (match.kind === "many") return { kind: "need_class", classes: match.classes };
  if (match.kind === "none") return { kind: "no_match" };

  const child = match.student;
  const sis = loadSis();
  const household = sis.households.find((h) => h.id === child.householdId);
  if (!household) return { kind: "no_match" };
  const registered = registeredMobileOf(household, onRoll.filter((s) => s.householdId === household.id));
  if (!registered) return { kind: "no_registered_phone" };
  if (registered === mobile10) {
    return { kind: "error", message: "This is already the family's number — go back and log in with it.", status: 400 };
  }

  const state = await readParentLinks();
  if (!state) return { kind: "error", message: "Could not start just now — please try again in a minute.", status: 503 };
  const sent = await issueParentOtp({ mobile: registered, householdId: household.id });
  if (!sent.ok) return { kind: "error", message: sent.reason, status: 502 };
  const linkId = `lnk_${randomBytes(9).toString("base64url")}`;
  const now = new Date().toISOString();
  const next: ParentLinkState = {
    ...state,
    pending: [
      { id: linkId, mobile10, householdId: household.id, registeredMobile10: registered, childName: child.fullName, createdAt: now },
      ...livePending(state, Date.now()).filter((p) => p.mobile10 !== mobile10),
    ].slice(0, 200),
  };
  if (!(await writeParentLinks(next))) return { kind: "error", message: "Could not start just now — please try again.", status: 503 };
  return { kind: "code_sent", linkId, maskedRegistered: maskMobile(registered), childFirstName: child.fullName.split(/\s+/)[0] || "" };
}

/** The code from the registered phone: links the new number and returns its family. */
export async function finishNumberLink(
  linkId: string,
  code: string,
): Promise<{ ok: true; householdId: string; mobile10: string } | { ok: false; message: string; status: number }> {
  const state = await readParentLinks();
  if (!state) return { ok: false, message: "Could not check the code just now — please try again.", status: 503 };
  const p = livePending(state, Date.now()).find((x) => x.id === linkId);
  if (!p) return { ok: false, message: "This code has expired — start again.", status: 410 };
  const v = await verifyParentOtp({ mobile: p.registeredMobile10, code });
  if (!v.ok) return { ok: false, message: v.reason, status: 401 };
  const next = withLinked(
    { ...state, pending: state.pending.filter((x) => x.id !== linkId) },
    {
      mobile10: p.mobile10,
      householdId: p.householdId,
      childName: p.childName,
      via: "registered_code",
      linkedAt: new Date().toISOString(),
      by: `code to ${maskMobile(p.registeredMobile10)}`,
    },
  );
  if (!(await writeParentLinks(next))) return { ok: false, message: "Could not save just now — please try again.", status: 503 };
  return { ok: true, householdId: p.householdId, mobile10: p.mobile10 };
}

/** Without the registered phone (or no match): the office decides. */
export async function requestOfficeLink(input: {
  mobile: string;
  childName?: string;
  admissionNo?: string;
  dob?: string;
  className?: string;
  note?: string;
  ip: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const mobile10 = normalizeMobile10(input.mobile);
  if (!mobile10 || !/^[6-9]\d{9}$/.test(mobile10)) return { ok: false, message: "Enter a valid 10-digit mobile number.", status: 400 };
  if (tooMany(`o:${input.ip}`, 10)) return { ok: false, message: "Too many requests — please call the school office.", status: 429 };
  const { onRoll, classNameOf } = await onRollChildren();
  const match = input.dob ? matchChild(onRoll, { ...input, dob: input.dob }, classNameOf) : ({ kind: "none" } as const);
  const state = await readParentLinks();
  if (!state) return { ok: false, message: "Could not send just now — please try again.", status: 503 };
  const req: LinkRequest = {
    id: `req_${randomBytes(6).toString("base64url")}`,
    mobile10,
    childName: String(input.childName ?? "").slice(0, 120),
    admissionNo: String(input.admissionNo ?? "").slice(0, 40),
    dob: String(input.dob ?? "").slice(0, 10),
    className: String(input.className ?? "").slice(0, 40),
    note: String(input.note ?? "").slice(0, 300),
    householdId: match.kind === "one" ? match.student.householdId : "",
    matchedChild: match.kind === "one" ? match.student.fullName : "",
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: "",
    decidedBy: "",
  };
  const next: ParentLinkState = {
    ...state,
    // One open request per number: a new one replaces it.
    requests: [req, ...state.requests.filter((r) => !(r.mobile10 === mobile10 && r.status === "pending"))].slice(0, 1000),
  };
  return (await writeParentLinks(next)) ? { ok: true } : { ok: false, message: "Could not send just now — please try again.", status: 503 };
}

/** The office approves (linking to the matched family, or one they pick) or refuses. */
export async function decideOfficeLink(input: {
  id: string;
  approve: boolean;
  householdId?: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const state = await readParentLinks();
  if (!state) return { ok: false, message: "Could not read the requests — try again.", status: 503 };
  const req = state.requests.find((r) => r.id === input.id);
  if (!req) return { ok: false, message: "Request not found.", status: 404 };
  const now = new Date().toISOString();
  let next: ParentLinkState = {
    ...state,
    requests: state.requests.map((r) =>
      r.id === input.id ? { ...r, status: input.approve ? "approved" : "refused", decidedAt: now, decidedBy: input.by } : r,
    ),
  };
  if (input.approve) {
    const hh = input.householdId || req.householdId;
    if (!hh || !loadSis().households.some((h) => h.id === hh)) {
      return { ok: false, message: "Choose the family this number belongs to.", status: 400 };
    }
    next = withLinked(next, { mobile10: req.mobile10, householdId: hh, childName: req.matchedChild || req.childName, via: "office", linkedAt: now, by: input.by });
  }
  return (await writeParentLinks(next)) ? { ok: true } : { ok: false, message: "Could not save — try again.", status: 503 };
}

/** The office removes a linked number. */
export async function unlinkNumber(mobile10: string): Promise<boolean> {
  const state = await readParentLinks();
  if (!state) return false;
  return writeParentLinks({ ...state, linked: state.linked.filter((l) => l.mobile10 !== mobile10) });
}

/** The household + children for a linked number, read straight from the database. */
export async function fetchLinkedHousehold(mobile10: string): Promise<{ household: Household; students: SisStudent[] } | null> {
  const householdId = await householdLinkedTo(mobile10);
  if (!householdId) return null;
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { rowToHousehold, rowToStudent } = await import("@/lib/sisNormalized.server");
  const [hh, st] = await Promise.all([
    ctx.sb.from("sis_households").select("*").eq("tenant_id", ctx.tenantId).eq("id", householdId).maybeSingle(),
    ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).eq("household_id", householdId).limit(200),
  ]);
  if (hh.error || st.error || !hh.data) return null;
  return {
    household: rowToHousehold(hh.data as Parameters<typeof rowToHousehold>[0]),
    students: (st.data ?? []).map((r) => rowToStudent(r as Parameters<typeof rowToStudent>[0])),
  };
}
