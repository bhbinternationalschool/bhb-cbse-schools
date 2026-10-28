/**
 * The staff app's contact actions on ONE student's family — who may, which
 * family, and the WhatsApp send. Routes: /api/v1/staff/student-contact and
 * /api/v1/staff/student-contact/message. Pure parts in lib/studentContact.
 */
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertSectionScope, sectionKey, type StaffScope } from "@/lib/api/v1/staffScope";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { isInQuietHours, quietHoursLabel, waTemplateLanguageFor } from "@/lib/householdPrefs";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { fetchServerBlob } from "@/lib/serverBlob";
import { loadSisForStaff, studentsInSession, type Household, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { realMobile10, renderTemplateText } from "@/lib/studentContact";
import { TENANT } from "@/lib/types";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { sendWaWithFailover } from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";

export type StudentContactContext = {
  student: SisStudent;
  household: Household | null;
  scope: StaffScope;
  classLabel: string;
  /** Class teacher of the child's section, or the office / leadership. */
  isClassTeacher: boolean;
};

/**
 * The child, their family, and the caller's standing — 403 unless the
 * caller teaches (or leads) the child's section this session.
 */
export async function loadStudentContact(ctx: ApiAuthContext, studentId: string): Promise<StudentContactContext> {
  const id = (studentId || "").trim();
  if (!id) throw new ApiError("bad_request", "studentId required", 400);
  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  const sis = loadSisForStaff();
  const ay = ctx.session.academicYearCode || "";
  const student = (ay ? studentsInSession(sis, ay) : sis.students).find((s) => s.id === id && s.status === "active");
  if (!student) throw new ApiError("not_found", "This child is not on this session's roll", 404);
  const scope = await assertSectionScope(ctx, student.classId, student.sectionId);
  const household = sis.households.find((h) => h.id === student.householdId) || null;
  const cls = ctx.masters.classes.find((c) => c.id === student.classId)?.name || "";
  const sec = ctx.masters.sections.find((s) => s.id === student.sectionId)?.name || "";
  return {
    student,
    household,
    scope,
    classLabel: `${cls} ${sec}`.trim(),
    isClassTeacher: scope.unrestricted || scope.classTeacherOf.has(sectionKey(student.classId, student.sectionId)),
  };
}

export const STUDENT_MESSAGE_FAMILY = "comms_notice";

export type StudentNoticeResult =
  | { kind: "preview"; preview: string; language: string; to: string }
  | { kind: "sent"; to: string; language: string }
  | { kind: "held"; reason: string };

/**
 * One family's WhatsApp, from the school number, inside the approved
 * "School notice" template in the family's own language. A dry run returns
 * the exact text the family will read and sends nothing.
 */
export async function sendStudentNotice(input: {
  household: Household;
  mobile: string;
  title: string;
  body: string;
  dryRun: boolean;
}): Promise<StudentNoticeResult> {
  const { household, mobile } = input;
  const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  if (!raw) throw new ApiError("server_error", "WhatsApp templates could not be read just now — nothing was sent", 503);
  const state = normalizeWaTemplatesState(raw);
  const language = waTemplateLanguageFor(household);
  const resolved = resolveTemplateForSend({ state, familyKey: STUDENT_MESSAGE_FAMILY, language });
  if (!resolved.ok) throw new ApiError("bad_request", resolved.reason, 400);
  const values = { schoolName: TENANT.name, noticeTitle: input.title, noticeBody: input.body };
  const t = resolved.template;
  const preview = [t.headerText ? `*${renderTemplateText(t.headerText, values)}*` : "", renderTemplateText(t.body, values), t.footer || ""]
    .filter(Boolean)
    .join("\n\n");

  if (input.dryRun) return { kind: "preview", preview, language, to: mobile };

  const optedOut = await listOptedOutSet([mobile]).catch(() => null);
  if (!optedOut) throw new ApiError("server_error", "Could not check whether this family stopped school messages — nothing was sent", 503);
  if (optedOut.has(toE164India(mobile))) {
    return { kind: "held", reason: "This family has stopped the school's WhatsApp messages (they replied STOP). Call them instead." };
  }
  if (isInQuietHours(household)) {
    return { kind: "held", reason: `Not sent — it is the family's quiet hours (${quietHoursLabel(household)}). Send it again after that.` };
  }

  const variables = templateVariablePositions(t, values);
  const r = await sendWaWithFailover({
    primaryMobile: mobile,
    fallbackMobile: realMobile10(household.altMobile) || undefined,
    template: {
      name: t.metaName,
      language: t.metaLanguage || t.language,
      components: [
        {
          type: "body" as const,
          parameters: Object.keys(variables)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => ({ type: "text" as const, text: variables[k]! })),
        },
      ],
    },
    fromPhoneNumberId: resolved.sender?.phoneNumberId,
  });
  await logHouseholdWaSend({
    mobile,
    purpose: "staff_student_message",
    via: "template",
    templateName: t.metaName,
    preview: input.body.slice(0, 200),
    status: r.ok ? "sent" : "failed",
    error: r.error,
    waMessageId: r.providerId,
  }).catch(() => undefined);
  if (!r.ok) {
    throw new ApiError("server_error", r.error || "The school's WhatsApp could not send this — nothing was sent", 502);
  }
  return { kind: "sent", to: mobile, language };
}
