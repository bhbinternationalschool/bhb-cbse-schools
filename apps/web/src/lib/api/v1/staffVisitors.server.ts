/**
 * The gate, on the phone of whoever is standing at it.
 *
 * Until now a visitor could self-register by scanning the QR poster, or
 * reception could type them in on a desktop — but the person actually at the
 * gate had neither. This is that third path: check in, check out, and hand a
 * child over against an approved early-pickup pass.
 *
 * It writes the SAME store the reception desk and the gate QR use
 * (module_local_state "visitors"), through mergeWriteVisitorState, which
 * unions by id. That matters here more than anywhere: reception and the gate
 * are two people writing the same log at the same moment, and a last-write-
 * wins push would drop one of them on the floor.
 */

import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import {
  mergeWriteVisitorState,
  openVisitFor,
  readVisitorState,
  todayIstKey,
} from "@/lib/visitorSelfService.server";
import {
  cleanIndianMobile,
  cleanPeopleCount,
  cleanVehicleNo,
  maskAadhaarInText,
} from "@/lib/staffScanReading";
import {
  VISITOR_PURPOSES,
  peopleCountOf,
  gatePassStatusLabel,
  nextVisitorNo,
  visitorPurposeLabel,
  visitorQrPayload,
  type GatePass,
  type VisitorEntry,
  type VisitorPurpose,
  type VisitorState,
} from "@/lib/visitors";

const PURPOSES = new Set<string>(VISITOR_PURPOSES.map((p) => p.value));

export function isVisitorPurpose(v: string): v is VisitorPurpose {
  return PURPOSES.has(v);
}

/** Loud when the store is unreachable — an empty gate log is never a fact. */
export async function loadVisitorState(): Promise<VisitorState> {
  const cur = await readVisitorState();
  if (!cur) {
    throw new ApiError("server_error", "The visitor log is unavailable right now", 503);
  }
  return cur.state;
}

/** Who this staff member is, for the createdBy stamp on an entry. */
export function actorName(ctx: ApiAuthContext): string {
  const self = ctx.masters.staff.find((s) => s.id === ctx.session.staffId);
  return self?.fullName || ctx.session.fullName || "gate";
}

export type GateVisitorOut = {
  id: string;
  visitorNo: string;
  visitorName: string;
  mobile: string;
  purpose: VisitorPurpose;
  purposeLabel: string;
  personToMeet: string;
  linkedTo: string;
  source: string;
  idProofNote: string;
  peopleCount: number;
  vehicleNo: string;
  address: string;
  inTime: string;
  outTime: string | null;
  onCampus: boolean;
  createdBy: string;
};

export function toGateVisitor(v: VisitorEntry): GateVisitorOut {
  return {
    id: v.id,
    visitorNo: v.visitorNo || "",
    visitorName: v.visitorName,
    mobile: v.mobile,
    purpose: v.purpose,
    purposeLabel: visitorPurposeLabel(v.purpose),
    personToMeet: v.personToMeet || "",
    linkedTo: v.linkedTo || "",
    source: v.source || "reception",
    idProofNote: v.idProofNote || "",
    peopleCount: peopleCountOf(v.peopleCount),
    vehicleNo: v.vehicleNo || "",
    address: v.address || "",
    inTime: v.inTime,
    outTime: v.outTime,
    onCampus: !v.outTime,
    createdBy: v.createdBy || "",
  };
}

/**
 * The gate board: everyone still on campus (however long they have been
 * here — a visitor who never checked out yesterday is exactly who the guard
 * needs to see), then today's departures.
 */
export function gateBoard(state: VisitorState): {
  onCampus: GateVisitorOut[];
  departedToday: GateVisitorOut[];
} {
  const today = todayIstKey();
  const onCampus = state.visitorLog
    .filter((v) => !v.outTime)
    .sort((a, b) => b.inTime.localeCompare(a.inTime))
    .map(toGateVisitor);
  const departedToday = state.visitorLog
    .filter((v) => v.outTime && todayIstKey(new Date(v.outTime)) === today)
    .sort((a, b) => String(b.outTime).localeCompare(String(a.outTime)))
    .map(toGateVisitor);
  return { onCampus, departedToday };
}

