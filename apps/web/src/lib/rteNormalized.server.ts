/**
 * RTE desk — Supabase normalized tables (rte_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuotaApplication,
  QuotaSeat,
  RteSettings,
  RteState,
} from "@/lib/rteEws";
import { rteDualWriteDbEnabled } from "@/lib/rteDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";

export type RteDeskSyncMeta = {
  seatCount: number;
  applicationCount: number;
  lastApplicationAt: string | null;
  updatedAt: string;
};

export type RteDeskBundle = Pick<RteState, "seats" | "applications" | "settings">;

const META_SELECT =
  "seat_count, application_count, last_application_at, updated_at";

const DEFAULT_SETTINGS: RteSettings = {
  mandatedPct: 25,
  autoApplyFeeWaiver: true,
  note: "",
};

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
  chunk = 100,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function seatToRow(tenantId: string, s: QuotaSeat): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: tenantId,
    class_id: s.classId || "",
    academic_year_code: s.academicYearCode || "",
    type: s.type || "RTE",
    total: Math.max(0, Number(s.total) || 0),
    note: s.note || "",
    updated_at: nowIso(),
  };
}

function rowToSeat(r: Record<string, unknown>): QuotaSeat {
  return {
    id: String(r.id),
    classId: String(r.class_id || ""),
    academicYearCode: String(r.academic_year_code || ""),
    type: String(r.type || "RTE") as QuotaSeat["type"],
    total: Number(r.total ?? 0),
    note: String(r.note || ""),
  };
}

function appToRow(tenantId: string, a: QuotaApplication): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    academic_year_code: a.academicYearCode || "",
    class_id: a.classId || "",
    type: a.type || "RTE",
    child_name: a.childName || "",
    parent_name: a.parentName || "",
    mobile: a.mobile || "",
    category: a.category || "",
    annual_income: a.annualIncome || "",
    govt_application_no: a.govtApplicationNo || "",
    student_id: a.studentId || null,
    admission_lead_id: a.admissionLeadId || null,
    docs_income: !!a.docsIncome,
    docs_category: !!a.docsCategory,
    docs_residence: !!a.docsResidence,
    lottery_no: a.lotteryNo || "",
    merit_rank: Math.max(0, Number(a.meritRank) || 0),
    gender: a.gender || "",
    date_of_birth: a.dateOfBirth || "",
    portal_serial_no: a.portalSerialNo || "",
    block_town: a.blockTown || "",
    gram_panchayat_ward: a.gramPanchayatWard || "",
    portal_admission_status: a.portalAdmissionStatus || "",
    status: a.status || "govt_assigned",
    registration_fee_choice: a.registrationFeeChoice || "pending",
    registration_fee_amount_paise: Math.max(
      0,
      Math.round(Number(a.registrationFeeAmountPaise) || 0),
    ),
    registration_fee_note: a.registrationFeeNote || "",
    registration_fee_paid: !!a.registrationFeePaid,
    note: a.note || "",
    created_at: a.createdAt || nowIso(),
    decided_by: a.decidedBy || null,
    decided_at: a.decidedAt || null,
    updated_at: a.updatedAt || nowIso(),
  };
}

function rowToApp(r: Record<string, unknown>): QuotaApplication {
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code || ""),
    classId: String(r.class_id || ""),
    type: String(r.type || "RTE") as QuotaApplication["type"],
    childName: String(r.child_name || ""),
    parentName: String(r.parent_name || ""),
    mobile: String(r.mobile || ""),
    category: String(r.category || ""),
    annualIncome: String(r.annual_income || ""),
    govtApplicationNo: String(r.govt_application_no || ""),
    studentId: r.student_id ? String(r.student_id) : undefined,
    admissionLeadId: r.admission_lead_id
      ? String(r.admission_lead_id)
      : undefined,
    docsIncome: !!r.docs_income,
    docsCategory: !!r.docs_category,
    docsResidence: !!r.docs_residence,
    lotteryNo: String(r.lottery_no || ""),
    meritRank: Number(r.merit_rank ?? 0),
    gender: String(r.gender || ""),
    dateOfBirth: String(r.date_of_birth || ""),
    portalSerialNo: String(r.portal_serial_no || ""),
    blockTown: String(r.block_town || ""),
    gramPanchayatWard: String(r.gram_panchayat_ward || ""),
    portalAdmissionStatus: String(r.portal_admission_status || ""),
    status: String(r.status || "govt_assigned") as QuotaApplication["status"],
    registrationFeeChoice: String(
      r.registration_fee_choice || "pending",
    ) as QuotaApplication["registrationFeeChoice"],
    registrationFeeAmountPaise: Number(r.registration_fee_amount_paise ?? 0),
    registrationFeeNote: String(r.registration_fee_note || ""),
    registrationFeePaid: !!r.registration_fee_paid,
    note: String(r.note || ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    decidedBy: r.decided_by ? String(r.decided_by) : undefined,
    decidedAt: r.decided_at ? String(r.decided_at) : undefined,
  };
}

function settingsToRow(
  tenantId: string,
  settings: RteSettings,
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    mandated_pct: settings.mandatedPct ?? 25,
    auto_apply_fee_waiver: settings.autoApplyFeeWaiver !== false,
    note: settings.note || "",
    updated_at: nowIso(),
  };
}

function rowToSettings(r: Record<string, unknown> | null): RteSettings {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    mandatedPct: Number(r.mandated_pct ?? 25),
    autoApplyFeeWaiver: r.auto_apply_fee_waiver !== false,
    note: String(r.note || ""),
  };
}

function lastApplicationAt(apps: QuotaApplication[]): string | null {
  if (!apps.length) return null;
  return apps.reduce(
    (max, a) => (a.updatedAt > max ? a.updatedAt : max),
    apps[0].updatedAt,
  );
}

/** The RTE tables a desk save deletes from — by named id only. */
export const RTE_DELETABLE_TABLES = ["rte_desk_seats", "rte_desk_applications"] as const;
/** Desk slice each deletable table stores (for function-only writers). */
export const RTE_TABLE_SLICES: Record<string, string> = {
  rte_desk_seats: "seats",
  rte_desk_applications: "applications",
};

