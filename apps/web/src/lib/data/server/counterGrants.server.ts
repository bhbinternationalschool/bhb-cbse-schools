/**
 * The fee counter's concession grants on the server (data-layer 2.2e review
 * fixes; director's decision 27 Oct 2026). POST /api/fees/counter-grants.
 *
 *  grant   the counter's standing ("also apply to future months") grants:
 *          planned on the STORED concessions + grants (planCounterGrants —
 *          "already on file", one discount per head, approval from the
 *          session), written as ONE all-or-none desk_slice_rows_write batch.
 *          For a paid collection the receipt must already be in the database
 *          (fee_desk_vouchers, not voided) — else 409 receipt_pending and
 *          nothing is written: a receipt the database refused never leaves a
 *          running grant behind.
 *  revoke  the grants a voided receipt created — exactly the stored grants
 *          carrying its `[v:<id>]` marker — once the void is in the database.
 *
 * Who: Masters · edit (or the Masters → Concessions function) as before, and
 * — the director's decision — a fees · edit clerk, who may only CREATE
 * counter grants tied to a receipt and REVOKE exactly those on void. The
 * concession catalogue and every other grant still need Masters
 * (POST /api/data/masters.* is unchanged). The giver is the session: written
 * into the grant ("by <name>") and logged.
 */
import "server-only";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { planCounterGrants, type CounterGrantItem } from "@/lib/counterConcession";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import {
  normalizeConcessionGrant,
  normalizeConcessionRule,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
  CONCESSION_GROUNDS,
} from "@/lib/masters";
import { canApproveConcession, featureAccess, hasPermission } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { collectionDef } from "../registry";
import { revokeChangesForVoucher, planMastersElementChanges } from "../mastersElementChanges";
import { readSliceList, writeMastersBatch, type Row } from "./repo";

export type CounterGrantAnswer = { status: number; body: Record<string, unknown> };

const fail = (status: number, kind: string, message: string): CounterGrantAnswer => ({ status, body: { ok: false, kind, message } });

function authority(ctx: ApiAuthContext): { masters: boolean; fees: boolean } {
  const { session, masters, rbac } = ctx;
  const mastersEdit =
    hasPermission(session, masters, "masters", "edit", rbac) ||
    featureAccess(session, masters, "masters.concessions", "create", rbac).allowed;
  const feesEdit = hasPermission(session, masters, "fees", "edit", rbac);
  return { masters: mastersEdit, fees: feesEdit };
}

/** The receipt as stored: absent, live or voided. */
async function voucherState(voucherId: string): Promise<"absent" | "live" | "voided" | "unreadable"> {
  const t = await getServerTenantContext();
  if (!t) return "unreadable";
  const { data, error } = await t.sb
    .from("fee_desk_vouchers")
    .select("id, voided_at")
    .eq("tenant_id", t.tenantId)
    .eq("id", voucherId)
    .maybeSingle();
  if (error) return "unreadable";
  if (!data) return "absent";
  return (data as { voided_at?: string | null }).voided_at ? "voided" : "live";
}

async function storedLists(): Promise<{ concessions: Row[]; grants: Row[] }> {
  const c = collectionDef("masters.concessions")?.slice;
  const g = collectionDef("masters.concession-grants")?.slice;
  if (!c || !g) throw new Error("concession collections missing");
  const [concessions, grants] = await Promise.all([readSliceList(c), readSliceList(g)]);
  return { concessions, grants };
}

function readItems(raw: unknown): CounterGrantItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const out: CounterGrantItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    const paise = Number(o.discountPaise);
    if (!str("studentId") || !str("feeHeadId") || !/^\d{4}-\d{2}-\d{2}$/.test(str("futureEffectiveFrom"))) return null;
    if (!Number.isSafeInteger(paise) || paise <= 0) return null;
    out.push({
      studentId: str("studentId"),
      studentName: str("studentName") || "Student",
      feeHeadId: str("feeHeadId"),
      feeHeadName: str("feeHeadName") || "Fee head",
      discountPaise: paise,
      dueLabel: str("dueLabel"),
      futureEffectiveFrom: str("futureEffectiveFrom"),
    });
  }
  return out;
}

function written(): void {
  clearDeskProbeCache("masters-desk-rows");
  invalidateServerMastersCache();
}

