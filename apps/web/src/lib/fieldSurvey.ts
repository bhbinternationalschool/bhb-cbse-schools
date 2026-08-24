/**
 * Field survey — beats, attendance/productivity, offline queue, bulk-to-registration.
 * Beats/attendance live in admissions state; offline drafts in a separate localStorage key.
 */

import {
  createEnquiry,
  loadAdmissions,
  saveAdmissions,
  sendLeadToRegistration,
  todayYmd,
  type AdmissionLead,
  type AdmissionsState,
  type SurveyAttendance,
  type SurveyBeat,
  type SurveyBreak,
  type SurveyExternalAgent,
  type SurveyGeoPoint,
  type SurveyTeamMember,
  type SurveyWorkSession,
} from "@/lib/admissions";
import { normalizeMobile } from "@/lib/sis";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  syncStaffAttendanceOnSurveyEnd,
  syncStaffAttendanceOnSurveyStart,
  surveySalaryDayOutcome,
} from "@/lib/surveyAttendanceBridge";

export type {
  SurveyAttendance,
  SurveyBeat,
  SurveyBreak,
  SurveyExternalAgent,
  SurveyGeoPoint,
  SurveyTeamMember,
  SurveyWorkSession,
};

const OFFLINE_KEY = "bhb_survey_offline_v1";

