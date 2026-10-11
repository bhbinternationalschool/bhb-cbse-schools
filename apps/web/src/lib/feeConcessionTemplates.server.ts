import "server-only";

/**
 * Concession templates — storage, and applying one to many students
 * (table fee_concession_templates; rules in lib/feeConcessionTemplates.ts).
 *
 * Applying writes Masters, never anything else: the template's own Masters
 * rule (minted on first use, kept in step with the template's name and
 * auto-approve limit) and one grant per student, through
 * masters_write_slices — the all-or-none section save the Masters screen
 * uses, at the stamps just read. Grants are APPENDED to the stored list;
 * nothing existing is rewritten or removed. If Masters moved in between,
 * the apply re-reads and re-plans (up to three times) rather than overwrite.
 *
 * The money fields of a template (ground, percent/amount, heads, sibling
 * child, end policy) are fixed once it exists: changing them would silently
 * re-rate every family already granted under it. Make a new template.
 */

import { ApiError } from "@/lib/api/v1/errors";
import { writeAudit } from "@/lib/audit.server";
import type { DemoSession } from "@/lib/auth";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { loadFeeContext } from "@/lib/api/v1/staffFees";
import { computeStudentDues } from "@/lib/fees";
import {
  planTemplateApplication,
  ruleMatchesTemplate,
  templateInputProblem,
  templateRuleCode,
  templateToRule,
  type ConcessionTemplate,
  type TemplateInput,
  type TemplatePlanRow,
  type TemplatePlanStudent,
} from "@/lib/feeConcessionTemplates";
import {
  academicYearEndOn,
  newId,
  type ConcessionGround,
  type ConcessionRule,
} from "@/lib/masters";
import {
  deskBundleToMastersState,
  fetchMastersDeskFromDb,
  pushMastersSlicesToDb,
  type MastersSliceKey,
} from "@/lib/mastersNormalized.server";
import { canApproveConcession, canGrantConcession } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";

type Row = Record<string, unknown>;

export type TemplateRecord = ConcessionTemplate & { updatedAt: string; createdBy: string };

function fromRow(r: Row): TemplateRecord {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    ground: String(r.ground ?? "other") as ConcessionGround,
    mode: r.mode === "fixed" ? "fixed" : "percent",
    value: Number(r.value ?? 0),
    feeHeadIds: Array.isArray(r.fee_head_ids) ? (r.fee_head_ids as string[]) : [],
    siblingChildNo: r.sibling_child_no == null ? null : Number(r.sibling_child_no),
    endPolicy: r.end_policy === "open" ? "open" : "session_end",
    autoApproveMaxPaise: r.auto_approve_max_paise == null ? null : Number(r.auto_approve_max_paise),
    defaultReason: String(r.default_reason ?? ""),
    isActive: r.is_active !== false,
    ruleCode: String(r.rule_code ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    createdBy: String(r.created_by ?? ""),
  };
}

async function tenant() {
  const t = await getServerTenantContext();
  if (!t) throw new ApiError("server_error", "Fee data is unavailable right now", 503);
  return t;
}

/** Every template. null = could not read (the list is small: a school has a handful). */
export async function listTemplates(): Promise<TemplateRecord[] | null> {
  const t = await getServerTenantContext();
  if (!t) return null;
  const { data, error } = await t.sb
    .from("fee_concession_templates")
    .select("*")
    .eq("tenant_id", t.tenantId)
    .order("name", { ascending: true })
    .limit(1000);
  if (error) return null;
  return (data ?? []).map((r) => fromRow(r as Row));
}