export async function pushRteDeskToDb(
  state: RteState,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!rteDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const goneSeats = new Set(deletes["rte_desk_seats"] ?? []);
  const goneApps = new Set(deletes["rte_desk_applications"] ?? []);
  const seats = (state.seats ?? []).filter((s) => !goneSeats.has(s.id));
  const applications = (state.applications ?? []).filter((a) => !goneApps.has(a.id));
  const now = nowIso();

  const seatRows = seats.map((s) => seatToRow(tenantId, s));
  if (seatRows.length > 0) {
    const up = await upsertChunks(sb, "rte_desk_seats", seatRows);
    if (!up.ok) return up;
  }

  const appRows = applications.map((a) => appToRow(tenantId, a));
  if (appRows.length > 0) {
    const up = await upsertChunks(sb, "rte_desk_applications", appRows);
    if (!up.ok) return up;
  }

  // No prune by absence. An empty browser seeds quota seats with fresh ids
  // before it has pulled the desk; that seed used to delete every stored seat,
  // other years' included. Seats and applications leave only when named.
  for (const table of RTE_DELETABLE_TABLES) {
    const del = await deleteNamedIds(sb, tenantId, table, deletes[table]);
    if (!del.ok) return del;
  }

  const { error: settingsErr } = await sb
    .from("rte_desk_settings")
    .upsert(settingsToRow(tenantId, state.settings ?? DEFAULT_SETTINGS));
  if (settingsErr) return { ok: false, error: settingsErr.message };

  await sb.from("rte_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      seat_count: seats.length,
      application_count: applications.length,
      last_application_at: lastApplicationAt(applications),
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchRteDeskFromDb(): Promise<{
  bundle: RteDeskBundle;
  meta: RteDeskSyncMeta | null;
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: RteDeskBundle = {
    seats: [],
    applications: [],
    settings: { ...DEFAULT_SETTINGS },
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [seatRes, appRes, settingsRes, metaRes] = await Promise.all([
    sb.from("rte_desk_seats").select("*").eq("tenant_id", tenantId),
    sb.from("rte_desk_applications").select("*").eq("tenant_id", tenantId),
    sb.from("rte_desk_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    sb
      .from("rte_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (seatRes.error || appRes.error || settingsRes.error || metaRes.error) {
    console.warn(
      "[rte-db] fetchRteDeskFromDb query error",
      seatRes.error || appRes.error || settingsRes.error || metaRes.error,
    );
    return { bundle: empty, meta: null, ok: false };
  }

  const seatRows = seatRes.data;
  const appRows = appRes.data;
  const settingsRow = settingsRes.data;
  const metaRow = metaRes.data;

  const bundle: RteDeskBundle = {
    seats: (seatRows ?? []).map((r) => rowToSeat(r as Record<string, unknown>)),
    applications: (appRows ?? []).map((r) =>
      rowToApp(r as Record<string, unknown>),
    ),
    settings: rowToSettings(
      (settingsRow as Record<string, unknown> | null) ?? null,
    ),
  };

  const meta: RteDeskSyncMeta | null = metaRow
    ? {
        seatCount: Number(metaRow.seat_count ?? bundle.seats.length),
        applicationCount: Number(
          metaRow.application_count ?? bundle.applications.length,
        ),
        lastApplicationAt: metaRow.last_application_at
          ? String(metaRow.last_application_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle, meta, ok: true };
}
