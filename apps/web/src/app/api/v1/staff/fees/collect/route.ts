import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { canBackdateReceipt } from "@/lib/rbac";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  assertFeeBookComplete,
  classLabelOf,
  householdContact,
  loadFeeContext,
  openDuesFor,
} from "@/lib/api/v1/staffFees";
import {
  TENDER_MODES,
  collectPayment,
  formatInr,
  loadFees,
  type TenderMode,
  type VoucherLine,
  type VoucherTender,
} from "@/lib/fees";
import { pushFeesRemoteServer } from "@/lib/feesPersistence.server";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

type Body = {
  studentId?: string;
  /** Which dues to settle, and how much of each (paise). */
  lines?: { studentId: string; dueKey: string; amountPaise: number }[];
  tenders?: {
    mode?: string;
    amountPaise?: number;
    ref?: string;
    instrumentDate?: string;
    bankName?: string;
  }[];
  note?: string;
  /**
   * The day the money was actually handed over, YYYY-MM-DD.
   *
   * Absent means today, which is what this route used to hard-code with no
   * way to say otherwise — so cash taken on Saturday could not be recorded
   * as Saturday. Whether a past date is accepted is the school's Masters
   * setting, decided by the server, never by the app.
   */
  collectionDate?: string;
  /** Idempotency key minted by the app; a retry with the same one is a no-op. */
  clientRef?: string;
};

const MODE_VALUES = new Set(TENDER_MODES.map((m) => m.value));

