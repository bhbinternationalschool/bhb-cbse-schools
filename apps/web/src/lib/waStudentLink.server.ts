/**
 * Linking a student's own WhatsApp number, and answering from it.
 *
 * Consent runs one way: the PARENT asks for a code from their own number
 * and hands it to their child. The code is never sent to the student's
 * number — which is also the only workable design, since Meta's 24-hour
 * window is shut for a number that has never messaged the school, so we
 * could not reach it first even if we wanted to.
 *
 * A linked number is scoped to study help by `studentScopeCheck`, and that
 * scope is enforced HERE, at the entry point, not left to each downstream
 * handler to remember.
 */

import "server-only";

import { createHash, randomInt } from "node:crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { classLabel as classLabelOf } from "@/lib/homework";
import { findHouseholdByWaMobile } from "@/lib/waSisBotServer";
import { toE164India } from "@/lib/waContactState.server";
import { waNormalizeLocal10 } from "@/lib/waSend";
import {
  composeStudentRefusal,
  composeStudentWelcome,
  linkCodeUsable,
  parseStudentLinkCode,
  studentScopeCheck,
  LINK_CODE_TTL_MS,
} from "@/lib/waStudentLinkEngine";

function hashCode(code: string): string {
  return createHash("sha256").update(`wa_student_link:${code}`).digest("hex");
}

export type StudentLink = {
  mobile10: string;
  studentId: string;
  householdId: string;
};

/** The student this number belongs to, or null. */
export async function resolveStudentByMobile(
  mobileRaw: string,
): Promise<StudentLink | null> {
  const mobile10 = waNormalizeLocal10(mobileRaw);
  if (mobile10.length !== 10) return null;
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("wa_student_links")
    .select("mobile_e164, student_id, household_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile_e164", toE164India(mobile10))
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return {
    mobile10,
    studentId: String(data.student_id),
    householdId: String(data.household_id),
  };
}

/** Numbers currently linked for one household — for the parent's menu. */
export async function listStudentLinks(
  householdId: string,
): Promise<{ studentId: string; mobile10: string }[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("wa_student_links")
    .select("student_id, mobile_e164")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .is("revoked_at", null);
  if (error) return [];
  return (data || []).map((r) => ({
    studentId: String(r.student_id),
    mobile10: waNormalizeLocal10(String(r.mobile_e164 || "")),
  }));
}

export type IssueLinkResult =
  | { ok: true; code: string }
  | { ok: false; reason: string };

/**
 * Mint a code for one child's number, on the parent's request.
 *
 * Refuses a number that already belongs to a family: a parent's own
 * handset, or another household's. Those numbers already answer as a
 * parent, and turning one into a study-help-only number would take fees
 * and receipts away from whoever relies on it.
 */
export async function issueStudentLinkCode(opts: {
  householdId: string;
  studentId: string;
  studentMobile10: string;
  requestedByMobile10: string;
}): Promise<IssueLinkResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "The school database is unavailable just now." };

  const mobile10 = waNormalizeLocal10(opts.studentMobile10);
  if (mobile10.length !== 10) {
    return { ok: false, reason: "That is not a 10-digit mobile number." };
  }
  if (mobile10 === waNormalizeLocal10(opts.requestedByMobile10)) {
    return {
      ok: false,
      reason:
        "That is this number. Give the child's own phone number, or keep using study help from here.",
    };
  }

  await ensureSchoolMirrorHydrated().catch(() => false);
  if (findHouseholdByWaMobile(mobile10)) {
    return {
      ok: false,
      reason:
        "That number is already a parent's number on the school record. A parent's number keeps fees and receipts — it cannot be turned into a study-help-only number.",
    };
  }

  const existing = await resolveStudentByMobile(mobile10);
  if (existing && existing.studentId !== opts.studentId) {
    return {
      ok: false,
      reason:
        "That number is already linked to another student. Remove that link first with *UNLINK*.",
    };
  }

  const code = String(randomInt(100000, 999999));
  const { error } = await ctx.sb.from("wa_student_link_codes").insert({
    tenant_id: ctx.tenantId,
    code_hash: hashCode(code),
    student_id: opts.studentId,
    household_id: opts.householdId,
    requested_by_mobile: waNormalizeLocal10(opts.requestedByMobile10),
    expires_at: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[wa-student-link] code insert failed", error.message);
    return { ok: false, reason: "The code could not be created just now. Please try again." };
  }
  return { ok: true, code };
}

