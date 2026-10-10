/**
 * Statutory (EPF/ESIC) compliance — Supabase normalized tables (statutory_desk_*).
 * Mirrors payrollNormalized.server.ts's dual-write/fetch pattern. See
 * statutoryDbConfig.ts for why the write/read flags default OFF here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StatutoryFilingProgress,
  StatutoryRemitBatch,
  StatutoryRemitLine,
  StatutoryRemitState,
} from "@/lib/statutoryRemit";
import type { StatutoryEstablishmentConfig } from "@/lib/foundationMasters";
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import { statutoryDualWriteDbEnabled } from "@/lib/statutoryDbConfig";
import {
  deleteChildrenNotKept,
  deleteNamedIds,
  type NamedDeletes,
} from "@/lib/deskNamedDeletes.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  countDeskRows,
  settingsStampOf,
  writeDeskRows,
  writeDeskSettings,
  type StampedDeskPushResult,
} from "@/lib/deskStamps.server";
import { stampsOf } from "@/lib/rowStampWrite.server";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";

/** Statutory lists saved row by row with stamps (10 Oct 2026). */
export const STATUTORY_STAMPED_SLICES = ["batches"] as const;

export type StatutoryDeskSyncMeta = {
  batchCount: number;
  lineCount: number;
  pendingCount: number;
  lastBatchMonth: string | null;
  updatedAt: string;
};

export type StatutoryDeskBundle = {
  batches: StatutoryRemitBatch[];
  config: StatutoryEstablishmentConfig;
};

const META_SELECT =
  "batch_count, line_count, pending_count, last_batch_month, updated_at";

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

function nowIso() {
  return new Date().toISOString();
}

function lineId(batchId: string, idx: number) {
  return `${batchId}_L${idx}`;
}

function emptyProgress(): StatutoryFilingProgress {
  return {
    filedAt: "",
    filedBy: "",
    challanRefNo: "",
    paidAt: "",
    paidBy: "",
    receiptFileUrl: "",
  };
}

function batchToRow(
  tenantId: string,
  b: StatutoryRemitBatch,
): Record<string, unknown> {
  return {
    id: b.id,
    tenant_id: tenantId,
    month: b.month || "",
    academic_year_code: b.academicYearCode || "",
    payroll_run_id: b.payrollRunId || "",
    status: b.status || "pending_deposit",
    pf_total: b.pfTotal ?? 0,
    esic_total: b.esicTotal ?? 0,
    grand_total: b.grandTotal ?? 0,
    created_at: b.createdAt || nowIso(),
    deposited_at: b.depositedAt || null,
    deposited_by: b.depositedBy || "",
    challan_note: b.challanNote || "",
    total_members: b.totalMembers ?? 0,
    return_file_id: b.returnFileId || "",
    contribution_rate_pct: b.contributionRatePct ?? 12,
    total_epf_contribution: b.totalEpfContribution ?? 0,
    total_eps_contribution: b.totalEpsContribution ?? 0,
    total_epf_eps_contribution: b.totalEpfEpsContribution ?? 0,
    total_edli_contribution: b.totalEdliContribution ?? 0,
    total_ip_contribution: b.totalIpContribution ?? 0,
    epf: b.epf ?? emptyProgress(),
    esic: b.esic ?? emptyProgress(),
    updated_at: nowIso(),
  };
}

function rowToProgress(v: unknown): StatutoryFilingProgress {
  const r = (v as Partial<StatutoryFilingProgress>) || {};
  return {
    filedAt: r.filedAt || "",
    filedBy: r.filedBy || "",
    challanRefNo: r.challanRefNo || "",
    paidAt: r.paidAt || "",
    paidBy: r.paidBy || "",
    receiptFileUrl: r.receiptFileUrl || "",
  };
}