/**
 * POST /api/v1/staff/fees/collect — take money at the phone and issue a
 * receipt.
 *
 * Three guards the counter needs and a browser page gets for free:
 *   1. Amounts are re-derived from the server's open dues. A line may pay
 *      part of a due but never more than it, whatever the app posted.
 *   2. `clientRef` is stamped on the voucher as its transaction id, so a
 *      retry over a dropped connection returns the first receipt instead of
 *      charging the family twice.
 *   3. Cheques are recorded subject to clearance, exactly as the desk does.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_take");
    assertPermission(ctx, "fees", "create");

    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId || "").trim();
    const clientRef = (body.clientRef || "").trim().slice(0, 60);
    const wanted = Array.isArray(body.lines) ? body.lines : [];
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!wanted.length) throw new ApiError("bad_request", "Select at least one due", 400);
    if (!clientRef) throw new ApiError("bad_request", "clientRef required", 400);

    const { sis, fees, masters } = await loadFeeContext();
    await assertFeeBookComplete(fees);
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    const householdId = student.householdId;
    if (!householdId) {
      throw new ApiError("bad_request", "This student has no household on record", 400);
    }

    // Idempotency — a retry must not become a second receipt.
    const already = fees.vouchers.find(
      (v) => !v.voidedAt && (v.transactionId || "") === clientRef,
    );
    if (already) {
      return apiOk({
        duplicate: true,
        voucherId: already.id,
        receiptNo: already.receiptNo,
        totalPaise: already.totalPaise,
        totalLabel: formatInr(already.totalPaise),
        collectionDate: already.collectionDate,
      });
    }

    // Re-derive what is actually open, per child of this household.
    const ay = ctx.session.academicYearCode;
    const openByKey = new Map<string, { label: string; kind: string; balancePaise: number; studentName: string }>();
    for (const s of sis.students) {
      if (s.householdId !== householdId || s.status !== "active" || s.academicYearCode !== ay) {
        continue;
      }
      for (const d of openDuesFor(s, masters, fees)) {
        openByKey.set(`${s.id}|${d.dueKey}`, {
          label: d.label,
          kind: d.kind,
          balancePaise: d.balancePaise,
          studentName: s.fullName,
        });
      }
    }

    const lines: VoucherLine[] = [];
    for (const l of wanted) {
      const key = `${(l.studentId || studentId).trim()}|${(l.dueKey || "").trim()}`;
      const open = openByKey.get(key);
      if (!open) {
        throw new ApiError(
          "bad_request",
          `That due is no longer open — reload the counter and try again`,
          409,
        );
      }
      const asked = Math.round(Number(l.amountPaise) || 0);
      if (asked <= 0) continue;
      if (asked > open.balancePaise) {
        throw new ApiError(
          "bad_request",
          `${open.label}: ${formatInr(asked)} is more than the ${formatInr(open.balancePaise)} outstanding`,
          400,
        );
      }
      lines.push({
        dueKey: (l.dueKey || "").trim(),
        studentId: (l.studentId || studentId).trim(),
        studentName: open.studentName,
        label: open.label,
        kind: open.kind as VoucherLine["kind"],
        amountPaise: asked,
      });
    }
    if (!lines.length) throw new ApiError("bad_request", "Nothing to collect", 400);
    const total = lines.reduce((n, l) => n + l.amountPaise, 0);

    const tenders: VoucherTender[] = [];
    for (const t of body.tenders ?? []) {
      const amountPaise = Math.round(Number(t.amountPaise) || 0);
      if (amountPaise <= 0) continue;
      const mode = (t.mode || "cash").trim() as TenderMode;
      if (!MODE_VALUES.has(mode)) {
        throw new ApiError("bad_request", `Unknown payment mode ${mode}`, 400);
      }
      tenders.push({
        mode,
        amountPaise,
        ref: (t.ref || "").trim(),
        instrumentDate: (t.instrumentDate || "").trim(),
        bankName: (t.bankName || "").trim(),
        realisation: mode === "cheque" ? "subject_to_clearance" : "cleared",
      });
    }
    if (!tenders.length) {
      tenders.push({
        mode: "cash",
        amountPaise: total,
        ref: "",
        instrumentDate: "",
        bankName: "",
        realisation: "cleared",
      });
    }
    const tendered = tenders.reduce((n, t) => n + t.amountPaise, 0);
    if (tendered !== total) {
      throw new ApiError(
        "bad_request",
        `Payment (${formatInr(tendered)}) must equal the ${formatInr(total)} being settled`,
        400,
      );
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const collectionDate = (body.collectionDate || "").trim() || today;

    // The school's setting and this person's authority are resolved HERE.
    // The app sends a date and nothing else; it cannot tell the server that
    // it is allowed to use it.
    const mayBackdate = canBackdateReceipt(ctx.session, masters);

    const result = collectPayment({
      householdId,
      lines,
      tenders,
      cashierName: ctx.session.fullName || "Staff",
      note: (body.note || "").trim().slice(0, 200),
      academicYearCode: ay,
      collectionDate,
      transactionDate: collectionDate,
      backdatePolicy: masters?.feeBackdatePolicy,
      mayBackdate,
      todayIsoOverride: today,
      transactionId: clientRef,
      source: "counter",
      receiptSeries: "F",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const pushed = await pushFeesRemoteServer(loadFees());
    if (!pushed.ok) {
      console.warn("[staff-fees-v1] desk push failed", pushed.error);
      throw new ApiError(
        "server_error",
        "The receipt was made but could not be saved — check Fees on the desk before collecting again",
        503,
      );
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "fees",
      action: "create",
      entityType: "collection_voucher",
      entityId: result.voucher.id,
      summary: `Receipt ${result.voucher.receiptNo} · ${formatInr(total)} from ${householdContact(sis, householdId).guardianName} (mobile app)`,
      after: {
        receiptNo: result.voucher.receiptNo,
        totalPaise: total,
        modes: tenders.map((t) => t.mode),
        lines: lines.length,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    await sendPushToSubject("parent", householdId, {
      title: `Fee received · ${formatInr(total)}`,
      body: `Receipt ${result.voucher.receiptNo} for ${student.fullName} (${classLabelOf(ctx, student)}). Thank you.`,
      url: "/fees",
      data: { kind: "fee_receipt", receiptNo: result.voucher.receiptNo },
    }).catch(() => undefined);

    return apiOk({
      duplicate: false,
      voucherId: result.voucher.id,
      receiptNo: result.voucher.receiptNo,
      collectionDate: result.voucher.collectionDate,
      totalPaise: total,
      totalLabel: formatInr(total),
      guardianName: householdContact(sis, householdId).guardianName,
      lines: lines.map((l) => ({
        label: l.label,
        studentName: l.studentName,
        amountLabel: formatInr(l.amountPaise),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