async function getTemplate(id: string): Promise<TemplateRecord | null> {
  const t = await tenant();
  const { data, error } = await t.sb
    .from("fee_concession_templates")
    .select("*")
    .eq("tenant_id", t.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError("server_error", "Could not read the template", 503);
  return data ? fromRow(data as Row) : null;
}

export async function createTemplate(input: TemplateInput, knownHeadIds: Set<string>, by: string): Promise<TemplateRecord> {
  const clean: TemplateInput = {
    ...input,
    name: input.name.trim(),
    value: Math.round(Number(input.value)),
    feeHeadIds: [...new Set(input.feeHeadIds)],
    siblingChildNo: input.ground === "sibling" && input.siblingChildNo ? Math.round(input.siblingChildNo) : null,
    autoApproveMaxPaise: input.autoApproveMaxPaise == null ? null : Math.round(input.autoApproveMaxPaise),
    defaultReason: input.defaultReason.trim().slice(0, 200),
  };
  const problem = templateInputProblem(clean, knownHeadIds);
  if (problem) throw new ApiError("bad_request", problem, 400);
  const t = await tenant();
  const id = newId("cct");
  const { data, error } = await t.sb
    .from("fee_concession_templates")
    .insert({
      id,
      tenant_id: t.tenantId,
      name: clean.name,
      ground: clean.ground,
      mode: clean.mode,
      value: clean.value,
      fee_head_ids: clean.feeHeadIds,
      sibling_child_no: clean.siblingChildNo,
      end_policy: clean.endPolicy,
      auto_approve_max_paise: clean.autoApproveMaxPaise,
      default_reason: clean.defaultReason,
      rule_code: templateRuleCode(id),
      is_active: true,
      created_by: by,
    })
    .select("*")
    .single();
  if (error) throw new ApiError("server_error", `The template was not saved: ${error.message}`, 500);
  return fromRow(data as Row);
}

/** Name, default reason, auto-approve limit, on/off — at the version read. */
export async function updateTemplate(
  id: string,
  patch: { name?: string; defaultReason?: string; autoApproveMaxPaise?: number | null; isActive?: boolean },
  baseUpdatedAt: string,
): Promise<TemplateRecord> {
  const cur = await getTemplate(id);
  if (!cur) throw new ApiError("not_found", "No such template", 404);
  const next = {
    name: patch.name !== undefined ? patch.name.trim() : cur.name,
    default_reason: patch.defaultReason !== undefined ? patch.defaultReason.trim().slice(0, 200) : cur.defaultReason,
    auto_approve_max_paise:
      patch.autoApproveMaxPaise !== undefined
        ? patch.autoApproveMaxPaise == null
          ? null
          : Math.max(0, Math.round(patch.autoApproveMaxPaise))
        : cur.autoApproveMaxPaise,
    is_active: patch.isActive !== undefined ? !!patch.isActive : cur.isActive,
  };
  if (!next.name) throw new ApiError("bad_request", "Give the template a name", 400);
  const t = await tenant();
  const { data, error } = await t.sb
    .from("fee_concession_templates")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("tenant_id", t.tenantId)
    .eq("id", id)
    .eq("updated_at", baseUpdatedAt)
    .select("*");
  if (error) throw new ApiError("server_error", `Not saved: ${error.message}`, 500);
  if (!data || data.length !== 1) {
    throw new ApiError("bad_request", "Someone changed this template a moment ago — reload and try again", 409);
  }
  return fromRow(data[0] as Row);
}

/** What one due of each head the template covers bills this child, from the start month. */
function billedByHeadFor(
  student: Parameters<typeof computeStudentDues>[0],
  masters: Parameters<typeof computeStudentDues>[1],
  fees: Parameters<typeof computeStudentDues>[2],
  fromDate: string,
): Record<string, number> {
  const dues = computeStudentDues(student, masters, fees, {
    asOf: fromDate,
    includeFuture: true,
    includePaid: true,
  });
  // The first due on/after the start month per head; a head with none after
  // it falls back to its last due before (a one-off head billed earlier).
  const after = new Map<string, number>();
  const before = new Map<string, number>();
  const sorted = [...dues]
    .filter((d) => d.feeHeadId && d.billedPaise > 0 && d.kind !== "store")
    .sort((a, b) => (a.dueOn || "").localeCompare(b.dueOn || ""));
  for (const d of sorted) {
    if ((d.dueOn || "") >= fromDate) {
      if (!after.has(d.feeHeadId)) after.set(d.feeHeadId, d.billedPaise);
    } else {
      before.set(d.feeHeadId, d.billedPaise);
    }
  }
  const out: Record<string, number> = {};
  for (const [h, v] of before) out[h] = v;
  for (const [h, v] of after) out[h] = v;
  return out;
}

export type ApplyResult = {
  preview: boolean;
  rows: TemplatePlanRow[];
  granted: number;
  approved: number;
  pending: number;
};

export async function applyTemplate(
  input: { templateId: string; studentIds: string[]; fromMonth: string; reason: string; preview: boolean },
  auth: ApiAuthContext,
): Promise<ApplyResult> {
  const template = await getTemplate(input.templateId);
  if (!template) throw new ApiError("not_found", "No such template", 404);
  const session: DemoSession = auth.session;
  const canGrant = canGrantConcession(session, auth.masters, auth.rbac);
  const canApprove = canApproveConcession(session, auth.masters, auth.rbac);
  const sessionEndOn = academicYearEndOn(session.academicYearCode);
  const fromDate = /^\d{4}-\d{2}$/.test(input.fromMonth) ? `${input.fromMonth}-01` : "";
  const ids = [...new Set(input.studentIds.map((s) => String(s).trim()).filter(Boolean))];

  const feeCtx = await loadFeeContext();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { bundle, readFailed, sliceStamps } = await fetchMastersDeskFromDb();
    if (readFailed || !sliceStamps) {
      throw new ApiError("server_error", "Could not read Masters — nothing was granted. Please try again.", 503);
    }
    if (!sliceStamps.concessionGrants) {
      throw new ApiError("server_error", "Could not find the concession list in Masters — nothing was granted.", 503);
    }
    const state = deskBundleToMastersState(bundle);
    const rules = state.concessions ?? [];
    const sameCode = rules.filter((r) => (r.code || "").toUpperCase() === template.ruleCode.toUpperCase());
    const current = sameCode.find((r) => r.isActive) ?? sameCode[0];
    const ruleId = current?.id ?? newId("cn");
    const wantRule: ConcessionRule = templateToRule(template, ruleId);
    const ruleNeedsWrite = !current || !ruleMatchesTemplate(current, template);

    const students: TemplatePlanStudent[] = [];
    for (const id of ids) {
      const s = feeCtx.sis.students.find((x) => x.id === id);
      if (!s) throw new ApiError("bad_request", "A chosen student is no longer on the roll — reload", 400);
      students.push({
        studentId: s.id,
        studentName: s.fullName,
        billedByHead: fromDate ? billedByHeadFor(s, state, feeCtx.fees, fromDate) : {},
      });
    }

    const plan = planTemplateApplication({
      template,
      students,
      ruleIds: new Set(sameCode.map((r) => r.id)),
      ruleId,
      existingGrants: state.concessionGrants ?? [],
      canGrant,
      canApprove,
      fromMonth: input.fromMonth,
      sessionEndOn,
      reason: input.reason,
      nowIso: new Date().toISOString(),
      newId: () => newId("cg"),
    });
    if (!plan.ok) throw new ApiError("bad_request", plan.error, 400);
    const summary = {
      rows: plan.rows,
      granted: plan.grants.length,
      approved: plan.grants.filter((g) => g.status === "approved").length,
      pending: plan.grants.filter((g) => g.status === "pending").length,
    };
    if (input.preview) return { preview: true, ...summary };
    if (plan.grants.length === 0) throw new ApiError("bad_request", "Nobody to grant — every student chosen was skipped", 400);

    const keys: MastersSliceKey[] = ["concessionGrants"];
    const nextConcessions = ruleNeedsWrite
      ? current
        ? rules.map((r) => (r.id === current.id ? wantRule : r))
        : [...rules, wantRule]
      : rules;
    if (ruleNeedsWrite) keys.push("concessions");
    const pushed = await pushMastersSlicesToDb(
      { ...state, concessions: nextConcessions, concessionGrants: [...(state.concessionGrants ?? []), ...plan.grants] },
      keys,
      Object.fromEntries(keys.map((k) => [k, sliceStamps[k] ?? ""])),
    );
    if (pushed.ok) {
      await writeAudit({
        session,
        module: "fees",
        action: "create",
        entityType: "concession_template_apply",
        entityId: template.id,
        summary: `Template "${template.name}" applied to ${summary.granted} student(s) — ${summary.approved} approved, ${summary.pending} pending`,
        after: { grantIds: plan.grants.map((g) => g.id), ruleCode: template.ruleCode },
      }).catch(() => null);
      return { preview: false, ...summary };
    }
    if (pushed.conflict !== "slice_stale") {
      throw new ApiError("server_error", pushed.error || "Masters could not be saved — nothing was granted.", 500);
    }
  }
  throw new ApiError("bad_request", "Masters kept changing while this was being saved — nothing was granted. Try again.", 409);
}