export type SurveyOfflineDraft = {
  id: string;
  queuedAt: string;
  beatId: string;
  beatName: string;
  childName: string;
  /** Exact birth date when the parent knew it. */
  dob: string;
  /**
   * Parent-stated age in years, when they did not.
   *
   * Carried through the offline queue because door-to-door survey work is
   * mostly offline, and the queue previously dropped age entirely — every
   * lead captured without signal arrived unscoreable on the one field the
   * survey had just collected.
   */
  ageYearsApprox: number;
  guardianName: string;
  motherName: string;
  mobile: string;
  classSoughtId: string;
  /** URL of the uploaded photo. NEVER a data: URL — see admissions.ts. */
  surveyPhotoUrl: string;
  parentConsent: boolean;
  by: string;
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptySurveyBeat(partial?: Partial<SurveyBeat>): SurveyBeat {
  const now = new Date().toISOString();
  return {
    id: partial?.id || nid("sbt"),
    code: partial?.code || "",
    name: (partial?.name || "").trim(),
    area: (partial?.area || "").trim(),
    targetHouseholds: Math.max(
      0,
      Math.round(Number(partial?.targetHouseholds) || 0),
    ),
    isActive: partial?.isActive !== false,
    note: partial?.note || "",
    createdAt: partial?.createdAt || now,
  };
}

export function emptySurveyAttendance(
  partial?: Partial<SurveyAttendance>,
): SurveyAttendance {
  return {
    id: partial?.id || nid("sat"),
    date: (partial?.date || todayYmd()).slice(0, 10),
    agentName: (partial?.agentName || "").trim(),
    checkInAt: partial?.checkInAt || "",
    checkOutAt: partial?.checkOutAt || "",
    beatId: partial?.beatId || "",
    note: partial?.note || "",
  };
}

export function defaultSurveyBeats(): SurveyBeat[] {
  const now = new Date().toISOString();
  const seeds = [
    { code: "BT-01", name: "Murdaha", area: "West Varanasi", target: 80 },
    { code: "BT-02", name: "Lanka", area: "BHU side", target: 60 },
    { code: "BT-03", name: "Sigra", area: "Central", target: 50 },
    { code: "BT-04", name: "Cantt", area: "Cantonment", target: 40 },
  ];
  return seeds.map((s, i) =>
    emptySurveyBeat({
      id: `sbt_seed_${i + 1}`,
      code: s.code,
      name: s.name,
      area: s.area,
      targetHouseholds: s.target,
      createdAt: now,
    }),
  );
}

/** Ensure state has survey beat / attendance arrays (backfill seeds). */
export function ensureSurveyMasters(state: AdmissionsState): AdmissionsState {
  const beats = Array.isArray(state.surveyBeats) ? state.surveyBeats : [];
  const attendance = Array.isArray(state.surveyAttendance)
    ? state.surveyAttendance
    : [];
  const nextBeatSeq =
    Number.isFinite(Number(state.nextBeatSeq)) && state.nextBeatSeq > 0
      ? Math.round(state.nextBeatSeq)
      : Math.max(5, beats.length + 1);

  if (beats.length > 0) {
    return {
      ...state,
      surveyBeats: beats.map((b) => emptySurveyBeat(b)),
      surveyAttendance: attendance.map((a) => emptySurveyAttendance(a)),
      surveyExternals: Array.isArray(state.surveyExternals)
        ? state.surveyExternals
        : [],
      surveyTeam: Array.isArray(state.surveyTeam) ? state.surveyTeam : [],
      surveySessions: Array.isArray(state.surveySessions)
        ? state.surveySessions
        : [],
      nextBeatSeq,
    };
  }
  return {
    ...state,
    surveyBeats: defaultSurveyBeats(),
    surveyAttendance: [],
    surveyExternals: Array.isArray(state.surveyExternals)
      ? state.surveyExternals
      : [],
    surveyTeam: Array.isArray(state.surveyTeam) ? state.surveyTeam : [],
    surveySessions: Array.isArray(state.surveySessions)
      ? state.surveySessions
      : [],
    nextBeatSeq: 5,
  };
}

export function upsertSurveyBeat(
  state: AdmissionsState,
  beat: Partial<SurveyBeat> & { name: string },
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  const beats = [...s.surveyBeats];
  if (beat.id && beats.some((b) => b.id === beat.id)) {
    return {
      ...s,
      surveyBeats: beats.map((b) =>
        b.id === beat.id ? emptySurveyBeat({ ...b, ...beat }) : b,
      ),
    };
  }
  const seq = s.nextBeatSeq || beats.length + 1;
  const row = emptySurveyBeat({
    ...beat,
    id: nid("sbt"),
    code: beat.code || `BT-${String(seq).padStart(2, "0")}`,
  });
  return {
    ...s,
    surveyBeats: [row, ...beats],
    nextBeatSeq: seq + 1,
  };
}

export function setSurveyBeatActive(
  state: AdmissionsState,
  beatId: string,
  isActive: boolean,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  return {
    ...s,
    surveyBeats: s.surveyBeats.map((b) =>
      b.id === beatId ? { ...b, isActive } : b,
    ),
  };
}

export function checkInSurveyAgent(
  state: AdmissionsState,
  agentName: string,
  beatId: string,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  const date = todayYmd();
  const name = agentName.trim();
  const existing = s.surveyAttendance.find(
    (a) => a.date === date && a.agentName.toLowerCase() === name.toLowerCase(),
  );
  const now = new Date().toISOString();
  if (existing) {
    return {
      ...s,
      surveyAttendance: s.surveyAttendance.map((a) =>
        a.id === existing.id
          ? {
              ...a,
              beatId: beatId || a.beatId,
              checkInAt: a.checkInAt || now,
              checkOutAt: "",
            }
          : a,
      ),
    };
  }
  const row = emptySurveyAttendance({
    date,
    agentName: name,
    beatId,
    checkInAt: now,
  });
  return {
    ...s,
    surveyAttendance: [row, ...s.surveyAttendance],
  };
}

export function checkOutSurveyAgent(
  state: AdmissionsState,
  agentName: string,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  const date = todayYmd();
  const name = agentName.trim().toLowerCase();
  const now = new Date().toISOString();
  return {
    ...s,
    surveyAttendance: s.surveyAttendance.map((a) =>
      a.date === date && a.agentName.toLowerCase() === name && !a.checkOutAt
        ? { ...a, checkOutAt: now }
        : a,
    ),
  };
}

export type AgentProductivityRow = {
  agentName: string;
  captures: number;
  open: number;
  registered: number;
  admitted: number;
  checkedIn: boolean;
  beatId: string;
};

export function surveyAgentProductivity(
  state: AdmissionsState,
  date = todayYmd(),
): AgentProductivityRow[] {
  const s = ensureSurveyMasters(state);
  const map = new Map<string, AgentProductivityRow>();

  for (const a of s.surveyAttendance) {
    if (a.date !== date) continue;
    const key = a.agentName.trim() || "—";
    map.set(key, {
      agentName: key,
      captures: 0,
      open: 0,
      registered: 0,
      admitted: 0,
      checkedIn: !!a.checkInAt && !a.checkOutAt,
      beatId: a.beatId,
    });
  }

  for (const l of state.leads) {
    if (l.source !== "field_survey") continue;
    if ((l.leadDate || "").slice(0, 10) !== date) continue;
    const key = (l.assignedTo || l.createdBy || "—").trim() || "—";
    const cur = map.get(key) || {
      agentName: key,
      captures: 0,
      open: 0,
      registered: 0,
      admitted: 0,
      checkedIn: false,
      beatId: l.surveyBeatId || "",
    };
    cur.captures += 1;
    if (l.stage === "enquiry") cur.open += 1;
    if (l.stage === "applied" || l.stage === "verified") cur.registered += 1;
    if (l.stage === "enrolled") cur.admitted += 1;
    map.set(key, cur);
  }

  return [...map.values()].sort((a, b) => b.captures - a.captures);
}

export function beatProgress(
  state: AdmissionsState,
  beatId: string,
): { captured: number; target: number; pct: number } {
  const s = ensureSurveyMasters(state);
  const beat = s.surveyBeats.find((b) => b.id === beatId);
  const captured = state.leads.filter(
    (l) => l.source === "field_survey" && l.surveyBeatId === beatId,
  ).length;
  const target = beat?.targetHouseholds || 0;
  const pct =
    target > 0 ? Math.min(100, Math.round((captured / target) * 100)) : 0;
  return { captured, target, pct };
}

/** Compress image file to small data URL for localStorage */
export async function compressSurveyPhoto(
  file: File,
  maxEdge = 480,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function loadOfflineQueue(): SurveyOfflineDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SurveyOfflineDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(items: SurveyOfflineDraft[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OFFLINE_KEY, JSON.stringify(items));
}

export function enqueueOfflineSurvey(
  draft: Omit<SurveyOfflineDraft, "id" | "queuedAt">,
): SurveyOfflineDraft[] {
  const item: SurveyOfflineDraft = {
    ...draft,
    id: nid("sof"),
    queuedAt: new Date().toISOString(),
    mobile: normalizeMobile(draft.mobile),
  };
  const next = [item, ...loadOfflineQueue()];
  saveOfflineQueue(next);
  return next;
}

export function removeOfflineItem(id: string): SurveyOfflineDraft[] {
  const next = loadOfflineQueue().filter((x) => x.id !== id);
  saveOfflineQueue(next);
  return next;
}

/** Flush offline drafts into admissions when online. */
export function flushOfflineSurveyQueue(
  state: AdmissionsState,
  by: string,
): {
  state: AdmissionsState;
  synced: number;
  failed: { id: string; reason: string }[];
  remaining: SurveyOfflineDraft[];
} {
  const queue = loadOfflineQueue();
  let next = state;
  const failed: { id: string; reason: string }[] = [];
  const remaining: SurveyOfflineDraft[] = [];
  let synced = 0;

  for (const item of queue) {
    const r = createEnquiry(
      next,
      {
        source: "field_survey",
        childName: item.childName,
        dob: item.dob || "",
        ageYearsApprox: item.ageYearsApprox || 0,
        guardianName: item.guardianName,
        motherName: item.motherName,
        mobile: item.mobile,
        classSoughtId: item.classSoughtId,
        campaignNote: item.beatName,
        locality: item.beatName,
        surveyBeatId: item.beatId,
        surveyPhotoUrl: item.surveyPhotoUrl,
        declarationAccepted: item.parentConsent,
        parentConsentAt: item.parentConsent ? new Date().toISOString() : "",
        parentConsentBy: item.parentConsent ? item.by || by : "",
        leadDate: todayYmd(),
        assignedTo: item.by || by,
        nextFollowUpAt: todayYmd(),
        parentGroupKey: item.mobile,
      },
      item.by || by,
      // Offline queue draining: SurveyOfflineDraft carries only a class id,
      // and a surveyor often has none. Rejecting here would strand the
      // queued lead in `remaining` forever. Literal, not
      // `!item.classSoughtId` — that form can never refuse anything.
      { allowMissingClass: true },
    );
    if (!r.ok) {
      failed.push({ id: item.id, reason: r.reason });
      remaining.push(item);
      continue;
    }
    next = r.state;
    synced += 1;
  }
  saveOfflineQueue(remaining);
  return { state: next, synced, failed, remaining };
}

export function bulkPushSurveyToRegistration(
  state: AdmissionsState,
  leadIds: string[],
  fee: { feeHeadId: string; feeAmountPaise: number; feeHeadName?: string },
): {
  state: AdmissionsState;
  pushed: number;
  skipped: string[];
} {
  let next = state;
  let pushed = 0;
  const skipped: string[] = [];
  for (const id of leadIds) {
    const lead = next.leads.find((l) => l.id === id);
    if (!lead || lead.source !== "field_survey") {
      skipped.push(id);
      continue;
    }
    if (lead.stage !== "enquiry") {
      skipped.push(lead.enquiryNo || id);
      continue;
    }
    const r = sendLeadToRegistration(next, id, {
      feeHeadId: fee.feeHeadId,
      feeHeadName: fee.feeHeadName || "Registration fee",
      feeAmountPaise: fee.feeAmountPaise,
    });
    if (!r.ok) {
      skipped.push(lead.enquiryNo || id);
      continue;
    }
    next = r.state;
    pushed += 1;
  }
  return { state: next, pushed, skipped };
}

/** Online capture with photo + parent consent. */
export function captureFieldSurveyWithExtras(
  state: AdmissionsState,
  draft: Partial<AdmissionLead> & {
    beatId?: string;
    beatName?: string;
    surveyPhotoUrl?: string;
    parentConsent?: boolean;
  },
  by: string,
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead }
  | { ok: false; reason: string } {
  if (draft.parentConsent === false) {
    return { ok: false, reason: "Parent consent is required for survey capture" };
  }
  const beatName = (
    draft.beatName ||
    draft.campaignNote ||
    draft.locality ||
    ""
  ).trim();
  const r = createEnquiry(
    state,
    {
      ...draft,
      source: "field_survey",
      campaignNote: beatName,
      locality: draft.locality || beatName,
      surveyBeatId: draft.beatId || draft.surveyBeatId || "",
      surveyPhotoUrl: draft.surveyPhotoUrl || "",
      declarationAccepted: true,
      parentConsentAt: new Date().toISOString(),
      parentConsentBy: by,
      leadDate: draft.leadDate || todayYmd(),
      assignedTo: by,
      nextFollowUpAt: todayYmd(),
      parentGroupKey: normalizeMobile(draft.mobile || ""),
    },
    by,
    // Same field-survey rule as flushOfflineSurveyQueue above.
    { allowMissingClass: true },
  );
  if (!r.ok) return r;
  return { ok: true, state: r.state, lead: r.lead };
}

export function reloadAdmissionsWithSurvey(): AdmissionsState {
  return ensureSurveyMasters(loadAdmissions());
}

export function persistAdmissions(state: AdmissionsState): void {
  saveAdmissions(ensureSurveyMasters(state));
}

/* ─── Survey team, geo sessions, breaks, analytics ─── */

export async function captureSurveyGeo(): Promise<SurveyGeoPoint | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy || 0),
          at: new Date().toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function formatSurveyHours(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function sessionBreakMs(
  session: SurveyWorkSession,
  now = Date.now(),
): number {
  let breakMs = 0;
  for (const b of session.breaks) {
    if (!b.startedAt) continue;
    const bs = Date.parse(b.startedAt);
    const be = b.endedAt
      ? Date.parse(b.endedAt)
      : session.status === "on_break"
        ? now
        : bs;
    breakMs += Math.max(0, be - bs);
  }
  return breakMs;
}

/** Net worked time = start→end (or now) minus breaks. */
export function sessionWorkedMs(
  session: SurveyWorkSession,
  now = Date.now(),
): number {
  if (!session.startedAt) return 0;
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return Math.max(0, end - start - sessionBreakMs(session, now));
}

export function addSurveyExternal(
  state: AdmissionsState,
  draft: { fullName: string; mobile: string; note?: string },
):
  | { ok: true; state: AdmissionsState; agent: SurveyExternalAgent }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const fullName = draft.fullName.trim();
  const mobile = normalizeMobile(draft.mobile);
  if (!fullName) return { ok: false, reason: "Name is required" };
  if (mobile.length !== 10) {
    return { ok: false, reason: "Mobile must be 10 digits" };
  }
  if (s.surveyExternals.some((e) => e.mobile === mobile)) {
    return { ok: false, reason: "External survey staff with this mobile exists" };
  }
  const agent: SurveyExternalAgent = {
    id: nid("sve"),
    fullName,
    mobile,
    note: draft.note || "",
    createdAt: new Date().toISOString(),
  };
  return {
    ok: true,
    agent,
    state: { ...s, surveyExternals: [agent, ...s.surveyExternals] },
  };
}

export function addStaffToSurveyTeam(
  state: AdmissionsState,
  staff: Pick<StaffRecord, "id" | "fullName" | "mobile" | "empCode">,
  asLeader = false,
):
  | { ok: true; state: AdmissionsState; member: SurveyTeamMember }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  if (!staff.id) return { ok: false, reason: "Select staff" };
  if (s.surveyTeam.some((m) => m.kind === "staff" && m.staffId === staff.id)) {
    return { ok: false, reason: "Staff already on survey team" };
  }
  let team = [...s.surveyTeam];
  if (asLeader) {
    team = team.map((m) =>
      m.role === "leader" ? { ...m, role: "agent" as const } : m,
    );
  }
  const member: SurveyTeamMember = {
    id: nid("stm"),
    kind: "staff",
    staffId: staff.id,
    externalId: "",
    fullName: staff.fullName,
    mobile: normalizeMobile(staff.mobile || ""),
    empCode: staff.empCode || "",
    role: asLeader ? "leader" : "agent",
    assigned: true,
    createdAt: new Date().toISOString(),
  };
  return {
    ok: true,
    member,
    state: { ...s, surveyTeam: [member, ...team] },
  };
}

