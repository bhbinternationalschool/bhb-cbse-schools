import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSisForStaff, type StudentDocKey } from "@/lib/sis";
import { updateStudentDocsInDb } from "@/lib/sisProfile.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { documentReviewed } from "@/lib/notify/events";
import { notify } from "@/lib/notify/notify.server";
import { DOC_LABELS } from "@/lib/api/v1/studentDocs";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { aadhaarChecksumValid, aadhaarDigits } from "@/lib/aadhaar";
import { householdChildren, saveFamilyAadhaar, type AadhaarSaveOutcome } from "@/lib/appPopups.server";
import { documentProxyUrl } from "@/lib/documentsRouting";
import {
  applyDocTypePlan,
  filedEntryFor,
  findDocType,
  planDocType,
  type StudentDocTypeDef,
  type StudentDocTypesState,
} from "@/lib/studentDocTypes";
import { readStudentDocTypes, writeStudentDocTypes } from "@/lib/studentDocTypes.server";

export const runtime = "nodejs";

type Body = {
  studentId?: string;
  key?: string;
  verdict?: "verified" | "rejected";
  note?: string;
  /**
   * What the document IS (lib/studentDocTypes), chosen while verifying
   * (request mr_mv9z5lg1jlih). Absent from older app builds — the document
   * is then verified in the slot it was uploaded to, as before.
   */
  typeId?: string;
  /** For an Aadhaar type: the 12 digits read off the card (optional). */
  aadhaarNumber?: string;
};

