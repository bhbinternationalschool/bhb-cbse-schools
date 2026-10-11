/**
 * Admissions → Entrance test, server side.
 *
 * Reads and writes admission_entrance_sessions / admission_entrance_candidates
 * (migration 20261011150000). The admissions desk is only READ here — the
 * applicant list and each child's current name, class and number come from
 * admission_desk_leads, and nothing in this file writes to it, so the leads
 * desk saves exactly as it did before this feature existed.
 *
 * Every write is explicit: a sitting or a child is removed by id, never by
 * being absent from a save; a marks save names the row stamp it loaded and
 * is refused when the row changed since. A failed read throws — the screen
 * says it could not load, it never shows an empty roll.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { rowToLead } from "@/lib/admissionsNormalized.server";
import type { AdmissionLead } from "@/lib/admissions";
import {
  ENTRANCE_ELIGIBLE_STAGES,
  SEND_CLAIM_MS,
  absentConflict,
  candidateScore,
  recomputeRuleResults,
  ruleInputsChanged,
  cleanMarks,
  isEntranceResultStatus,
  nextRollNumbers,
  ruleStatusChanges,
  subjectChangeProblem,
  suggestedStatus,
  type EntranceCandidate,
  type EntranceResultStatus,
  type EntranceSession,
  type EntranceSessionDraft,
  type EntranceStatusSource,
  type EntranceSubject,
} from "@/lib/admissionEntranceTest";

const LOG = "[entrance-test]";
const SESSIONS = "admission_entrance_sessions";
const CANDIDATES = "admission_entrance_candidates";

export class EntranceTestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EntranceTestError";
    this.status = status;
  }
}

type Ctx = { sb: SupabaseClient; tenantId: string };

async function ctx(): Promise<Ctx> {
  const c = await getServerTenantContext();
  if (!c) throw new EntranceTestError("The school database is not reachable right now.", 503);
  return c;
}

function readFail(what: string, message: string): never {
  console.warn(`${LOG} read ${what} failed: ${message}`);
  throw new EntranceTestError(`Could not read ${what}: ${message}`, 502);
}

function writeFail(what: string, error: { message: string; code?: string }): never {
  console.warn(`${LOG} write ${what} failed: ${error.code ?? ""} ${error.message}`);
  if (error.code === "23505") {
    throw new EntranceTestError(
      "Someone else changed this test at the same moment — reload and try again.",
      409,
    );
  }
  if (error.code === "23503") {
    throw new EntranceTestError("Remove every child from this test's roll before deleting it.", 409);
  }
  throw new EntranceTestError(`Could not save ${what}: ${error.message}`, 502);
}

/* ─── Row mapping ──────────────────────────────────────────────── */