export async function counterGrantsPost(ctx: ApiAuthContext, body: Record<string, unknown>): Promise<CounterGrantAnswer> {
  const who = authority(ctx);
  const action = body.action;
  const voucherId = typeof body.sourceVoucherId === "string" ? body.sourceVoucherId.trim() : typeof body.voucherId === "string" ? body.voucherId.trim() : "";
  const by = ctx.session.fullName || ctx.session.email || "staff";

  if (action === "revoke") {
    if (!who.masters && !who.fees) return fail(403, "auth", "Ending a voided receipt's discount needs Fees · edit.");
    if (!voucherId) return fail(400, "invalid", "voucherId is required");
    const state = await voucherState(voucherId);
    if (state === "unreadable") return fail(503, "unavailable", "Could not read the receipt — nothing was changed.");
    if (state !== "voided") return fail(409, "receipt_pending", "The void of this receipt is not in the database yet.");
    let lists: { concessions: Row[]; grants: Row[] };
    try {
      lists = await storedLists();
    } catch (e) {
      return fail(503, "unavailable", `Could not read the grants — nothing was changed (${e instanceof Error ? e.message : String(e)}).`);
    }
    const receiptNo = typeof body.receiptNo === "string" ? body.receiptNo : voucherId;
    const changes = revokeChangesForVoucher(lists.grants, { id: voucherId, receiptNo }, new Date().toISOString().slice(0, 10));
    if (changes.length === 0) return { status: 200, body: { ok: true, revoked: 0 } };
    const plan = planMastersElementChanges(changes, (k) =>
      new Map((k === "concessionGrants" ? lists.grants : lists.concessions).map((r) => [String(r.id), r])),
    );
    if (!plan.ok) return fail(409, plan.kind, plan.message);
    const res = await writeMastersBatch(plan.ops.map((o) => ({ collection: o.collection, op: o.op })));
    if (!res.ok) return fail(res.kind === "conflict" ? 409 : 503, res.kind, res.message);
    written();
    console.info(`[counter-grants] ${by} (${ctx.session.staffId ?? ""}) revoked ${plan.ops.length} grant(s) of voided receipt ${receiptNo}`);
    return { status: 200, body: { ok: true, revoked: plan.ops.length } };
  }

  if (action !== "grant") return fail(400, "invalid", "action must be grant or revoke");
  if (!who.masters && !who.fees) return fail(403, "auth", "Recording a counter discount needs Fees · edit.");
  // A fees · edit clerk records only grants tied to a receipt (the director's
  // rule); a standing discount with no receipt is a Masters decision.
  if (!voucherId && !who.masters) {
    return fail(403, "auth", "A standing discount without a receipt is set in Masters → Concessions (it needs Masters · edit).");
  }
  const items = readItems(body.items);
  if (!items) return fail(400, "invalid", "items: 1–50 lines, each with a student, a fee head, a discount and a start date");
  const ay = typeof body.academicYearCode === "string" && /^\d{4}-\d{2}$/.test(body.academicYearCode) ? body.academicYearCode : "";
  if (!ay) return fail(400, "invalid", "academicYearCode is required");
  const ground = typeof body.ground === "string" && CONCESSION_GROUNDS.some((g) => g.id === body.ground) ? (body.ground as MastersState["concessionGrants"][number]["ground"]) : "";
  if (!ground) return fail(400, "invalid", "Choose why this discount is being given (the ground).");

  if (voucherId) {
    const state = await voucherState(voucherId);
    if (state === "unreadable") return fail(503, "unavailable", "Could not read the receipt — nothing was recorded.");
    if (state === "absent") return fail(409, "receipt_pending", "The receipt is not in the database yet.");
    if (state === "voided") return fail(409, "receipt_voided", "That receipt was voided — its discount is not recorded.");
  }

  let lists: { concessions: Row[]; grants: Row[] };
  try {
    lists = await storedLists();
  } catch (e) {
    return fail(503, "unavailable", `Could not read the stored concessions — nothing was recorded (${e instanceof Error ? e.message : String(e)}).`);
  }
  const concessions = lists.concessions.map((r) => normalizeConcessionRule(r as unknown as Partial<ConcessionRule> & { id: string }));
  const grants = lists.grants.map((r) => normalizeConcessionGrant(r as unknown as Partial<ConcessionGrant> & { id: string }));
  const stored: MastersState = { ...ctx.masters, concessions, concessionGrants: grants };
  const plan = planCounterGrants(stored, {
    items,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : "",
    academicYearCode: ay,
    ground,
    sourceVoucherId: voucherId || undefined,
    sourceReceiptNo: typeof body.sourceReceiptNo === "string" ? body.sourceReceiptNo.slice(0, 60) : undefined,
    canApprove: canApproveConcession(ctx.session, ctx.masters, ctx.rbac),
    by,
    nowIso: new Date().toISOString(),
  });
  const ops = [
    ...plan.newRules.map((r) => ({ collection: "masters.concessions", op: { op: "upsert" as const, id: r.id, base: null, row: r as unknown as Row } })),
    ...plan.newGrants.map((g) => ({ collection: "masters.concession-grants", op: { op: "upsert" as const, id: g.id, base: null, row: g as unknown as Row } })),
  ];
  const summary = { granted: plan.granted, skipped: plan.skipped, pending: plan.pending, ruleLabels: plan.ruleLabels, blocked: plan.blocked };
  if (plan.newGrants.length === 0) return { status: 200, body: { ok: true, ...summary } };
  const res = await writeMastersBatch(ops);
  if (!res.ok) {
    // Another counter wrote the same id a moment ago: the caller asks again and
    // this plan then finds that grant on file.
    return fail(res.kind === "conflict" ? 409 : 503, res.kind, res.kind === "conflict" ? "Another counter recorded a discount on this head a moment ago — nothing was recorded." : res.message);
  }
  written();
  console.info(
    `[counter-grants] ${by} (${ctx.session.staffId ?? ""}) recorded ${plan.newGrants.length} grant(s)` +
      (voucherId ? ` for receipt ${String(body.sourceReceiptNo ?? voucherId)}` : " (no receipt)") +
      `: ${plan.newGrants.map((g) => `${g.id} ${g.status}`).join(", ")}`,
  );
  return { status: 200, body: { ok: true, ...summary } };
}
