import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { writeAudit } from "@/lib/audit.server";
import { cashfreeKeysPresent } from "@/lib/cashfree.server";
import {
  AUTOPAY_UPI_CAP_PAISE,
  clampMaxPaise,
  isTerminalMandate,
  mandateIsLive,
  mandateStatusLabel,
} from "@/lib/feeAutopay";
import {
  autopayPageUrl,
  cancelMandate,
  createMandate,
  listCharges,
  listMandates,
  loadAutopaySettings,
  syncMandate,
  type AutopayMandate,
} from "@/lib/feeAutopay.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fee auto-pay, from the parent app (1.0.14+).
 *
 * GET                          this family's auto-pay, if any, and whether the
 *                              school offers it at all
 * POST {action:"start", maxPaise?}  a mandate for this family; the app opens
 *                              `approveUrl`, the school's own approval page
 * POST {action:"refresh"}      re-read the mandate from Cashfree (on return)
 * POST {action:"stop"}         the parent stops their own auto-pay
 *
 * Offered only while the school has auto-pay turned on: the office decides
 * when the school is ready to take money this way, not the app. A family the
 * office already set up still SEES its mandate while it is off, so a parent
 * can always find and stop a permission they gave.
 *
 * The household comes from the session, never the body — a parent can only
 * ever start, read or stop their own family's mandate.
 */

async function familyMandate(householdId: string): Promise<AutopayMandate | null> {
  const mine = (await listMandates()).filter((m) => m.householdId === householdId);
  return mine.find((m) => mandateIsLive(m.status)) ?? null;
}

function view(m: AutopayMandate | null, origin: string) {
  if (!m) return null;
  const status = m.status.toUpperCase();
  return {
    subscriptionId: m.subscriptionId,
    status,
    statusLabel: mandateStatusLabel(status),
    maxPaise: m.maxPaise,
    active: status === "ACTIVE",
    // Still waiting for the parent: the app offers to open the approval page.
    needsApproval: status === "INITIALIZED",
    approveUrl: autopayPageUrl(origin, m.subscriptionId),
    activatedAt: m.activatedAt,
  };
}

async function snapshot(householdId: string) {
  const origin = publicAppOrigin();
  const [settings, mandate, charges] = await Promise.all([
    loadAutopaySettings(),
    familyMandate(householdId),
    listCharges(200),
  ]);
  const last = charges.find((c) => c.householdId === householdId) ?? null;
  return {
    offered: settings.enabled && cashfreeKeysPresent(),
    chargeDay: settings.chargeDay,
    defaultMaxPaise: settings.defaultMaxPaise,
    upiCapPaise: AUTOPAY_UPI_CAP_PAISE,
    mandate: view(mandate, origin),
    lastDebit: last
      ? {
          amountPaise: last.amountPaise,
          status: last.status,
          debitDate: last.debitDate,
          receiptNos: last.receiptNos,
        }
      : null,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    return apiOk(await snapshot(householdId));
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as { action?: string; maxPaise?: number };
    const action = String(body.action || "");
    const meta = requestMeta(request);
    const who = ctx.session.fullName || "Parent app";

    switch (action) {
      case "start": {
        const settings = await loadAutopaySettings();
        if (!settings.enabled || !cashfreeKeysPresent()) {
          throw new ApiError("conflict", "Auto-pay is not open yet. Please ask the school office.", 409);
        }
        const maxPaise = clampMaxPaise(body.maxPaise ?? settings.defaultMaxPaise);
        const created = await createMandate({
          householdId,
          maxPaise,
          createdBy: `${who} (parent app)`,
          origin: publicAppOrigin(),
        });
        if (!created.ok) throw new ApiError("bad_request", created.error, 400);
        if (!created.reused) {
          await writeAudit({
            module: "fees",
            action: "autopay.start",
            entityId: created.mandate.subscriptionId,
            summary: `Parent set up fee auto-pay up to ₹${Math.round(created.mandate.maxPaise / 100)} a month · ${householdId}`,
            session: ctx.session,
            entityType: "fee_autopay_mandate",
            ...meta,
          });
        }
        return apiOk({ ...(await snapshot(householdId)), approveUrl: created.link });
      }
      case "refresh": {
        const m = await familyMandate(householdId);
        if (m && !isTerminalMandate(m.status)) await syncMandate(m.subscriptionId);
        return apiOk(await snapshot(householdId));
      }
      case "stop": {
        const m = await familyMandate(householdId);
        if (!m) throw new ApiError("not_found", "There is no auto-pay to stop.", 404);
        const r = await cancelMandate(m.subscriptionId);
        if (!r.ok) throw new ApiError("bad_request", r.error, 400);
        await writeAudit({
          module: "fees",
          action: "autopay.stop",
          entityId: m.subscriptionId,
          summary: `Parent stopped fee auto-pay · ${householdId}`,
          session: ctx.session,
          entityType: "fee_autopay_mandate",
          ...meta,
        });
        return apiOk(await snapshot(householdId));
      }
      default:
        throw new ApiError("bad_request", "Unknown action", 400);
    }
  } catch (e) {
    return apiErr(e);
  }
}