/**
 * POST /api/v1/staff/documents/review — class teacher / office verifies or
 * rejects one parent-uploaded document. The parent's app shows the result
 * on the child's profile and gets a push.
 *
 * With `typeId` (20 Oct 2026) the verifier says what the document is, and
 * a verified document goes where the record keeps that kind: the child's
 * own slot (moved there if the parent picked the wrong one — never over
 * another document), or — a parent's Aadhaar, a custom type — the school's
 * filed list, with the 12 digits (when typed) onto the parent's Aadhaar
 * field of every child of the family, exactly as the WhatsApp intake and
 * the parent app store them.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertMobileFeature(ctx, "documents_verify");
    assertPermission(ctx, "students", "approve");
    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId || "").trim();
    const key = (body.key || "").trim() as StudentDocKey;
    const verdict = body.verdict === "rejected" ? "rejected" : body.verdict === "verified" ? "verified" : "";
    const note = (body.note || "").trim().slice(0, 300);
    if (!studentId || !key) throw new ApiError("bad_request", "studentId and key required", 400);
    if (!verdict) throw new ApiError("bad_request", "verdict must be verified or rejected", 400);
    if (!(key in DOC_LABELS)) throw new ApiError("bad_request", "Unknown document", 400);
    if (verdict === "rejected" && !note) {
      throw new ApiError("bad_request", "Say why it was rejected so the parent can fix it", 400);
    }

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSisForStaff();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (!scopeAllows(scope, student.classId, student.sectionId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }
    const doc = student.docs?.[key];
    if (!doc || doc.status === "missing") {
      throw new ApiError("bad_request", "Nothing has been uploaded for this document", 400);
    }

    const now = new Date().toISOString();
    const reviewedBy = ctx.session.fullName || "Teacher";
    const typeId = verdict === "verified" ? (body.typeId || "").trim() : "";
    const typedAadhaar = (body.aadhaarNumber || "").replace(/\D/g, "");

    let docs: typeof student.docs;
    let label: string = DOC_LABELS[key];
    let type: StudentDocTypeDef | null = null;
    let typesState: StudentDocTypesState | null = null;
    let filedId = "";
    if (!typeId) {
      if (typedAadhaar) throw new ApiError("bad_request", "Choose the document type before typing an Aadhaar number", 400);
      docs = {
        ...student.docs,
        [key]: {
          ...doc,
          status: verdict,
          reviewedBy,
          reviewedAt: now,
          reviewNote: note,
        },
      };
    } else {
      typesState = await readStudentDocTypes();
      type = findDocType(typesState, typeId) ?? null;
      if (!type) {
        throw typesState
          ? new ApiError("bad_request", "Unknown document type — pick one from the list", 400)
          : new ApiError("server_error", "The school's document types could not be read just now — try again", 503);
      }
      if (doc.status !== "pending") throw new ApiError("bad_request", "This document was already reviewed", 409);
      if (typedAadhaar) {
        if (!type.aadhaarOf) throw new ApiError("bad_request", `${type.label} is not an Aadhaar card — leave the number empty`, 400);
        if (!aadhaarDigits(typedAadhaar) || !aadhaarChecksumValid(typedAadhaar)) {
          throw new ApiError("bad_request", "That Aadhaar number is not valid — check the 12 digits on the card", 400);
        }
      }
      const planned = planDocType({ fromSlot: key, type, docs: student.docs });
      if (!planned.ok) throw new ApiError("conflict", planned.error, 409);
      label = type.label;
      docs = applyDocTypePlan({
        docs: student.docs,
        plan: planned.plan,
        type,
        reviewedBy,
        reviewedAt: now,
        note,
        proxyUrl: (slot) => documentProxyUrl("student", student.id, slot),
      });
      if (planned.plan.kind === "file_off_slot") {
        // The file leaves the child's slot, so it must be on the filed list
        // BEFORE the slot is emptied — never a moment with no record of it.
        if (!typesState) throw new ApiError("server_error", "The school's document list could not be read just now — try again", 503);
        filedId = `sdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const entry = filedEntryFor({
          id: filedId,
          studentId: student.id,
          householdId: student.householdId || "",
          fromSlot: key,
          doc,
          type,
          verifiedBy: reviewedBy,
          verifiedAt: now,
          note,
        });
        typesState = { ...typesState, filed: [...typesState.filed, entry] };
        if (!(await writeStudentDocTypes(typesState))) {
          throw new ApiError("server_error", "Could not save — try again", 503);
        }
      }
    }

    const written = await updateStudentDocsInDb(student.id, docs);
    if (!written.ok) {
      console.warn("[staff-docs-v1] write failed", written.error);
      if (filedId && typesState) {
        await writeStudentDocTypes({ ...typesState, filed: typesState.filed.filter((f) => f.id !== filedId) }).catch(() => false);
      }
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    // The Aadhaar number, where the record keeps it (the parent's onto every
    // child of the family). After the documents write, so its read of the
    // row carries the new version.
    let aadhaar: { saved: boolean; outcome: AadhaarSaveOutcome | null; error: string } | null = null;
    if (type?.aadhaarOf && typedAadhaar) {
      const children = student.householdId
        ? await householdChildren(student.householdId, ctx.session.academicYearCode || "")
        : [];
      const list = children.some((c) => c.id === student.id) ? children : [...children, student];
      const k = type.aadhaarOf === "child" ? student.id : type.aadhaarOf;
      const r = await saveFamilyAadhaar(list, { [k]: typedAadhaar }, reviewedBy, `${reviewedBy} (staff app, read off the verified card)`);
      aadhaar = r.ok
        ? { saved: true, outcome: r.outcomes.find((o) => o.key === k) ?? null, error: "" }
        : { saved: false, outcome: null, error: r.error };
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "approve",
      entityType: "student_document",
      entityId: `${student.id}:${key}`,
      summary:
        `${label} ${verdict} for ${student.fullName}` +
        (type && type.slot !== key ? ` (uploaded as ${DOC_LABELS[key]}${type.slot ? `, moved to ${DOC_LABELS[type.slot]}` : ", filed off the child's documents"})` : "") +
        (aadhaar ? (aadhaar.saved ? ` · Aadhaar ${aadhaar.outcome?.status || "saved"}` : " · Aadhaar not saved") : "") +
        (note ? ` — ${note}` : ""),
      // Never the Aadhaar number itself in the audit trail.
      after: { key, verdict, note, typeId: type?.id || "", movedTo: type && type.slot !== key ? type.slot || "filed" : "" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (student.householdId) {
      await notify(
        documentReviewed({
          studentId: student.id,
          householdId: student.householdId,
          docKey: type?.slot || key,
          docLabel: label,
          studentName: student.fullName,
          verdict,
          note,
          at: now,
        }),
      );
    }

    return apiOk({
      studentId: student.id,
      key,
      status: verdict,
      reviewedAt: now,
      typeId: type?.id || "",
      typeLabel: label,
      movedTo: type ? (type.slot === key ? "" : type.slot || "filed") : "",
      aadhaar,
    });
  } catch (e) {
    return apiErr(e);
  }
}