export type GatePassOut = {
  id: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  date: string;
  requestedPickupTime: string;
  reason: string;
  status: GatePass["status"];
  statusLabel: string;
  requestedBy: string;
  pickedUpByName: string;
  actualPickupTime: string | null;
  notifiedParentAt: string | null;
  /** Only an approved pass for today may actually release a child. */
  releasable: boolean;
};

/**
 * Today's passes. A guard needs the whole day's list, not just the open ones
 * — "was he already collected, and by whom?" is the question that gets asked
 * when two people turn up for the same child.
 */
export function gatePassesForDay(
  state: VisitorState,
  day: string,
  naming: {
    studentName: (id: string) => string;
    classLabel: (id: string) => string;
    staffName: (id: string) => string;
  },
): GatePassOut[] {
  return state.gatePasses
    .filter((g) => g.date === day)
    .sort((a, b) =>
      a.requestedPickupTime.localeCompare(b.requestedPickupTime) ||
      b.createdAt.localeCompare(a.createdAt),
    )
    .map((g) => ({
      id: g.id,
      studentId: g.studentId,
      studentName: naming.studentName(g.studentId),
      classLabel: naming.classLabel(g.studentId),
      date: g.date,
      requestedPickupTime: g.requestedPickupTime || "",
      reason: g.reason || "",
      status: g.status,
      statusLabel: gatePassStatusLabel(g.status),
      requestedBy: naming.staffName(g.requestedByStaffId),
      pickedUpByName: g.pickedUpByName || "",
      actualPickupTime: g.actualPickupTime,
      notifiedParentAt: g.notifiedParentAt,
      releasable: g.status === "approved" && g.date === todayIstKey(),
    }));
}

/** A phone-made visit id: lets a retried check-in find the visit it already made. */
const CLIENT_VISIT_ID = /^visit_[a-z0-9]{8,24}$/;

export type GateCheckInInput = {
  visitorName: string;
  /** Optional (the visitor register never required one); 10-digit Indian when given. */
  mobile: string;
  purpose: VisitorPurpose;
  personToMeet?: string;
  idProofNote?: string;
  linkedTo?: string;
  peopleCount?: unknown;
  vehicleNo?: string;
  address?: string;
  /** Made by the phone when the sheet opens, kept across retries. */
  clientId?: string;
};

/**
 * Validate and build the entry — pure, so the rules have a test of their own
 * (staffScanReading.selftest.ts). A string is the reason it was refused.
 */
export function buildGateEntry(
  state: VisitorState,
  input: GateCheckInInput,
  actor: string,
  now: Date,
  newId: () => string,
): VisitorEntry | string {
  const name = input.visitorName.trim();
  if (!name) return "Visitor name required";
  const mobile = cleanIndianMobile(input.mobile);
  if (!mobile.ok) return mobile.error;
  if (!isVisitorPurpose(input.purpose)) return "Unknown purpose";
  const people = cleanPeopleCount(input.peopleCount);
  if (!people.ok) return people.error;
  const clientId = (input.clientId || "").trim();
  const id = CLIENT_VISIT_ID.test(clientId) ? clientId : newId();
  return {
    id,
    visitorNo: nextVisitorNo(state, now),
    source: "reception",
    linkedTo: input.linkedTo?.trim() || undefined,
    visitorName: name.slice(0, 120),
    mobile: mobile.mobile,
    purpose: input.purpose,
    personToMeet: (input.personToMeet || "").trim().slice(0, 120),
    inTime: now.toISOString(),
    outTime: null,
    // Masked here as well as in the normaliser: an Aadhaar typed in full by
    // the guard must not reach the store, the audit row or the reply.
    idProofNote: maskAadhaarInText((input.idProofNote || "").trim()).slice(0, 200),
    peopleCount: people.count,
    vehicleNo: cleanVehicleNo(input.vehicleNo) || undefined,
    address: maskAadhaarInText((input.address || "").trim()).slice(0, 200) || undefined,
    qrPayload: visitorQrPayload(id, name),
    createdBy: actor,
    createdAt: now.toISOString(),
  };
}