function rowToBatch(
  r: Record<string, unknown>,
  lines: StatutoryRemitLine[],
): StatutoryRemitBatch {
  return {
    id: String(r.id),
    month: String(r.month || ""),
    academicYearCode: String(r.academic_year_code || ""),
    payrollRunId: String(r.payroll_run_id || ""),
    status: r.status === "deposited" ? "deposited" : "pending_deposit",
    lines,
    pfTotal: Number(r.pf_total ?? 0),
    esicTotal: Number(r.esic_total ?? 0),
    grandTotal: Number(r.grand_total ?? 0),
    createdAt: String(r.created_at || nowIso()),
    depositedAt: r.deposited_at ? String(r.deposited_at) : "",
    depositedBy: String(r.deposited_by || ""),
    challanNote: String(r.challan_note || ""),
    totalMembers: Number(r.total_members ?? lines.length),
    returnFileId: String(r.return_file_id || ""),
    contributionRatePct: Number(r.contribution_rate_pct ?? 12),
    totalEpfContribution: Number(r.total_epf_contribution ?? 0),
    totalEpsContribution: Number(r.total_eps_contribution ?? 0),
    totalEpfEpsContribution: Number(r.total_epf_eps_contribution ?? 0),
    totalEdliContribution: Number(r.total_edli_contribution ?? 0),
    totalIpContribution: Number(r.total_ip_contribution ?? 0),
    epf: rowToProgress(r.epf),
    esic: rowToProgress(r.esic),
  };
}

function lineToRow(
  tenantId: string,
  batchId: string,
  idx: number,
  l: StatutoryRemitLine,
): Record<string, unknown> {
  return {
    id: lineId(batchId, idx),
    tenant_id: tenantId,
    batch_id: batchId,
    line_index: idx,
    staff_id: l.staffId || "",
    emp_code: l.empCode || "",
    full_name: l.fullName || "",
    statutory_cover: l.statutoryCover || "",
    pf_employee: l.pfEmployee ?? 0,
    pf_employer: l.pfEmployer ?? 0,
    esic_employee: l.esicEmployee ?? 0,
    esic_employer: l.esicEmployer ?? 0,
    epf_wages: l.epfWages ?? 0,
    eps_wages: l.epsWages ?? 0,
    edli_wages: l.edliWages ?? 0,
    eps_amount: l.epsAmount ?? 0,
    edli_amount: l.edliAmount ?? 0,
    uan_number: l.uanNumber || "",
    esic_ip_number: l.esicIpNumber || "",
    updated_at: nowIso(),
  };
}

function rowToLine(r: Record<string, unknown>): StatutoryRemitLine {
  return {
    staffId: String(r.staff_id || ""),
    empCode: String(r.emp_code || ""),
    fullName: String(r.full_name || ""),
    statutoryCover: String(r.statutory_cover || ""),
    pfEmployee: Number(r.pf_employee ?? 0),
    pfEmployer: Number(r.pf_employer ?? 0),
    esicEmployee: Number(r.esic_employee ?? 0),
    esicEmployer: Number(r.esic_employer ?? 0),
    epfWages: Number(r.epf_wages ?? 0),
    epsWages: Number(r.eps_wages ?? 0),
    edliWages: Number(r.edli_wages ?? 0),
    epsAmount: Number(r.eps_amount ?? 0),
    edliAmount: Number(r.edli_amount ?? 0),
    uanNumber: String(r.uan_number || ""),
    esicIpNumber: String(r.esic_ip_number || ""),
  };
}

function configToRow(
  tenantId: string,
  c: StatutoryEstablishmentConfig,
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    epf_establishment_id: c.epfEstablishmentId || "",
    epf_lin: c.epfLin || "",
    epf_contribution_rate_pct: c.epfContributionRatePct ?? 12,
    apply_epf_wage_ceiling: c.applyEpfWageCeiling !== false,
    epf_wage_ceiling: c.epfWageCeiling ?? 15000,
    esic_employer_code: c.esicEmployerCode || "",
    esic_wage_ceiling: c.esicWageCeiling ?? 21000,
    esic_employee_rate_pct: c.esicEmployeeRatePct ?? 0.75,
    esic_employer_rate_pct: c.esicEmployerRatePct ?? 3.25,
    penalty: c.penalty,
    updated_at: nowIso(),
  };
}

