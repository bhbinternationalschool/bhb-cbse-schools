/**
 * Admissions desk — Supabase normalized tables (admission_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultAdmissionsState,
  normalizeAdmissionHousehold,
  normalizeAdmissionLead,
  normalizeRegistrationPayment,
  normalizeAdmissionsState,
  type AdmissionHousehold,
  type AdmissionLead,
  type AdmissionsState,
  type RegistrationFeePayment,
} from "@/lib/admissions";
import { admissionsDualWriteDbEnabled } from "@/lib/admissionsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { stampsOf, writeStampedRows } from "@/lib/rowStampWrite.server";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";

export type AdmissionDeskSyncMeta = {
  householdCount: number;
  leadCount: number;
  openLeadCount: number;
  enrolledLeadCount: number;
  registrationPaymentCount: number;
  lastLeadAt: string | null;
  updatedAt: string;
};

export type AdmissionDeskFieldOps = Pick<
  AdmissionsState,
  | "surveyBeats"
  | "surveyAttendance"
  | "surveyExternals"
  | "surveyTeam"
  | "surveySessions"
  | "leadCallerStaffIds"
  | "nextEnquirySeq"
  | "nextApplicationSeq"
  | "nextHouseholdSeq"
  | "nextRegPaySeq"
  | "nextBeatSeq"
>;

const META_SELECT =
  "household_count, lead_count, open_lead_count, enrolled_lead_count, registration_payment_count, last_lead_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function householdToRow(
  tenantId: string,
  h: AdmissionHousehold,
): Record<string, unknown> {
  return {
    id: h.id,
    tenant_id: tenantId,
    code: h.code || "",
    primary_mobile: h.primaryMobile || "",
    whatsapp: h.whatsapp || "",
    email: h.email || "",
    locality: h.locality || "",
    address: h.address || "",
    city: h.city || "",
    state: h.state || "",
    pincode: h.pincode || "",
    sis_household_id: h.sisHouseholdId || "",
    note: h.note || "",
    guardians_json: h.guardians ?? [],
    household_json: h,
    created_at: h.createdAt || new Date().toISOString(),
    updated_at: h.updatedAt || new Date().toISOString(),
  };
}

function rowToHousehold(r: Record<string, unknown>): AdmissionHousehold {
  const fromJson = r.household_json as Partial<AdmissionHousehold> | undefined;
  if (fromJson?.id) return normalizeAdmissionHousehold(fromJson);
  return normalizeAdmissionHousehold({
    id: String(r.id),
    code: String(r.code || ""),
    primaryMobile: String(r.primary_mobile || ""),
    whatsapp: String(r.whatsapp || ""),
    email: String(r.email || ""),
    locality: String(r.locality || ""),
    address: String(r.address || ""),
    city: String(r.city || ""),
    state: String(r.state || ""),
    pincode: String(r.pincode || ""),
    guardians: Array.isArray(r.guardians_json)
      ? (r.guardians_json as AdmissionHousehold["guardians"])
      : [],
    sisHouseholdId: String(r.sis_household_id || ""),
    note: String(r.note || ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });
}

function leadToRow(tenantId: string, l: AdmissionLead): Record<string, unknown> {
  return {
    id: l.id,
    tenant_id: tenantId,
    household_id: l.householdId || "",
    enquiry_no: l.enquiryNo || "",
    application_no: l.applicationNo || "",
    stage: l.stage,
    academic_year_code: l.academicYearCode,
    source: l.source || "other",
    child_name: l.childName || "",
    mobile: l.mobile || "",
    guardian_name: l.guardianName || "",
    class_sought_id: l.classSoughtId || "",
    assigned_to: l.assignedTo || "",
    next_follow_up_at: l.nextFollowUpAt || null,
    lead_date: l.leadDate || null,
    student_id: l.studentId || "",
    admission_no: l.admissionNo || "",
    sis_match: l.sisMatch || "",
    sis_student_id: l.sisStudentId || "",
    lead_json: l,
    created_at: l.createdAt || new Date().toISOString(),
    updated_at: l.updatedAt || new Date().toISOString(),
  };
}

function rowToLead(r: Record<string, unknown>): AdmissionLead {
  const fromJson = r.lead_json as Partial<AdmissionLead> | undefined;
  if (fromJson?.id) return normalizeAdmissionLead(fromJson);
  return normalizeAdmissionLead({
    id: String(r.id),
    householdId: String(r.household_id || ""),
    enquiryNo: String(r.enquiry_no || ""),
    applicationNo: String(r.application_no || ""),
    stage: r.stage as AdmissionLead["stage"],
    academicYearCode: String(r.academic_year_code),
    source: r.source as AdmissionLead["source"],
    childName: String(r.child_name || ""),
    mobile: String(r.mobile || ""),
    guardianName: String(r.guardian_name || ""),
    classSoughtId: String(r.class_sought_id || ""),
    assignedTo: String(r.assigned_to || ""),
    nextFollowUpAt: r.next_follow_up_at
      ? String(r.next_follow_up_at).slice(0, 10)
      : "",
    leadDate: r.lead_date ? String(r.lead_date).slice(0, 10) : "",
    studentId: String(r.student_id || ""),
    admissionNo: String(r.admission_no || ""),
    sisMatch: r.sis_match as AdmissionLead["sisMatch"],
    sisStudentId: String(r.sis_student_id || ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });
}

function paymentToRow(
  tenantId: string,
  p: RegistrationFeePayment,
): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    code: p.code || "",
    lead_id: p.leadId || "",
    fee_head_id: p.feeHeadId || "",
    amount_paise: p.amountPaise,
    status: p.status,
    mode: p.mode || "counter",
    mobile: p.mobile || "",
    child_name: p.childName || "",
    paid_at: p.paidAt || null,
    payment_json: p,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rowToPayment(r: Record<string, unknown>): RegistrationFeePayment {
  const fromJson = r.payment_json as Partial<RegistrationFeePayment> | undefined;
  if (fromJson?.id) {
    return normalizeRegistrationPayment(fromJson);
  }
  return normalizeRegistrationPayment({
    id: String(r.id),
    code: String(r.code || ""),
    leadId: String(r.lead_id || ""),
    feeHeadId: String(r.fee_head_id || ""),
    amountPaise: Number(r.amount_paise || 0),
    status: r.status as RegistrationFeePayment["status"],
    mode: r.mode as RegistrationFeePayment["mode"],
    mobile: String(r.mobile || ""),
    childName: String(r.child_name || ""),
    paidAt: String(r.paid_at || ""),
    createdAt: String(r.created_at),
  });
}

function fieldOpsFromState(state: AdmissionsState): AdmissionDeskFieldOps {
  return {
    surveyBeats: state.surveyBeats,
    surveyAttendance: state.surveyAttendance,
    surveyExternals: state.surveyExternals,
    surveyTeam: state.surveyTeam,
    surveySessions: state.surveySessions,
    leadCallerStaffIds: state.leadCallerStaffIds,
    nextEnquirySeq: state.nextEnquirySeq,
    nextApplicationSeq: state.nextApplicationSeq,
    nextHouseholdSeq: state.nextHouseholdSeq,
    nextRegPaySeq: state.nextRegPaySeq,
    nextBeatSeq: state.nextBeatSeq,
  };
}

function fieldOpsToState(
  ops: AdmissionDeskFieldOps | null,
  base: AdmissionsState,
): AdmissionsState {
  if (!ops) return base;
  return normalizeAdmissionsState({
    ...base,
    surveyBeats: ops.surveyBeats,
    surveyAttendance: ops.surveyAttendance,
    surveyExternals: ops.surveyExternals,
    surveyTeam: ops.surveyTeam,
    surveySessions: ops.surveySessions,
    leadCallerStaffIds: ops.leadCallerStaffIds,
    nextEnquirySeq: ops.nextEnquirySeq,
    nextApplicationSeq: ops.nextApplicationSeq,
    nextHouseholdSeq: ops.nextHouseholdSeq,
    nextRegPaySeq: ops.nextRegPaySeq,
    nextBeatSeq: ops.nextBeatSeq,
  });
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): AdmissionDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    householdCount: metaRow.household_count as number,
    leadCount: metaRow.lead_count as number,
    openLeadCount: metaRow.open_lead_count as number,
    enrolledLeadCount: metaRow.enrolled_lead_count as number,
    registrationPaymentCount: metaRow.registration_payment_count as number,
    lastLeadAt: metaRow.last_lead_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

/**
 * Restore the fields a projected lead never carried, before it is written.
 *
 * Stage 6 sends the list without `lead_json` — 1.82 MB of the table's 2.37 MB.
 * rowToLead() then rebuilds each lead from the ~20 promoted columns, but
 * AdmissionLead has 79 fields: dob, gender, address, motherName, email, the
 * document checklist and 53 others live only in lead_json. A lead that came
 * from the list is a stub.
 *
 * leadToRow writes `lead_json: l` wholesale, and the client pushes whole
 * state, so without this a single save would blank 59 fields on all 919
 * leads at once. That is not a hypothetical: the identical shape — a partial
 * value overwriting a complete one — orphaned 711 students earlier today.
 *
 * The guarantee is server-side on purpose. A client-side rule would hold only
 * as long as every future caller remembered it; this holds even when one
 * does not, because the stored record is read and merged here regardless of
 * what the browser believed it was sending.
 *
 * One extra SELECT, and only when a stub is actually present.
 */