function rowToSession(r: Record<string, unknown>): EntranceSession {
  const subjects = Array.isArray(r.subjects) ? (r.subjects as EntranceSubject[]) : [];
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code ?? ""),
    name: String(r.name ?? ""),
    testDate: String(r.test_date ?? ""),
    startTime: String(r.start_time ?? ""),
    venue: String(r.venue ?? ""),
    classIds: Array.isArray(r.class_ids) ? (r.class_ids as unknown[]).map(String) : [],
    subjects: subjects.map((s) => ({
      id: String(s.id),
      name: String(s.name),
      maxMarks: Number(s.maxMarks) || 0,
    })),
    passPercent: Number(r.pass_percent),
    waitlistPercent:
      r.waitlist_percent === null || r.waitlist_percent === undefined
        ? null
        : Number(r.waitlist_percent),
    notes: String(r.notes ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

function rowToCandidate(r: Record<string, unknown>): EntranceCandidate {
  const marks: Record<string, number> = {};
  const raw = (r.marks ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === "number" ? v : Number(v);
    if (v !== null && v !== "" && Number.isFinite(n)) marks[k] = n;
  }
  const status = String(r.result_status ?? "");
  const source = String(r.status_source ?? "");
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    leadId: String(r.lead_id),
    rollNo: String(r.roll_no ?? ""),
    childName: String(r.child_name ?? ""),
    guardianName: String(r.guardian_name ?? ""),
    mobile: String(r.mobile ?? ""),
    classId: String(r.class_id ?? ""),
    applicationNo: String(r.application_no ?? ""),
    enquiryNo: String(r.enquiry_no ?? ""),
    absent: r.absent === true,
    marks,
    resultStatus: isEntranceResultStatus(status) ? status : "",
    statusSource: (source === "rule" || source === "manual" ? source : "") as EntranceStatusSource,
    statusSetBy: String(r.status_set_by ?? ""),
    statusSetAt: String(r.status_set_at ?? ""),
    inviteSentAt: String(r.invite_sent_at ?? ""),
    resultSentAt: String(r.result_sent_at ?? ""),
    inviteClaimedAt: String(r.invite_claimed_at ?? ""),
    resultClaimedAt: String(r.result_claimed_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

function draftToRow(d: EntranceSessionDraft): Record<string, unknown> {
  return {
    academic_year_code: d.academicYearCode,
    name: d.name,
    test_date: d.testDate,
    start_time: d.startTime,
    venue: d.venue,
    class_ids: d.classIds,
    subjects: d.subjects,
    pass_percent: d.passPercent,
    waitlist_percent: d.waitlistPercent,
    notes: d.notes,
  };
}

/* ─── Reads ────────────────────────────────────────────────────── */

export async function listSessions(academicYearCode: string): Promise<EntranceSession[]> {
  const { sb, tenantId } = await ctx();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let q = sb.from(SESSIONS).select("*").eq("tenant_id", tenantId);
    if (academicYearCode) q = q.eq("academic_year_code", academicYearCode);
    return q.order("id", { ascending: true }).range(from, to);
  });
  if (res.error) readFail("entrance tests", res.error);
  return res.rows
    .map(rowToSession)
    .sort((a, b) => b.testDate.localeCompare(a.testDate) || a.name.localeCompare(b.name));
}

async function fetchSession(c: Ctx, id: string): Promise<EntranceSession> {
  if (!id) throw new EntranceTestError("Which test? (session id missing)");
  const { data, error } = await c.sb
    .from(SESSIONS)
    .select("*")
    .eq("tenant_id", c.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) readFail("the entrance test", error.message);
  if (!data) throw new EntranceTestError("That entrance test no longer exists.", 404);
  return rowToSession(data as Record<string, unknown>);
}

async function fetchCandidates(c: Ctx, sessionId: string): Promise<EntranceCandidate[]> {
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    c.sb
      .from(CANDIDATES)
      .select("*")
      .eq("tenant_id", c.tenantId)
      .eq("session_id", sessionId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) readFail("the roll", res.error);
  return res.rows.map(rowToCandidate);
}

export async function getSessionBundle(
  id: string,
): Promise<{ session: EntranceSession; candidates: EntranceCandidate[] }> {
  const c = await ctx();
  const session = await fetchSession(c, id);
  const candidates = await fetchCandidates(c, id);
  return { session, candidates };
}

/** Every child on every sitting of a year — for the class summary. */
export async function listYearCandidates(
  academicYearCode: string,
): Promise<{ sessions: EntranceSession[]; candidates: EntranceCandidate[] }> {
  const c = await ctx();
  const sessions = await listSessions(academicYearCode);
  const ids = sessions.map((s) => s.id);
  if (ids.length === 0) return { sessions, candidates: [] };
  const res = await fetchByIds<Record<string, unknown>>(ids, (chunk, from, to) =>
    c.sb
      .from(CANDIDATES)
      .select("*")
      .eq("tenant_id", c.tenantId)
      .in("session_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) readFail("the rolls", res.error);
  return { sessions, candidates: res.rows.map(rowToCandidate) };
}

export type EligibleApplicant = {
  leadId: string;
  childName: string;
  guardianName: string;
  mobile: string;
  classId: string;
  stage: string;
  applicationNo: string;
  enquiryNo: string;
  onRoll: boolean;
};

/**
 * Leads that may sit this test: same academic year, a class the test is
 * for, and still open / registered / verified. Read straight from
 * admission_desk_leads (paged — 900+ rows), never from a browser copy.
 */
export async function listEligibleApplicants(sessionId: string): Promise<EligibleApplicant[]> {
  const c = await ctx();
  const session = await fetchSession(c, sessionId);
  if (session.classIds.length === 0) return [];
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    c.sb
      .from("admission_desk_leads")
      .select(
        "id, child_name, guardian_name, mobile, class_sought_id, stage, application_no, enquiry_no, academic_year_code",
      )
      .eq("tenant_id", c.tenantId)
      .eq("academic_year_code", session.academicYearCode)
      .in("class_sought_id", session.classIds)
      .in("stage", [...ENTRANCE_ELIGIBLE_STAGES])
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) readFail("the applicants", res.error);
  const onRoll = new Set((await fetchCandidates(c, sessionId)).map((x) => x.leadId));
  return res.rows
    .map((r) => ({
      leadId: String(r.id),
      childName: String(r.child_name ?? ""),
      guardianName: String(r.guardian_name ?? ""),
      mobile: String(r.mobile ?? ""),
      classId: String(r.class_sought_id ?? ""),
      stage: String(r.stage ?? ""),
      applicationNo: String(r.application_no ?? ""),
      enquiryNo: String(r.enquiry_no ?? ""),
      onRoll: onRoll.has(String(r.id)),
    }))
    .sort((a, b) => a.childName.localeCompare(b.childName));
}

export type LeadEntranceRecord = {
  candidateId: string;
  sessionId: string;
  sessionName: string;
  testDate: string;
  rollNo: string;
  absent: boolean;
  resultStatus: EntranceResultStatus;
  percent: number | null;
};

/** The badge on a lead's CRM record: every sitting this child is on. */
export async function leadEntranceRecords(leadId: string): Promise<LeadEntranceRecord[]> {
  const c = await ctx();
  if (!leadId) throw new EntranceTestError("Which lead? (lead id missing)");
  const { data, error } = await c.sb
    .from(CANDIDATES)
    .select("*")
    .eq("tenant_id", c.tenantId)
    .eq("lead_id", leadId)
    .order("id", { ascending: true })
    .limit(50);
  if (error) readFail("the entrance test record", error.message);
  const cands = (data ?? []).map((r) => rowToCandidate(r as Record<string, unknown>));
  if (cands.length === 0) return [];
  const sessIds = [...new Set(cands.map((x) => x.sessionId))];
  const { data: sRows, error: sErr } = await c.sb
    .from(SESSIONS)
    .select("*")
    .eq("tenant_id", c.tenantId)
    .in("id", sessIds);
  if (sErr) readFail("the entrance tests", sErr.message);
  const byId = new Map((sRows ?? []).map((r) => [String(r.id), rowToSession(r as Record<string, unknown>)]));
  return cands
    .map((x) => {
      const s = byId.get(x.sessionId);
      return {
        candidateId: x.id,
        sessionId: x.sessionId,
        sessionName: s?.name ?? "",
        testDate: s?.testDate ?? "",
        rollNo: x.rollNo,
        absent: x.absent,
        resultStatus: x.resultStatus,
        percent: s ? candidateScore(s, x).percent : null,
      };
    })
    .sort((a, b) => b.testDate.localeCompare(a.testDate));
}

/** Current lead rows for these ids (full record, lead_json included). */
export async function fetchLeadsByIds(leadIds: string[]): Promise<Map<string, AdmissionLead>> {
  const c = await ctx();
  const ids = [...new Set(leadIds.filter(Boolean))];
  const out = new Map<string, AdmissionLead>();
  if (ids.length === 0) return out;
  const res = await fetchByIds<Record<string, unknown>>(ids, (chunk, from, to) =>
    c.sb
      .from("admission_desk_leads")
      .select("*")
      .eq("tenant_id", c.tenantId)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) readFail("the leads", res.error);
  for (const r of res.rows) {
    const lead = rowToLead(r);
    out.set(lead.id, lead);
  }
  return out;
}

/** Class id → name from Masters (server copy). A failed read throws. */
export async function classNamesServer(): Promise<Map<string, string>> {
  const c = await ctx();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    c.sb
      .from("masters_desk_classes")
      .select("id, name")
      .eq("tenant_id", c.tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) readFail("class names", res.error);
  return new Map(res.rows.map((r) => [String(r.id), String(r.name ?? "")]));
}

/* ─── Sitting writes ───────────────────────────────────────────── */

export async function createSession(
  draft: EntranceSessionDraft,
  actor: string,
): Promise<EntranceSession> {
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb
    .from(SESSIONS)
    .insert({ ...draftToRow(draft), tenant_id: tenantId, created_by: actor, updated_by: actor })
    .select("*")
    .single();
  if (error) writeFail("the entrance test", error);
  return rowToSession(data as Record<string, unknown>);
}

/**
 * Change a sitting. `stamp` is the updated_at the screen loaded; a save
 * over someone else's newer change is refused. Subjects may change only
 * when no entered mark would be dropped or exceed its new maximum.
 *
 * When the pass mark, waitlist mark or subjects change, every result the
 * rule set is worked out again under the new rule (hand decisions are
 * left alone), so a stale "Selected" cannot be sent to a family.
 */
export async function updateSession(
  id: string,
  draft: EntranceSessionDraft,
  stamp: string,
  actor: string,
): Promise<{ session: EntranceSession; resultsRecomputed: number }> {
  const c = await ctx();
  const current = await fetchSession(c, id);
  if (!stamp || stamp !== current.updatedAt) {
    throw new EntranceTestError(
      "This test was changed on another screen since you opened it — reload to see the latest, then edit.",
      409,
    );
  }
  if (draft.academicYearCode !== current.academicYearCode) {
    throw new EntranceTestError("A test cannot move to another academic session.");
  }
  const candidates = await fetchCandidates(c, id);
  const problem = subjectChangeProblem(draft.subjects, candidates);
  if (problem) throw new EntranceTestError(problem, 409);
  const removedClasses = current.classIds.filter((x) => !draft.classIds.includes(x));
  const stranded = candidates.find((x) => removedClasses.includes(x.classId));
  if (stranded) {
    throw new EntranceTestError(
      `${stranded.childName || "A child"} on the roll is applying for a class you are removing. Take them off the roll first.`,
      409,
    );
  }
  const { data, error } = await c.sb
    .from(SESSIONS)
    .update({ ...draftToRow(draft), updated_by: actor, updated_at: new Date().toISOString() })
    .eq("tenant_id", c.tenantId)
    .eq("id", id)
    .eq("updated_at", current.updatedAt)
    .select("*");
  if (error) writeFail("the entrance test", error);
  if (!data || data.length === 0) {
    throw new EntranceTestError("This test was changed on another screen a moment ago — reload and try again.", 409);
  }
  const saved = rowToSession(data[0] as Record<string, unknown>);
  let resultsRecomputed = 0;
  if (ruleInputsChanged(current, saved)) {
    const changes = recomputeRuleResults(saved, candidates);
    if (changes.length) {
      resultsRecomputed = (await writeStatuses(c, id, changes, actor)).length;
    }
  }
  return { session: saved, resultsRecomputed };
}

/** Delete one sitting, by id. Refused while any child is on its roll. */
export async function deleteSession(id: string): Promise<void> {
  const c = await ctx();
  await fetchSession(c, id);
  const candidates = await fetchCandidates(c, id);
  if (candidates.length > 0) {
    throw new EntranceTestError(
      `${candidates.length} child${candidates.length === 1 ? " is" : "ren are"} on this test's roll. Remove them first.`,
      409,
    );
  }
  const { error } = await c.sb.from(SESSIONS).delete().eq("tenant_id", c.tenantId).eq("id", id);
  if (error) writeFail("the entrance test", error);
}

/* ─── Roll writes ──────────────────────────────────────────────── */

export type AddCandidatesResult = {
  added: EntranceCandidate[];
  skipped: { leadId: string; reason: string }[];
};

/**
 * Put applicants on the roll. The lead ids come from the screen; everything
 * stored about each child is read again here from admission_desk_leads, so
 * a stale or edited browser list cannot put the wrong name on a roll.
 */
export async function addCandidates(
  sessionId: string,
  leadIds: string[],
  actor: string,
): Promise<AddCandidatesResult> {
  const c = await ctx();
  const session = await fetchSession(c, sessionId);
  const ids = [...new Set(leadIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (ids.length === 0) throw new EntranceTestError("Tick at least one applicant.");
  if (ids.length > 500) throw new EntranceTestError("At most 500 applicants at a time.");

  const existing = await fetchCandidates(c, sessionId);
  const onRoll = new Set(existing.map((x) => x.leadId));
  const leads = await fetchLeadsByIds(ids);
  const eligible = new Set<string>(ENTRANCE_ELIGIBLE_STAGES);

  const skipped: AddCandidatesResult["skipped"] = [];
  const toAdd: AdmissionLead[] = [];
  for (const id of ids) {
    const lead = leads.get(id);
    if (!lead) skipped.push({ leadId: id, reason: "lead not found" });
    else if (onRoll.has(id)) skipped.push({ leadId: id, reason: "already on the roll" });
    else if (!eligible.has(lead.stage)) skipped.push({ leadId: id, reason: `lead is ${lead.stage}` });
    else if (lead.academicYearCode !== session.academicYearCode)
      skipped.push({ leadId: id, reason: `enquiry is for ${lead.academicYearCode || "no session"}` });
    else if (!session.classIds.includes(lead.classSoughtId))
      skipped.push({ leadId: id, reason: "class is not one this test is for" });
    else toAdd.push(lead);
  }
  if (toAdd.length === 0) return { added: [], skipped };

  toAdd.sort((a, b) => a.childName.localeCompare(b.childName));
  const rolls = nextRollNumbers(existing.map((x) => x.rollNo), toAdd.length);
  const rows = toAdd.map((lead, i) => ({
    tenant_id: c.tenantId,
    session_id: sessionId,
    lead_id: lead.id,
    roll_no: rolls[i]!,
    child_name: lead.childName,
    guardian_name: lead.guardianName,
    mobile: lead.mobile,
    class_id: lead.classSoughtId,
    application_no: lead.applicationNo,
    enquiry_no: lead.enquiryNo,
    created_by: actor,
  }));
  const { data, error } = await c.sb.from(CANDIDATES).insert(rows).select("*");
  if (error) writeFail("the roll", error);
  return { added: (data ?? []).map((r) => rowToCandidate(r as Record<string, unknown>)), skipped };
}

/** Take one child off the roll, by id, at the stamp the screen loaded. */
export async function removeCandidate(id: string, stamp: string): Promise<void> {
  const c = await ctx();
  if (!id) throw new EntranceTestError("Which child? (id missing)");
  const { data, error } = await c.sb
    .from(CANDIDATES)
    .delete()
    .eq("tenant_id", c.tenantId)
    .eq("id", id)
    .eq("updated_at", stamp)
    .select("id");
  if (error) writeFail("the roll", error);
  if (!data || data.length === 0) {
    throw new EntranceTestError(
      "This child's row changed on another screen (or was already removed) — reload and try again.",
      409,
    );
  }
}

/* ─── Marks & results ──────────────────────────────────────────── */

export type MarksRowInput = {
  id: string;
  marks: unknown;
  absent: boolean;
  updatedAt: string;
};

export type MarksSaveResult = {
  saved: EntranceCandidate[];
  conflicts: { id: string; childName: string }[];
  errors: { id: string; childName: string; error: string }[];
};

/**
 * Save marks row by row, each at its own stamp. A row someone else saved
 * since is reported as a conflict and left alone — the others still save.
 * A result the pass-mark rule set follows the new marks; a manual result is
 * the office's decision and is never touched by a marks change.
 */
export async function saveMarks(
  sessionId: string,
  rows: MarksRowInput[],
): Promise<MarksSaveResult> {
  const c = await ctx();
  const session = await fetchSession(c, sessionId);
  const current = new Map((await fetchCandidates(c, sessionId)).map((x) => [x.id, x]));
  const out: MarksSaveResult = { saved: [], conflicts: [], errors: [] };
  if (rows.length > 500) throw new EntranceTestError("At most 500 rows in one save.");

  for (const r of rows) {
    const cur = current.get(String(r.id));
    if (!cur) {
      out.errors.push({ id: String(r.id), childName: "", error: "not on this test's roll" });
      continue;
    }
    if (!r.updatedAt || r.updatedAt !== cur.updatedAt) {
      out.conflicts.push({ id: cur.id, childName: cur.childName });
      continue;
    }
    const cleaned = cleanMarks(r.marks, session.subjects);
    if (!cleaned.ok) {
      out.errors.push({ id: cur.id, childName: cur.childName, error: cleaned.error });
      continue;
    }
    const absent = r.absent === true;
    const conflict = absentConflict(cur, absent);
    if (conflict) {
      out.errors.push({ id: cur.id, childName: cur.childName, error: conflict });
      continue;
    }
    const patch: Record<string, unknown> = {
      marks: cleaned.marks,
      absent,
      updated_at: new Date().toISOString(),
    };
    if (cur.statusSource === "rule") {
      const s = suggestedStatus(session, { marks: cleaned.marks, absent });
      patch.result_status = s ?? "";
      patch.status_source = s ? "rule" : "";
    }
    const { data, error } = await c.sb
      .from(CANDIDATES)
      .update(patch)
      .eq("tenant_id", c.tenantId)
      .eq("id", cur.id)
      .eq("updated_at", cur.updatedAt)
      .select("*");
    if (error) {
      console.warn(`${LOG} marks save ${cur.id} failed: ${error.message}`);
      out.errors.push({ id: cur.id, childName: cur.childName, error: error.message });
      continue;
    }
    if (!data || data.length === 0) {
      out.conflicts.push({ id: cur.id, childName: cur.childName });
      continue;
    }
    out.saved.push(rowToCandidate(data[0] as Record<string, unknown>));
  }
  return out;
}

async function writeStatuses(
  c: Ctx,
  sessionId: string,
  items: { id: string; status: EntranceResultStatus; source: EntranceStatusSource }[],
  actor: string,
): Promise<EntranceCandidate[]> {
  const now = new Date().toISOString();
  const saved: EntranceCandidate[] = [];
  // Grouped so a bulk "Selected" for 40 children is one statement.
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const k = `${it.status}|${it.source}`;
    groups.set(k, [...(groups.get(k) ?? []), it.id]);
  }
  for (const [k, ids] of groups) {
    const [status, source] = k.split("|") as [EntranceResultStatus, EntranceStatusSource];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { data, error } = await c.sb
        .from(CANDIDATES)
        .update({
          result_status: status,
          status_source: source,
          status_set_by: status ? actor : "",
          status_set_at: status ? now : null,
          updated_at: now,
        })
        .eq("tenant_id", c.tenantId)
        .eq("session_id", sessionId)
        .in("id", chunk)
        .select("*");
      if (error) writeFail("the results", error);
      saved.push(...(data ?? []).map((r) => rowToCandidate(r as Record<string, unknown>)));
    }
  }
  return saved;
}

/**
 * "Apply pass mark": the server works the results out from the marks it
 * holds — the browser's idea of a total is never trusted for a decision.
 */
export async function applyPassMark(
  sessionId: string,
  candidateIds: string[] | null,
  includeManual: boolean,
  actor: string,
): Promise<{ saved: EntranceCandidate[]; skippedIncomplete: number; skippedManual: number }> {
  const c = await ctx();
  const session = await fetchSession(c, sessionId);
  let candidates = await fetchCandidates(c, sessionId);
  if (candidateIds) {
    const want = new Set(candidateIds);
    candidates = candidates.filter((x) => want.has(x.id));
  }
  const plan = ruleStatusChanges(session, candidates, { includeManual });
  const saved = await writeStatuses(
    c,
    sessionId,
    plan.changes.map((ch) => ({ id: ch.id, status: ch.status, source: "rule" as const })),
    actor,
  );
  return { saved, skippedIncomplete: plan.skippedIncomplete, skippedManual: plan.skippedManual };
}

/** The office's own decision for the ticked children ("" clears it). */
export async function setManualStatus(
  sessionId: string,
  candidateIds: string[],
  status: EntranceResultStatus,
  actor: string,
): Promise<EntranceCandidate[]> {
  if (!isEntranceResultStatus(status)) throw new EntranceTestError("Unknown result");
  const ids = [...new Set(candidateIds.filter(Boolean))];
  if (ids.length === 0) throw new EntranceTestError("Tick at least one child.");
  const c = await ctx();
  await fetchSession(c, sessionId);
  return writeStatuses(
    c,
    sessionId,
    ids.map((id) => ({ id, status, source: status ? ("manual" as const) : ("" as const) })),
    actor,
  );
}

/**
 * Claim one family for a send, atomically: ONE conditional update that
 * succeeds only when no live claim exists (and, unless re-sending, nothing
 * was sent yet). Two staff pressing Send together — both past the preview —
 * get one claim between them; only the holder messages the family. Same
 * rule as sendClaimBlock in lib/admissionEntranceTest.ts.
 */
export async function claimForSend(
  candidateId: string,
  kind: "invite" | "result",
  resend: boolean,
): Promise<boolean> {
  const c = await ctx();
  const claimCol = kind === "invite" ? "invite_claimed_at" : "result_claimed_at";
  const sentCol = kind === "invite" ? "invite_sent_at" : "result_sent_at";
  const now = Date.now();
  const cutoff = new Date(now - SEND_CLAIM_MS).toISOString();
  let q = c.sb
    .from(CANDIDATES)
    .update({ [claimCol]: new Date(now).toISOString() })
    .eq("tenant_id", c.tenantId)
    .eq("id", candidateId)
    .or(`${claimCol}.is.null,${claimCol}.lt."${cutoff}"`);
  if (!resend) q = q.is(sentCol, null);
  const { data, error } = await q.select("id");
  if (error) writeFail("the send claim", error);
  return !!data && data.length > 0;
}

/**
 * Settle a claim. Sent: record it and KEEP the claim (it holds off a
 * double-clicked re-send for 10 minutes). Not sent (failed, held for quiet
 * hours): release the claim so the next send can try.
 */
export async function settleSendClaim(
  candidateId: string,
  kind: "invite" | "result",
  sent: boolean,
): Promise<void> {
  const c = await ctx();
  const claimCol = kind === "invite" ? "invite_claimed_at" : "result_claimed_at";
  const sentCol = kind === "invite" ? "invite_sent_at" : "result_sent_at";
  const patch = sent ? { [sentCol]: new Date().toISOString() } : { [claimCol]: null };
  const { error } = await c.sb
    .from(CANDIDATES)
    .update(patch)
    .eq("tenant_id", c.tenantId)
    .eq("id", candidateId);
  if (error) writeFail(sent ? "the sent mark" : "the send claim", error);
}