export function addExternalToSurveyTeam(
  state: AdmissionsState,
  externalId: string,
):
  | { ok: true; state: AdmissionsState; member: SurveyTeamMember }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const ext = s.surveyExternals.find((e) => e.id === externalId);
  if (!ext) return { ok: false, reason: "External agent not found" };
  if (
    s.surveyTeam.some(
      (m) => m.kind === "external" && m.externalId === externalId,
    )
  ) {
    return { ok: false, reason: "Already on survey team" };
  }
  const member: SurveyTeamMember = {
    id: nid("stm"),
    kind: "external",
    staffId: "",
    externalId: ext.id,
    fullName: ext.fullName,
    mobile: ext.mobile,
    empCode: "EXT",
    role: "agent",
    assigned: true,
    createdAt: new Date().toISOString(),
  };
  return {
    ok: true,
    member,
    state: { ...s, surveyTeam: [member, ...s.surveyTeam] },
  };
}

export function setSurveyTeamAssigned(
  state: AdmissionsState,
  memberId: string,
  assigned: boolean,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  return {
    ...s,
    surveyTeam: s.surveyTeam.map((m) =>
      m.id === memberId ? { ...m, assigned } : m,
    ),
  };
}

export function setSurveyTeamLeader(
  state: AdmissionsState,
  memberId: string,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  return {
    ...s,
    surveyTeam: s.surveyTeam.map((m) => ({
      ...m,
      role: m.id === memberId ? ("leader" as const) : ("agent" as const),
    })),
  };
}