/**
 * Check a visitor in from the gate.
 *
 * Idempotent two ways, because a guard taps twice on a slow connection: the
 * phone's own visit id finds the visit this sheet already made, and a mobile
 * already on campus returns its open visit rather than a second one.
 */
export async function gateCheckIn(
  ctx: ApiAuthContext,
  input: GateCheckInInput,
): Promise<{ entry: VisitorEntry; alreadyIn: boolean }> {
  const state = await loadVisitorState();
  const built = buildGateEntry(
    state,
    input,
    actorName(ctx),
    new Date(),
    () => `visit_${Math.random().toString(36).slice(2, 10)}`,
  );
  if (typeof built === "string") throw new ApiError("bad_request", built, 400);

  const same = state.visitorLog.find((v) => v.id === built.id);
  if (same) return { entry: same, alreadyIn: true };
  if (built.mobile) {
    const existing = openVisitFor(state, built.mobile);
    if (existing) return { entry: existing, alreadyIn: true };
  }

  const merged = await mergeWriteVisitorState({
    version: 1,
    visitorLog: [built],
    gatePasses: [],
  });
  if (!merged) throw new ApiError("server_error", "Could not save the check-in", 500);
  return { entry: built, alreadyIn: false };
}

/** Check a visitor out. Already-out is reported, not silently re-stamped. */
export async function gateCheckOut(
  id: string,
): Promise<{ entry: VisitorEntry; alreadyOut: boolean }> {
  const state = await loadVisitorState();
  const found = state.visitorLog.find((v) => v.id === id);
  if (!found) throw new ApiError("not_found", "No such visit", 404);
  if (found.outTime) return { entry: found, alreadyOut: true };

  const done: VisitorEntry = { ...found, outTime: new Date().toISOString() };
  const merged = await mergeWriteVisitorState({
    version: 1,
    visitorLog: [done],
    gatePasses: [],
  });
  if (!merged) throw new ApiError("server_error", "Could not save the check-out", 500);
  return { entry: done, alreadyOut: false };
}

/**
 * May this child be handed over, and if not, why not?
 *
 * Approved only, today only, once only, and never without the name of
 * whoever collected them. Those are the four things somebody will ask about
 * afterwards, so they are one pure function with its own test rather than
 * four ifs buried in a request handler.
 */
export function releaseRefusal(
  pass: GatePass | undefined,
  pickedUpByName: string,
  today: string,
): ApiError | null {
  if (!pass) return new ApiError("not_found", "No such gate pass", 404);
  if (!pickedUpByName.trim()) {
    return new ApiError("bad_request", "Record who collected the child", 400);
  }
  if (pass.status === "picked_up") {
    return new ApiError(
      "conflict",
      `Already collected${pass.pickedUpByName ? ` by ${pass.pickedUpByName}` : ""}`,
      409,
    );
  }
  if (pass.status !== "approved") {
    return new ApiError(
      "forbidden",
      `This pass is ${gatePassStatusLabel(pass.status).toLowerCase()}, not approved — do not release the child`,
      403,
    );
  }
  if (pass.date !== today) {
    return new ApiError("forbidden", `This pass is dated ${pass.date}, not today`, 403);
  }
  return null;
}

/** Hand the child over, once releaseRefusal is satisfied. */
export async function releaseOnGatePass(
  id: string,
  pickedUpByName: string,
): Promise<GatePass> {
  const who = pickedUpByName.trim().slice(0, 120);
  const state = await loadVisitorState();
  const pass = state.gatePasses.find((g) => g.id === id);
  const refusal = releaseRefusal(pass, who, todayIstKey());
  if (refusal) throw refusal;
  if (!pass) throw new ApiError("not_found", "No such gate pass", 404);

  const now = new Date().toISOString();
  const done: GatePass = {
    ...pass,
    status: "picked_up",
    pickedUpByName: who,
    actualPickupTime: now,
    updatedAt: now,
  };
  const merged = await mergeWriteVisitorState({
    version: 1,
    visitorLog: [],
    gatePasses: [done],
  });
  if (!merged) throw new ApiError("server_error", "Could not save the release", 500);
  return done;
}