export async function revokeStudentLink(opts: {
  householdId: string;
  studentId: string;
  byMobile10: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "The school database is unavailable just now." };
  const { error } = await ctx.sb
    .from("wa_student_links")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_mobile: waNormalizeLocal10(opts.byMobile10),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", opts.householdId)
    .eq("student_id", opts.studentId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Redeem a code from the student's own number.
 *
 * The code is consumed before the link is written, so two phones racing the
 * same code cannot both end up linked.
 */
async function redeemLinkCode(opts: {
  code: string;
  studentMobile10: string;
}): Promise<
  | { ok: true; studentId: string; householdId: string }
  | { ok: false; reason: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "The school database is unavailable just now." };

  const { data, error } = await ctx.sb
    .from("wa_student_link_codes")
    .select("id, student_id, household_id, expires_at, used_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("code_hash", hashCode(opts.code))
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: "That code is not valid. Ask your parent for a new one." };
  }
  const usable = linkCodeUsable({
    expiresAt: String(data.expires_at || ""),
    usedAt: data.used_at ? String(data.used_at) : null,
  });
  if (!usable.ok) return { ok: false, reason: usable.reason || "That code cannot be used." };

  // Consume first: `used_at is null` in the filter makes this the race
  // winner's write, so a second phone with the same code finds nothing.
  const claim = await ctx.sb
    .from("wa_student_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", data.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) {
    return { ok: false, reason: "That code has already been used. Ask your parent for a new one." };
  }

  const mobileE164 = toE164India(opts.studentMobile10);
  const up = await ctx.sb.from("wa_student_links").upsert(
    {
      tenant_id: ctx.tenantId,
      mobile_e164: mobileE164,
      student_id: String(data.student_id),
      household_id: String(data.household_id),
      linked_at: new Date().toISOString(),
      linked_by_mobile: "",
      revoked_at: null,
      revoked_by_mobile: null,
    },
    { onConflict: "tenant_id,mobile_e164" },
  );
  if (up.error) {
    console.error("[wa-student-link] link write failed", up.error.message);
    return { ok: false, reason: "The link could not be saved. Please try the code again." };
  }
  return {
    ok: true,
    studentId: String(data.student_id),
    householdId: String(data.household_id),
  };
}

function studentOf(studentId: string): {
  student: SisStudent | undefined;
  household: Household | undefined;
} {
  const sis = loadSis();
  const student = (sis.students ?? []).find((s) => s.id === studentId);
  const household = student
    ? (sis.households ?? []).find((h) => h.id === student.householdId)
    : undefined;
  return { student, household };
}

export type StudentInboundResult = {
  /** false = not a student number; the normal routing should carry on. */
  handled: boolean;
  replyText: string;
};

/**
 * A message from a number that is not on the family record.
 *
 * Either it carries a link code, or it belongs to an already-linked
 * student. Anything else is not ours, and routing continues untouched — so
 * this cannot shadow an admissions lead or a visitor.
 */
export async function handleWaStudentInbound(opts: {
  fromWaId: string;
  text: string;
}): Promise<StudentInboundResult> {
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  if (mobile10.length !== 10) return { handled: false, replyText: "" };

  const text = (opts.text || "").trim();
  const link = await resolveStudentByMobile(mobile10);

  // Not linked yet: the only thing this number can do is redeem a code.
  if (!link) {
    const code = parseStudentLinkCode(text);
    if (!code) return { handled: false, replyText: "" };
    const redeemed = await redeemLinkCode({ code, studentMobile10: mobile10 });
    if (!redeemed.ok) return { handled: true, replyText: redeemed.reason };
    await ensureSchoolMirrorHydrated().catch(() => false);
    const { student } = studentOf(redeemed.studentId);
    return {
      handled: true,
      replyText: composeStudentWelcome({
        studentName: student?.fullName || "student",
        classLabel: student
          ? classLabelOf(loadMasters(), student.classId, student.sectionId).replace(
              " · ",
              " ",
            )
          : "",
      }),
    };
  }

  await ensureSchoolMirrorHydrated().catch(() => false);
  const { student, household } = studentOf(link.studentId);
  if (!student || student.status !== "active" || !household) {
    // The child left, or the record moved. Say so plainly rather than
    // answering as if nothing changed.
    return {
      handled: true,
      replyText:
        "This number is no longer linked to an enrolled student. Please ask a parent to link it again.",
    };
  }

  // The scope rule, enforced once, here. Downstream handlers never have to
  // remember that this conversation is a child's.
  const scope = studentScopeCheck(text);
  if (!scope.allowed) {
    return { handled: true, replyText: composeStudentRefusal(scope.reason) };
  }

  const { handleWaTutorInbound } = await import("@/lib/waTutorBot.server");
  const tutor = await handleWaTutorInbound({
    household,
    // Pinned to THIS child: a student's number never reaches a sibling's
    // study help, even though the pass and the free allowance are shared
    // with the household exactly as they are in the app.
    children: [student],
    mobile10,
    text,
    // No buying from a child's phone. The tutor's refusal then points at
    // the parent's number rather than offering a payment link.
    canBuy: false,
  });
  if (tutor.handled) return { handled: true, replyText: tutor.replyText };

  // A bare greeting, or something the tutor did not claim: offer the menu
  // rather than silence.
  return {
    handled: true,
    replyText: composeStudentWelcome({
      studentName: student.fullName,
      classLabel: classLabelOf(
        loadMasters(),
        student.classId,
        student.sectionId,
      ).replace(" · ", " "),
    }),
  };
}