export function removeSurveyTeamMember(
  state: AdmissionsState,
  memberId: string,
): AdmissionsState {
  const s = ensureSurveyMasters(state);
  return {
    ...s,
    surveyTeam: s.surveyTeam.filter((m) => m.id !== memberId),
  };
}

/** Assigned members — app shows Start survey only for these. */
export function assignedSurveyMembers(
  state: AdmissionsState,
): SurveyTeamMember[] {
  return ensureSurveyMasters(state).surveyTeam.filter((m) => m.assigned);
}

export function findSurveyMemberForSession(
  state: AdmissionsState,
  opts: { staffId?: string; mobile?: string; memberId?: string },
): SurveyTeamMember | null {
  const s = ensureSurveyMasters(state);
  if (opts.memberId) {
    return s.surveyTeam.find((m) => m.id === opts.memberId && m.assigned) || null;
  }
  if (opts.staffId) {
    return (
      s.surveyTeam.find(
        (m) => m.kind === "staff" && m.staffId === opts.staffId && m.assigned,
      ) || null
    );
  }
  const mobile = normalizeMobile(opts.mobile || "");
  if (mobile.length === 10) {
    return (
      s.surveyTeam.find((m) => m.mobile === mobile && m.assigned) || null
    );
  }
  return null;
}