async function restorePartialLeads(
  sb: SupabaseClient,
  tenantId: string,
  leads: AdmissionLead[],
): Promise<AdmissionLead[]> {
  const stubs = leads.filter((l) => (l as { __partial?: boolean }).__partial);
  if (stubs.length === 0) return leads;

  const { data, error } = await sb
    .from("admission_desk_leads")
    .select("id, lead_json")
    .eq("tenant_id", tenantId)
    .in("id", stubs.map((l) => l.id));

  if (error) {
    // Cannot read what we would be overwriting. Refuse rather than write a
    // stub over a record we never saw — see mastersStoredReadFailure.
    throw new Error(
      `Cannot save admissions: the stored leads could not be read to merge ` +
        `against (${error.message}). Nothing was written.`,
    );
  }

  const stored = new Map(
    (data ?? []).map((r) => [
      String((r as { id: unknown }).id),
      (r as { lead_json?: Partial<AdmissionLead> }).lead_json ?? {},
    ]),
  );

  return leads.map((l) => {
    if (!(l as { __partial?: boolean }).__partial) return l;
    const base = stored.get(l.id);
    if (!base) return l; // genuinely new: the stub IS the whole record
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(l)) {
      if (k === "__partial") continue;
      if (v !== undefined) merged[k] = v;
    }
    return merged as AdmissionLead;
  });
}