/** The only statutory table a desk save deletes from — by named id. */
export const STATUTORY_DELETABLE_TABLES = ["statutory_desk_batches"] as const;

/**
 * Save the statutory desk. Stamped (`opts.stamps`): only the batches named,
 * each at the stamp it was loaded at — a stale tab can no longer mark a
 * deposited batch pending again. Lines go only with a batch whose save
 * landed; the establishment config only from the stamp it was loaded at.
 * Unstamped (older tabs): new batches only.
 */
export async function pushStatutoryDeskToDb(
  state: StatutoryRemitState,
  config: StatutoryEstablishmentConfig,
  deletes: NamedDeletes = {},
  opts: { stamps?: RowStamps; configBase?: string | null } = {},
): Promise<StampedDeskPushResult> {
  if (!statutoryDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const goneBatches = new Set(deletes["statutory_desk_batches"] ?? []);
  const batches = (state.batches ?? []).filter((b) => !goneBatches.has(b.id));

  const lineKeep = new Set<string>();
  const lineRows: Record<string, unknown>[] = [];
  for (const b of batches) {
    (b.lines ?? []).forEach((l, idx) => {
      const lid = lineId(b.id, idx);
      lineKeep.add(lid);
      lineRows.push(lineToRow(tenantId, b.id, idx, l));
    });
  }

  const stamped = opts.stamps !== undefined;
  const conflicts: RowConflicts = {};
  const batchWrite = await writeDeskRows(
    sb,
    tenantId,
    "statutory_desk_batches",
    batches.map((b) => batchToRow(tenantId, b)),
    stamped ? (opts.stamps!.batches ?? {}) : undefined,
  );
  if (!batchWrite.ok) return batchWrite;
  if (batchWrite.conflicts.length) conflicts.batches = batchWrite.conflicts;

  // Lines travel only with a batch whose save landed.
  const landedBatches = batches.filter((b) => batchWrite.landed.has(b.id));
  const up = await upsertChunks(
    sb,
    "statutory_desk_lines",
    lineRows.filter((l) => batchWrite.landed.has(String(l.batch_id))),
  );
  if (!up.ok) return { ok: false, error: up.error || "statutory_desk_lines: write failed" };

  // No prune by absence. A batch the desk removed is named (lines cascade).
  // A batch's lines are rewritten when it is re-synced from its payroll run,
  // so lines past the new count are removed — only under batches whose save
  // just landed.
  const delBatches = await deleteNamedIds(sb, tenantId, "statutory_desk_batches", [...goneBatches]);
  if (!delBatches.ok) return { ok: false, error: delBatches.error || "statutory_desk_batches: delete failed" };
  const delLines = await deleteChildrenNotKept(
    sb,
    tenantId,
    "statutory_desk_lines",
    "batch_id",
    landedBatches.map((b) => b.id),
    lineKeep,
  );
  if (!delLines.ok) return { ok: false, error: delLines.error || "statutory_desk_lines: delete failed" };

  const set = await writeDeskSettings(
    sb,
    tenantId,
    "statutory_establishment_config",
    configToRow(tenantId, config),
    stamped,
    opts.configBase,
  );
  if (!set.ok) return set;
  if (set.conflict) conflicts.config = ["config"];

  // Counted from the tables: a stamped save carries only what changed.
  const [batchCount, lineCount, pendingCount, lastBatch] = await Promise.all([
    countDeskRows(sb, tenantId, "statutory_desk_batches"),
    countDeskRows(sb, tenantId, "statutory_desk_lines"),
    countDeskRows(sb, tenantId, "statutory_desk_batches", { column: "status", value: "pending_deposit" }),
    sb
      .from("statutory_desk_batches")
      .select("month")
      .eq("tenant_id", tenantId)
      .neq("month", "")
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  await sb.from("statutory_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      batch_count: batchCount,
      line_count: lineCount,
      pending_count: pendingCount,
      last_batch_month: (lastBatch.data as { month?: string } | null)?.month ?? null,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, stamps: { batches: batchWrite.stamps }, conflicts, settingsStamp: set.stamp, kept: batchWrite.kept };
}

export async function fetchStatutoryDeskFromDb(): Promise<{
  stamps?: RowStamps;
  settingsStamp?: string;
  bundle: StatutoryDeskBundle;
  meta: StatutoryDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: StatutoryDeskBundle = {
    batches: [],
    config: normalizeStatutoryConfig(null),
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  // Paged: PostgREST stops at 1,000 rows and calls it success; a batch read
  // back short of lines would be saved back short.
  const page = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from(table).select("*").eq("tenant_id", tenantId).order("id").range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null }));
  const [
    { data: batchRows, error: batchErr },
    { data: lineRows, error: lineErr },
    { data: configRow },
    { data: metaRow },
  ] = await Promise.all([
    page("statutory_desk_batches"),
    page("statutory_desk_lines"),
    sb
      .from("statutory_establishment_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("statutory_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (batchErr || lineErr) {
    console.warn(
      "[statutory-db] fetch failed",
      batchErr?.message,
      lineErr?.message,
    );
    return { bundle: empty, meta: null, ok: false };
  }

  const linesByBatch = new Map<string, StatutoryRemitLine[]>();
  // In line order: line ids are positional.
  const orderedLines = [...(lineRows ?? [])].sort(
    (a, b) => Number(a.line_index ?? 0) - Number(b.line_index ?? 0),
  );
  for (const row of orderedLines) {
    const r = row as Record<string, unknown>;
    const batchId = String(r.batch_id);
    const list = linesByBatch.get(batchId) ?? [];
    list.push(rowToLine(r));
    linesByBatch.set(batchId, list);
  }

  const batches = (batchRows ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const id = String(rec.id);
    return rowToBatch(rec, linesByBatch.get(id) ?? []);
  });

  const config = configRow
    ? normalizeStatutoryConfig({
        epfEstablishmentId: String(
          (configRow as Record<string, unknown>).epf_establishment_id || "",
        ),
        epfLin: String((configRow as Record<string, unknown>).epf_lin || ""),
        epfContributionRatePct: Number(
          (configRow as Record<string, unknown>).epf_contribution_rate_pct ?? 12,
        ),
        applyEpfWageCeiling:
          (configRow as Record<string, unknown>).apply_epf_wage_ceiling !== false,
        epfWageCeiling: Number(
          (configRow as Record<string, unknown>).epf_wage_ceiling ?? 15000,
        ),
        esicEmployerCode: String(
          (configRow as Record<string, unknown>).esic_employer_code || "",
        ),
        esicWageCeiling: Number(
          (configRow as Record<string, unknown>).esic_wage_ceiling ?? 21000,
        ),
        esicEmployeeRatePct: Number(
          (configRow as Record<string, unknown>).esic_employee_rate_pct ?? 0.75,
        ),
        esicEmployerRatePct: Number(
          (configRow as Record<string, unknown>).esic_employer_rate_pct ?? 3.25,
        ),
        penalty: (configRow as Record<string, unknown>)
          .penalty as StatutoryEstablishmentConfig["penalty"],
      })
    : normalizeStatutoryConfig(null);

  return {
    bundle: { batches, config },
    stamps: { batches: stampsOf(batchRows as Record<string, unknown>[]) },
    settingsStamp: settingsStampOf(configRow),
    meta: metaRow
      ? {
          batchCount: Number((metaRow as Record<string, unknown>).batch_count ?? 0),
          lineCount: Number((metaRow as Record<string, unknown>).line_count ?? 0),
          pendingCount: Number((metaRow as Record<string, unknown>).pending_count ?? 0),
          lastBatchMonth:
            ((metaRow as Record<string, unknown>).last_batch_month as
              | string
              | null) ?? null,
          updatedAt: String((metaRow as Record<string, unknown>).updated_at || nowIso()),
        }
      : null,
    ok: true,
  };
}