export function isSurveyTeamLeader(
  state: AdmissionsState,
  memberId: string,
): boolean {
  const m = ensureSurveyMasters(state).surveyTeam.find((x) => x.id === memberId);
  return !!m && m.role === "leader" && m.assigned;
}

export function activeSessionForMember(
  state: AdmissionsState,
  memberId: string,
  date = todayYmd(),
): SurveyWorkSession | null {
  const s = ensureSurveyMasters(state);
  return (
    s.surveySessions.find(
      (x) =>
        x.memberId === memberId &&
        x.date === date &&
        (x.status === "active" || x.status === "on_break"),
    ) || null
  );
}

/**
 * Start survey for the day — captures location.
 * Also mirrors legacy SurveyAttendance check-in.
 */
export function startSurveySession(
  state: AdmissionsState,
  memberId: string,
  beatId: string,
  geo: SurveyGeoPoint | null,
):
  | { ok: true; state: AdmissionsState; session: SurveyWorkSession }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const member = s.surveyTeam.find((m) => m.id === memberId);
  if (!member || !member.assigned) {
    return { ok: false, reason: "You are not assigned to field survey" };
  }
  if (!beatId) return { ok: false, reason: "Select a beat to start" };
  if (activeSessionForMember(s, memberId)) {
    return { ok: false, reason: "Survey already started — end or continue" };
  }
  const now = new Date().toISOString();
  const session: SurveyWorkSession = {
    id: nid("sws"),
    date: todayYmd(),
    memberId: member.id,
    agentName: member.fullName,
    staffId: member.staffId,
    beatId,
    startedAt: now,
    endedAt: "",
    startGeo: geo,
    endGeo: null,
    breaks: [],
    status: "active",
  };
  let next: AdmissionsState = {
    ...s,
    surveySessions: [session, ...s.surveySessions],
  };
  next = checkInSurveyAgent(next, member.fullName, beatId);
  const beat = s.surveyBeats.find((b) => b.id === beatId);
  syncStaffAttendanceOnSurveyStart(
    member,
    beat?.name || beatId,
    session.startedAt,
  );
  return { ok: true, state: next, session };
}