/** The admissions lists saved row by row, in write order. */
export const ADMISSION_SLICES = ["households", "leads", "registrationPayments"] as const;
export type AdmissionSlice = (typeof ADMISSION_SLICES)[number];
const ADMISSION_SLICE_TABLE: Record<AdmissionSlice, string> = {
  households: "admission_desk_households",
  leads: "admission_desk_leads",
  registrationPayments: "admission_desk_registration_payments",
};
const ADMISSION_SEQ_KEYS = [
  "nextEnquirySeq",
  "nextApplicationSeq",
  "nextHouseholdSeq",
  "nextRegPaySeq",
  "nextBeatSeq",
] as const;

export type AdmissionPushOpts = {
  /**
   * A browser's save: per list, the rows it changed and the `updated_at`
   * each was changed from ("" = new). Only those are written, each only
   * while still at that stamp; the rest come back as conflicts.
   */
  stamps?: RowStamps;
};

export async function pushAdmissionDeskToDb(
  state: AdmissionsState,
  opts: AdmissionPushOpts = {},
): Promise<{ ok: boolean; error?: string; stamps?: RowStamps; conflicts?: RowConflicts }> {
  if (!admissionsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const normalized = normalizeAdmissionsState(state);

  // No stale copy over a newer row (2026-10-09): every lead the save held
  // was upserted, so an office tab that loaded a lead before the WhatsApp
  // bot, a counsellor's call log or the registration link changed it wrote
  // the old lead back — and with it the old stage.
  //  - A browser (stamps) writes only the rows it changed, each only while
  //    still at the stamp it loaded; the rest come back as conflicts.
  //  - Anyone else (server writers, the blob backfill, a browser on an
  //    older build) holds the whole desk: a lead or household is skipped
  //    when the stored one is newer than this copy's (`updatedAt`).
  const picks = (slice: AdmissionSlice) => {
    if (!opts.stamps) return () => true;
    const sent = opts.stamps[slice] ?? {};
    return (id: string) => id in sent;
  };
  // A browser's changed row is an edit made now.
  const touched = <T extends { updatedAt: string }>(r: T): T => (opts.stamps ? { ...r, updatedAt: now } : r);

  const households = (normalized.households ?? []).filter((h) => picks("households")(h.id)).map(touched);
  // Stubs from the projected list get their missing 59 fields back from the
  // database before anything is written. See restorePartialLeads.
  const leads = await restorePartialLeads(
    sb,
    tenantId,
    (normalized.leads ?? []).filter((l) => picks("leads")(l.id)).map(touched),
  );
  const payments = (normalized.registrationPayments ?? []).filter((p) => picks("registrationPayments")(p.id));
  const rows: Record<AdmissionSlice, Record<string, unknown>[]> = {
    households: households.map((h) => householdToRow(tenantId, h)),
    leads: leads.map((l) => leadToRow(tenantId, l)),
    registrationPayments: payments.map((p) => paymentToRow(tenantId, p)),
  };

  const newStamps: RowStamps = {};
  const conflicts: RowConflicts = {};
  for (const slice of ADMISSION_SLICES) {
    const table = ADMISSION_SLICE_TABLE[slice];
    if (opts.stamps) {
      const w = await writeStampedRows(sb, table, tenantId, rows[slice], opts.stamps[slice] ?? {});
      if (!w.ok) return w;
      newStamps[slice] = w.stamps;
      if (w.conflicts.length) conflicts[slice] = w.conflicts;
      continue;
    }
    let write = rows[slice];
    if (slice !== "registrationPayments") {
      const newer = await storedNewer(sb, tenantId, table, write);
      if (!newer.ok) return newer;
      if (newer.ids.size) {
        console.warn(`[admissions-db] ${table}: kept ${newer.ids.size} newer row(s) over a stale copy`);
        write = write.filter((r) => !newer.ids.has(String(r.id)));
      }
    }
    const r = await upsertChunks(sb, table, write);
    if (!r.ok) return r;
  }

  // No prune by absence. Leads and households are never deleted in the UI
  // (a merged duplicate is marked lost), and they are written by many hands
  // that never pass through this browser: the public enquiry form inserts
  // directly, the WhatsApp bot upserts single leads, Google lead forms, the
  // survey-day and staff-app captures all push from the server. Any of those
  // landing after this copy was read used to be deleted by it — the paid and
  // enrolled leads were protected, the fresh enquiries were not. Registration
  // payments were already append-only.

  // The number counters only move forward: a stale copy rewinding one
  // hands out an enquiry or receipt number twice.
  const { data: storedOps, error: opsErr } = await sb
    .from("admission_desk_field_ops")
    .select("sequences_json")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (opsErr) return { ok: false, error: `Could not read the number counters: ${opsErr.message}` };
  const storedSeq = ((storedOps as { sequences_json?: Record<string, unknown> } | null)?.sequences_json ?? {});
  const ops = fieldOpsFromState(normalized);
  const seq = (k: (typeof ADMISSION_SEQ_KEYS)[number]) =>
    Math.max(Number(ops[k]) || 0, Number(storedSeq[k]) || 0);
  await sb.from("admission_desk_field_ops").upsert({
    tenant_id: tenantId,
    ops_json: {
      surveyBeats: ops.surveyBeats,
      surveyAttendance: ops.surveyAttendance,
      surveyExternals: ops.surveyExternals,
      surveyTeam: ops.surveyTeam,
      surveySessions: ops.surveySessions,
      leadCallerStaffIds: ops.leadCallerStaffIds,
    },
    sequences_json: {
      nextEnquirySeq: seq("nextEnquirySeq"),
      nextApplicationSeq: seq("nextApplicationSeq"),
      nextHouseholdSeq: seq("nextHouseholdSeq"),
      nextRegPaySeq: seq("nextRegPaySeq"),
      nextBeatSeq: seq("nextBeatSeq"),
    },
    updated_at: now,
  });

  // Counts from the database, not from this copy (it may be partly written).
  await touchAdmissionMeta(sb, tenantId, now).catch(() => undefined);
  if (Object.keys(conflicts).length) console.warn("[admissions-db] kept newer rows over a stale copy", conflicts);
  return { ok: true, stamps: newStamps, conflicts };
}

/**
 * Rows the database holds at a later `updated_at` than this copy's — a
 * whole-desk writer's stale copy of them must not be written. A failed read
 * writes nothing (unknown is not "older").
 */
export async function storedNewer(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  const ids = new Set<string>();
  if (!rows.length) return { ok: true, ids };
  const mine = new Map(rows.map((r) => [String(r.id), Date.parse(String(r.updated_at ?? ""))]));
  const res = await fetchByIds<Record<string, unknown>>(
    [...mine.keys()],
    (chunk, from, to) =>
      sb
        .from(table)
        .select("id, updated_at")
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    { chunkSize: 150 },
  );
  if (res.error) return { ok: false, error: `Could not read the stored rows to compare: ${res.error}` };
  for (const s of res.rows) {
    const at = Date.parse(String(s.updated_at ?? ""));
    const own = mine.get(String(s.id));
    if (Number.isFinite(at) && (!Number.isFinite(own) || at > (own as number))) ids.add(String(s.id));
  }
  return { ok: true, ids };
}

/** Recount the desk meta from the tables, so a hydrate sees the change. */
async function touchAdmissionMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const count = (table: string) =>
    sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [hh, all, enrolled, lost, pay, latest] = await Promise.all([
    count("admission_desk_households"),
    count("admission_desk_leads"),
    count("admission_desk_leads").eq("stage", "enrolled"),
    count("admission_desk_leads").eq("stage", "lost"),
    count("admission_desk_registration_payments"),
    sb
      .from("admission_desk_leads")
      .select("updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  const ok = (r: { error: unknown; count: number | null }) => !r.error && typeof r.count === "number";
  if (ok(hh)) row.household_count = hh.count;
  if (ok(all)) row.lead_count = all.count;
  if (ok(enrolled)) row.enrolled_lead_count = enrolled.count;
  if (ok(all) && ok(enrolled) && ok(lost)) row.open_lead_count = all.count! - enrolled.count! - lost.count!;
  if (ok(pay)) row.registration_payment_count = pay.count;
  if (!latest.error) row.last_lead_at = (latest.data as { updated_at?: string } | null)?.updated_at ?? null;
  await sb.from("admission_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

/**
 * Columns a lead LIST needs. Everything except `lead_json`.
 *
 * lead_json is 1.82 MB of the table's 2.37 MB — 76.8% — and holds 59 of the
 * 79 AdmissionLead fields: dob, gender, address, motherName, email, the
 * document checklist. No list screen reads any of them; they are needed only
 * when a lead is opened.
 *
 * A lead built from these columns alone is a STUB and is marked `__partial`.
 * Saving one back would blank those 59 fields, which is why
 * restorePartialLeads() merges against the stored record before any write —
 * that guard shipped first, deliberately.
 */
const LEAD_LIST_COLUMNS =
  "id, tenant_id, household_id, enquiry_no, application_no, stage, " +
  "academic_year_code, source, child_name, mobile, guardian_name, " +
  "class_sought_id, assigned_to, next_follow_up_at, lead_date, student_id, " +
  "admission_no, sis_match, sis_student_id, created_at, updated_at";

/**
 * Serve lead lists without lead_json.
 *
 * OPT-IN via ADMISSIONS_LIST_PROJECTION. Rollback is removing the variable —
 * no code change, no redeploy of a different build. The same shape the masters
 * row-table flip used, for the same reason: a read path this large should be
 * reversible in seconds, not in a build.
 */
function leadProjectionEnabled(): boolean {
  const flag = process.env.ADMISSIONS_LIST_PROJECTION?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

/**
 * The complete record for one lead, lead_json included.
 *
 * The other half of the projection: the list carries 20 of 79 fields, so
 * anything that opens or edits a lead must fetch the rest. Without this the
 * projection would silently hide dob, address, documents and 55 more from
 * every detail screen.
 *
 * Returns null when the lead does not exist. A READ FAILURE throws instead —
 * the caller must not mistake "could not read" for "no such lead" and then
 * offer to create one, which is the mistake that has cost this system a
 * roster and a day of attendance.
 */
export async function fetchAdmissionLeadDetail(
  leadId: string,
): Promise<AdmissionLead | null> {
  const ctx = await resolveCtx();
  if (!ctx) throw new Error("Supabase tenant not configured");
  const { sb, tenantId } = ctx;

  const { data, error } = await sb
    .from("admission_desk_leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read lead ${leadId}: ${error.message}`);
  }
  if (!data) return null;
  return rowToLead(data as unknown as Record<string, unknown>);
}

export async function fetchAdmissionDeskFromDb(): Promise<{
  state: AdmissionsState;
  meta: AdmissionDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; state is NOT a confirmed empty state. */
  ok: boolean;
  /** Each row's `updated_at`, per list — what a browser's save is stamped with. */
  stamps: RowStamps;
}> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return { state: defaultAdmissionsState(), meta: null, ok: false, stamps: {} };
  }
  const { sb, tenantId } = ctx;

  const [
    { data: hhRows, error: hhErr },
    { data: leadRows, error: leadErr },
    { data: payRows, error: payErr },
    { data: opsRow },
    { data: metaRow },
  ] = await Promise.all([
    // All three paged. The lead list stood at 948 rows on 2026-09-06; the
    // unpaged read sorted newest-first, so the first leads to vanish would
    // have been the oldest — the ones still waiting on a decision.
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from("admission_desk_households").select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("admission_desk_leads")
        .select(leadProjectionEnabled() ? LEAD_LIST_COLUMNS : "*")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>,
    ).then((r) => ({
      data: r.rows.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))),
      error: r.error ? { message: r.error } : null,
    })),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from("admission_desk_registration_payments").select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
    sb
      .from("admission_desk_field_ops")
      .select("ops_json, sequences_json")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("admission_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (hhErr || leadErr || payErr) {
    console.warn(
      "[admissions-db] fetch failed",
      hhErr?.message,
      leadErr?.message,
      payErr?.message,
    );
    return { state: defaultAdmissionsState(), meta: null, ok: false, stamps: {} };
  }

  const households = (hhRows ?? []).map((r) =>
    rowToHousehold(r as Record<string, unknown>),
  );
  // Marked so the write path knows to merge rather than replace. rowToLead
  // already falls back to the promoted columns when lead_json is absent, so
  // the list renders identically — it is the SAVE that must know.
  const projected = leadProjectionEnabled();
  const leads = (leadRows ?? []).map((r) => {
    // Cast through unknown: the projection is chosen at runtime, so
    // PostgREST's typed select inference cannot narrow the row shape.
    const lead = rowToLead(r as unknown as Record<string, unknown>);
    return projected
      ? ({ ...lead, __partial: true } as typeof lead)
      : lead;
  });
  const registrationPayments = (payRows ?? []).map((r) =>
    rowToPayment(r as Record<string, unknown>),
  );

  const opsJson = (opsRow?.ops_json ?? {}) as Record<string, unknown>;
  const seqJson = (opsRow?.sequences_json ?? {}) as Record<string, unknown>;

  const base = normalizeAdmissionsState({
    version: 1,
    households,
    leads,
    registrationPayments,
    surveyBeats: opsJson.surveyBeats as AdmissionsState["surveyBeats"],
    surveyAttendance: opsJson.surveyAttendance as AdmissionsState["surveyAttendance"],
    surveyExternals: opsJson.surveyExternals as AdmissionsState["surveyExternals"],
    surveyTeam: opsJson.surveyTeam as AdmissionsState["surveyTeam"],
    surveySessions: opsJson.surveySessions as AdmissionsState["surveySessions"],
    leadCallerStaffIds: opsJson.leadCallerStaffIds as string[],
    nextEnquirySeq: seqJson.nextEnquirySeq as number,
    nextApplicationSeq: seqJson.nextApplicationSeq as number,
    nextHouseholdSeq: seqJson.nextHouseholdSeq as number,
    nextRegPaySeq: seqJson.nextRegPaySeq as number,
    nextBeatSeq: seqJson.nextBeatSeq as number,
  });

  return {
    state: fieldOpsToState(null, base),
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
    ok: true,
    stamps: {
      households: stampsOf(hhRows),
      leads: stampsOf(leadRows as Record<string, unknown>[]),
      registrationPayments: stampsOf(payRows),
    },
  };
}

export async function pushAdmissionLeadToDb(
  lead: AdmissionLead,
): Promise<{ ok: boolean; error?: string }> {
  if (!admissionsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;

  const { error } = await sb
    .from("admission_desk_leads")
    // A fresh stamp, on the lead too: a browser holding it from before is
    // refused, and a whole-desk writer's older copy is skipped.
    .upsert(leadToRow(tenantId, normalizeAdmissionLead({ ...lead, updatedAt: new Date().toISOString() })));
  if (error) return { ok: false, error: error.message };

  await sb.from("admission_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      last_lead_at: lead.updatedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

/**
 * Leads whose mobile or whatsapp number matches — a handful of rows at
 * most, never the whole table. Built for waCrmBotServer.ts's WhatsApp
 * profile-name backfill, which used to read the leads out of
 * school_mirror_state (a stale, 2+ MB copy — see the egress
 * investigation) via getSchoolMirrorSync() and write back through
 * setMirrorSlice(), which only patches the server's in-memory copy:
 * admissions writes are already skip-gated from ever reaching the blob
 * once ADMISSIONS_READ_FROM_DB is on, so that write silently never
 * reached admission_desk_leads at all. This talks to the real table
 * directly, both ways.
 */
export async function findAdmissionLeadCandidatesByMobile(
  mobile10: string,
): Promise<AdmissionLead[]> {
  const ctx = await resolveCtx();
  if (!ctx) return [];
  const { sb, tenantId } = ctx;

  // whatsapp is not a promoted column on this table — only mobile is; it
  // lives inside lead_json, hence the ->> extraction for the second half
  // of the match. Caught by testing against a real lead before this
  // shipped: the naive mobile.eq,whatsapp.eq filter 42703'd outright.
  const { data, error } = await sb
    .from("admission_desk_leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .or(`mobile.eq.${mobile10},lead_json->>whatsapp.eq.${mobile10}`);
  if (error || !data) return [];

  return data.map((row) => rowToLead(row as Record<string, unknown>));
}
