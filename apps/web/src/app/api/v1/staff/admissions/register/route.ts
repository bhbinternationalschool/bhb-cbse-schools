import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import {
  applyRegistrationToLead,
  createRegistrationFromDesk,
  loadAdmissions,
  registrationBalancePaise,
  registrationFeeHeads,
  takeRegistrationPayment,
  type AdmissionsState,
  type RegistrationFeePayment,
} from "@/lib/admissions";
import { istToday } from "@/lib/api/v1/staffFees";
import {
  assertAdmissionsGrant,
  saveAdmissionsFromStaffApp,
} from "@/lib/api/v1/staffAdmissions.server";
import {
  isRegisteredStage,
  parseRegistrationRequest,
  sameChildOnFile,
} from "@/lib/staffAdmissionsApp";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

type Body = {
  /** Register this existing lead. Absent = a new child (fields below). */
  leadId?: string;
  childName?: string;
  classSoughtId?: string;
  guardianName?: string;
  motherName?: string;
  mobile?: string;
  feeHeadId?: string;
  feeAmountRupees?: number | string;
  collect?: { amountRupees?: number | string; mode?: string; ref?: string } | null;
};

/**
 * POST /api/v1/staff/admissions/register — "New registration" from the phone.
 *
 * The web's Registration desk, not a copy of it:
 *   - an existing lead goes through applyRegistrationToLead, a new child
 *     through createRegistrationFromDesk — the two functions the desk and
 *     the parent's registration link use;
 *   - money handed over now goes through takeRegistrationPayment, the desk's
 *     own collect, so it gets the next RF- number in the same book and posts
 *     to the student's Fee Take ledger (R-series receipt) when the child is
 *     sent to SIS, exactly as a desk collection does. There is no second
 *     receipt book on the phone.
 *
 * Registration and payment are worked out together and saved once: a payment
 * that fails its checks leaves nothing registered behind it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");

    const body = (await request.json().catch(() => ({}))) as Body;
    const leadId = (body.leadId || "").trim();

    // Registering moves a lead to Registered (leads: change); a new child is
    // also a new lead (leads: add). Taking money is the registration-fee
    // function's own grant.
    assertAdmissionsGrant(ctx, "admissions.leads", "edit");
    if (!leadId) assertAdmissionsGrant(ctx, "admissions.leads", "create");

    const heads = registrationFeeHeads(ctx.masters);
    const parsed = parseRegistrationRequest(
      body as Record<string, unknown>,
      heads.map((h) => h.id),
    );
    if (!parsed.ok) throw new ApiError("bad_request", parsed.reason, 400);
    const reg = parsed.value;
    if (reg.collect) assertAdmissionsGrant(ctx, "admissions.registration", "create");
    const feeHeadName = heads.find((h) => h.id === reg.feeHeadId)?.name || "Registration fee";

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    let state: AdmissionsState = loadAdmissions();
    const by = ctx.session.fullName || "Counsellor";

    let targetId = leadId;
    if (leadId) {
      const lead = state.leads.find((l) => l.id === leadId);
      if (!lead) throw new ApiError("not_found", "Lead not found", 404);
      if (lead.stage === "lost") {
        throw new ApiError("bad_request", "This lead is marked lost — reopen it on the web first", 400);
      }
      if (isRegisteredStage(lead.stage) || lead.stage === "enrolled") {
        // A second registration would overwrite the fee under money already
        // taken against it. The desk handles changes to a registered fee.
        throw new ApiError(
          "conflict",
          `${lead.childName} is already ${lead.stage === "enrolled" ? "admitted" : "registered"}${lead.applicationNo ? ` (${lead.applicationNo})` : ""}`,
          409,
        );
      }
      const r = applyRegistrationToLead(state, leadId, {
        feeHeadId: reg.feeHeadId,
        feeHeadName,
        feeAmountPaise: reg.feeAmountPaise,
        motherName: (body.motherName || "").trim().slice(0, 120) || undefined,
      });
      if (!r.ok) throw new ApiError("bad_request", r.reason, 400);
      state = r.state;
    } else {
      const childName = (body.childName || "").trim().slice(0, 120);
      const guardianName = (body.guardianName || "").trim().slice(0, 120);
      const mobile = (body.mobile || "").replace(/\D/g, "").slice(-10);
      const classSoughtId = (body.classSoughtId || "").trim();
      if (!classSoughtId) throw new ApiError("bad_request", "Class sought is required", 400);
      if (!ctx.masters.classes.some((c) => c.id === classSoughtId)) {
        throw new ApiError("bad_request", "Unknown class", 400);
      }
      const onFile = sameChildOnFile(state, mobile, childName);
      if (onFile) {
        throw new ApiError(
          "conflict",
          `${onFile.childName} is already on file for this mobile (${onFile.enquiryNo}) — register that lead instead of adding a second one`,
          409,
        );
      }
      const r = createRegistrationFromDesk(
        state,
        {
          childName,
          guardianName,
          motherName: (body.motherName || "").trim().slice(0, 120),
          mobile,
          classSoughtId,
          source: "walk_in",
          assignedTo: by,
          feeHeadId: reg.feeHeadId,
          feeHeadName,
          feeAmountPaise: reg.feeAmountPaise,
        },
        by,
      );
      if (!r.ok) throw new ApiError("bad_request", r.reason, 400);
      state = r.state;
      targetId = r.lead.id;
    }

    let payment: RegistrationFeePayment | null = null;
    if (reg.collect) {
      const lead = state.leads.find((l) => l.id === targetId);
      if (lead?.studentId) {
        // Already in SIS: the money belongs on Fee Take, whose receipt the
        // web posts. Never a registration row the ledger does not see.
        throw new ApiError("bad_request", "This child is already in SIS — collect the fee on Fee Take", 400);
      }
      const today = istToday();
      const p = takeRegistrationPayment(state, targetId, by, {
        amountPaise: reg.collect.amountPaise,
        paidOn: today,
        feeHeadName,
        tenders: [
          {
            mode: reg.collect.mode,
            amountPaise: reg.collect.amountPaise,
            ref: reg.collect.ref,
            instrumentDate: today,
          },
        ],
      });
      if (!p.ok) throw new ApiError("bad_request", p.reason, 400);
      state = p.state;
      payment = p.payment;
    }

    await saveAdmissionsFromStaffApp(state, "registration");

    const lead = state.leads.find((l) => l.id === targetId)!;
    const balancePaise = registrationBalancePaise(state, lead);
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: leadId ? "edit" : "create",
      entityType: "registration",
      entityId: targetId,
      summary:
        `Registered ${lead.childName} (${lead.applicationNo || lead.enquiryNo}) from the staff app — ` +
        `fee ₹${reg.feeAmountPaise / 100}` +
        (payment ? ` · received ₹${payment.amountPaise / 100} ${payment.mode} as ${payment.code}` : " · nothing received yet"),
      after: {
        feeHeadId: reg.feeHeadId,
        feeAmountPaise: reg.feeAmountPaise,
        paymentCode: payment?.code || "",
        paymentMode: payment?.mode || "",
        paymentRef: payment?.upiRef || "",
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      leadId: targetId,
      enquiryNo: lead.enquiryNo,
      applicationNo: lead.applicationNo,
      feeRupees: reg.feeAmountPaise / 100,
      balanceRupees: balancePaise / 100,
      payment: payment
        ? {
            code: payment.code,
            amountRupees: payment.amountPaise / 100,
            mode: payment.mode,
            // The R-series Fee Take receipt is posted when the child is sent
            // to SIS, as on the web desk; until then the RF code is the record.
            feeReceiptNo: payment.feeReceiptNo || "",
          }
        : null,
    });
  } catch (e) {
    return apiErr(e);
  }
}