export function startSurveyBreak(
  state: AdmissionsState,
  sessionId: string,
  geo: SurveyGeoPoint | null,
):
  | { ok: true; state: AdmissionsState }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const session = s.surveySessions.find((x) => x.id === sessionId);
  if (!session) return { ok: false, reason: "Session not found" };
  if (session.status !== "active") {
    return { ok: false, reason: "Break only while survey is running" };
  }
  const brk: SurveyBreak = {
    id: nid("sbk"),
    startedAt: new Date().toISOString(),
    endedAt: "",
    startGeo: geo,
    endGeo: null,
  };
  return {
    ok: true,
    state: {
      ...s,
      surveySessions: s.surveySessions.map((x) =>
        x.id === sessionId
          ? { ...x, status: "on_break" as const, breaks: [...x.breaks, brk] }
          : x,
      ),
    },
  };
}

export function endSurveyBreak(
  state: AdmissionsState,
  sessionId: string,
  geo: SurveyGeoPoint | null,
):
  | { ok: true; state: AdmissionsState }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const session = s.surveySessions.find((x) => x.id === sessionId);
  if (!session || session.status !== "on_break") {
    return { ok: false, reason: "Not on break" };
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    state: {
      ...s,
      surveySessions: s.surveySessions.map((x) => {
        if (x.id !== sessionId) return x;
        const breaks = x.breaks.map((b, i) =>
          i === x.breaks.length - 1 && !b.endedAt
            ? { ...b, endedAt: now, endGeo: geo }
            : b,
        );
        return { ...x, status: "active" as const, breaks };
      }),
    },
  };
}

