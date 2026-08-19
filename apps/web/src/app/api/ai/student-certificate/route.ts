import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateStudentCertificateText } from "@/lib/aiLlm.server";
import type { CertificateKind } from "@/lib/certificates";
import { classLabelForStudent } from "@/lib/certificates";
import { loadSis } from "@/lib/sis";
import {
  buildStudentCertificateRetryPrompt,
  buildStudentCertificateSystemPrompt,
  buildStudentCertificateUserPrompt,
  pickCertificateTextFromDoc,
  validateStudentCertificateDoc,
  type StudentCertificateAiMode,
} from "@/lib/studentCertificateAi";
import type { SchoolDocumentLanguage } from "@/lib/schoolDocumentAi";
import { normalizeSchoolProfile } from "@/lib/foundationMasters";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (
    !hasPermission(session, masters, "certificates", "create") &&
    !hasPermission(session, masters, "certificates", "edit")
  ) {
    return NextResponse.json(
      { error: "Certificate create/edit permission required" },
      { status: 403 },
    );
  }

  let body: {
    mode?: StudentCertificateAiMode;
    kind?: CertificateKind;
    studentId?: string;
    language?: SchoolDocumentLanguage;
    purpose?: string;
    details?: string;
    currentBody?: string;
    changeRequest?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode: StudentCertificateAiMode = body.mode === "revise" ? "revise" : "create";
  const kind = (body.kind || "bonafide") as CertificateKind;
  const studentId = String(body.studentId || "").trim();
  const language = body.language || "both";
  const purpose = String(body.purpose || "").trim();
  const details = String(body.details || "").trim();
  const currentBody = String(body.currentBody || "").trim();
  const changeRequest = String(body.changeRequest || "").trim();

  const student = loadSis().students.find((s) => s.id === studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 400 });
  }

  const profile = normalizeSchoolProfile(masters.schoolProfile);
  const classLabel = classLabelForStudent(student);

  const studentContext = [
    `Name: ${student.fullName}`,
    `Admission no: ${student.admissionNo}`,
    `Class: ${classLabel}`,
    `Roll no: ${student.rollNo || "—"}`,
    `Session: ${student.academicYearCode}`,
    `Father: ${student.fatherName || "—"}`,
    `Mother: ${student.motherName || "—"}`,
    `DOB: ${student.dob?.slice(0, 10) || "—"}`,
    `Gender: ${student.gender || "—"}`,
    `PEN (UDISE+): ${student.pen || "—"}`,
    `APAAR ID: ${student.apaarId || "—"}`,
    `Category: ${student.category || "—"}`,
  ].join("\n");

  const userMessage = buildStudentCertificateUserPrompt({
    mode,
    kind,
    language,
    schoolName: profile.legalName,
    displayName: profile.displayName,
    city: profile.city,
    affiliationNo: profile.affiliationNo,
    udiseCode: profile.udiseCode,
    studentContext,
    purpose,
    details,
    currentBody,
    changeRequest,
  });

  const system = buildStudentCertificateSystemPrompt(language);

  let result = await generateStudentCertificateText({ system, userMessage });

  if (result.ok) {
    const validationError = validateStudentCertificateDoc(result.doc, language);
    if (validationError) {
      const retry = await generateStudentCertificateText({
        system,
        userMessage: `${userMessage}\n\n${buildStudentCertificateRetryPrompt(language)}`,
      });
      if (retry.ok && !validateStudentCertificateDoc(retry.doc, language)) {
        result = retry;
      }
    }
  }

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  const validationError = validateStudentCertificateDoc(result.doc, language);
  if (validationError) {
    return NextResponse.json(
      { ok: false, error: validationError, engine: result.engine },
      { status: 503 },
    );
  }

  const picked = pickCertificateTextFromDoc(result.doc, language);

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    title: picked.title,
    body: picked.body,
    remarks: result.doc.remarks,
    tcSubjectsStudied: result.doc.tcSubjectsStudied,
    tcGamesActivities: result.doc.tcGamesActivities,
    tcAnnualExamResult: result.doc.tcAnnualExamResult,
    titleEn: result.doc.titleEn,
    titleHi: result.doc.titleHi,
    bodyEn: result.doc.bodyEn,
    bodyHi: result.doc.bodyHi,
  });
}