/** End survey day — end location + hours locked. */
export function endSurveySession(
  state: AdmissionsState,
  sessionId: string,
  geo: SurveyGeoPoint | null,
):
  | { ok: true; state: AdmissionsState; workedMs: number }
  | { ok: false; reason: string } {
  const s = ensureSurveyMasters(state);
  const session = s.surveySessions.find((x) => x.id === sessionId);
  if (!session) return { ok: false, reason: "Session not found" };
  if (session.status === "ended") {
    return { ok: false, reason: "Survey already ended" };
  }
  const now = new Date().toISOString();
  let breaks = session.breaks;
  if (session.status === "on_break") {
    breaks = breaks.map((b, i) =>
      i === breaks.length - 1 && !b.endedAt
        ? { ...b, endedAt: now, endGeo: geo }
        : b,
    );
  }
  const ended: SurveyWorkSession = {
    ...session,
    breaks,
    endedAt: now,
    endGeo: geo,
    status: "ended",
  };
  let next: AdmissionsState = {
    ...s,
    surveySessions: s.surveySessions.map((x) =>
      x.id === sessionId ? ended : x,
    ),
  };
  next = checkOutSurveyAgent(next, session.agentName);
  const member = s.surveyTeam.find((m) => m.id === session.memberId);
  if (member) {
    const beat = s.surveyBeats.find((b) => b.id === ended.beatId);
    syncStaffAttendanceOnSurveyEnd(member, ended, beat?.name || ended.beatId);
  }
  return { ok: true, state: next, workedMs: sessionWorkedMs(ended) };
}

export type SurveyDayAnalytics = {
  date: string;
  sessions: number;
  active: number;
  ended: number;
  totalWorkedMs: number;
  totalBreakMs: number;
  captures: number;
  byAgent: {
    memberId: string;
    agentName: string;
    staffId: string;
    memberKind: "staff" | "external";
    workedMs: number;
    breakMs: number;
    status: string;
    beatId: string;
    captures: number;
    startLabel: string;
    endLabel: string;
    salaryLabel: string;
    salaryCode: string;
  }[];
  byBeat: {
    beatId: string;
    beatName: string;
    sessions: number;
    workedMs: number;
    captures: number;
  }[];
};

function geoLabel(g: SurveyGeoPoint | null): string {
  if (!g) return "—";
  return `${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
}

export function surveyDayAnalytics(
  state: AdmissionsState,
  date = todayYmd(),
): SurveyDayAnalytics {
  const s = ensureSurveyMasters(state);
  const sessions = s.surveySessions.filter((x) => x.date === date);
  const capturesFor = (agentName: string, beatId: string) =>
    s.leads.filter(
      (l) =>
        l.source === "field_survey" &&
        (l.leadDate || "").slice(0, 10) === date &&
        ((agentName &&
          (l.assignedTo || l.createdBy || "")
            .toLowerCase()
            .includes(agentName.toLowerCase())) ||
          (beatId && l.surveyBeatId === beatId)),
    ).length;

  const byAgent = sessions.map((sess) => {
    const captures = s.leads.filter(
      (l) =>
        l.source === "field_survey" &&
        (l.leadDate || "").slice(0, 10) === date &&
        (l.assignedTo || l.createdBy || "").trim().toLowerCase() ===
          sess.agentName.trim().toLowerCase(),
    ).length;
    const member = s.surveyTeam.find((m) => m.id === sess.memberId);
    const kind =
      member?.kind ||
      (sess.staffId ? ("staff" as const) : ("external" as const));
    const salary = surveySalaryDayOutcome(sess, kind);
    return {
      memberId: sess.memberId,
      agentName: sess.agentName,
      staffId: sess.staffId,
      memberKind: kind,
      workedMs: sessionWorkedMs(sess),
      breakMs: sessionBreakMs(sess),
      status: sess.status,
      beatId: sess.beatId,
      captures,
      startLabel: geoLabel(sess.startGeo),
      endLabel: geoLabel(sess.endGeo),
      salaryLabel: salary.label,
      salaryCode: salary.code,
    };
  });

  const beatMap = new Map<
    string,
    { beatId: string; beatName: string; sessions: number; workedMs: number; captures: number }
  >();
  for (const sess of sessions) {
    const beat = s.surveyBeats.find((b) => b.id === sess.beatId);
    const name = beat?.name || "Unassigned";
    const cur = beatMap.get(sess.beatId) || {
      beatId: sess.beatId,
      beatName: name,
      sessions: 0,
      workedMs: 0,
      captures: 0,
    };
    cur.sessions += 1;
    cur.workedMs += sessionWorkedMs(sess);
    cur.captures += capturesFor(sess.agentName, sess.beatId);
    beatMap.set(sess.beatId || name, cur);
  }

  const dayCaptures = s.leads.filter(
    (l) =>
      l.source === "field_survey" &&
      (l.leadDate || "").slice(0, 10) === date,
  ).length;

  return {
    date,
    sessions: sessions.length,
    active: sessions.filter((x) => x.status !== "ended").length,
    ended: sessions.filter((x) => x.status === "ended").length,
    totalWorkedMs: sessions.reduce((n, x) => n + sessionWorkedMs(x), 0),
    totalBreakMs: sessions.reduce((n, x) => n + sessionBreakMs(x), 0),
    captures: dayCaptures,
    byAgent,
    byBeat: [...beatMap.values()].sort((a, b) => b.workedMs - a.workedMs),
  };
}

/** Team leader (or office) may upsert beats from mobile. */
export function leaderUpsertBeat(
  state: AdmissionsState,
  memberId: string,
  beat: Partial<SurveyBeat> & { name: string },
):
  | { ok: true; state: AdmissionsState }
  | { ok: false; reason: string } {
  if (!isSurveyTeamLeader(state, memberId)) {
    return { ok: false, reason: "Only team leader can edit beats" };
  }
  return { ok: true, state: upsertSurveyBeat(state, beat) };
}
