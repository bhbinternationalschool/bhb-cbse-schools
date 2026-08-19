import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateStaffAgreementText } from "@/lib/aiLlm.server";
import {
  buildStaffAgreementSystemPrompt,
  buildStaffAgreementUserPrompt,
  buildStaffAgreementRetryPrompt,
  pickAgreementTextFromDoc,
  validateAgreementDoc,
  type StaffAgreementAiMode,
  type StaffAgreementAiType,
} from "@/lib/staffAgreementAi";
import type { SchoolDocumentLanguage } from "@/lib/schoolDocumentAi";
import { normalizeSchoolProfile } from "@/lib/foundationMasters";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "staff-agreement-ai",
    note: "POST { mode, staffId, language, details, agreementType, currentTitle?, currentBody?, changeRequest? }",
  });
}

function staffContextBlock(
  staff: {
    fullName: string;
    empCode: string;
    joiningDate?: string;
    jobType?: string;
    category?: string;
  },
  dep?: { name: string },
  des?: { name: string },
): string {
  return [
    `Employee: ${staff.fullName}`,
    `Employee code: ${staff.empCode}`,
    `Designation: ${des?.name ?? "—"}`,
    `Department: ${dep?.name ?? "—"}`,
    `Joining date: ${staff.joiningDate?.slice(0, 10) || "—"}`,
    `Job type: ${staff.jobType || "—"}`,
    `Category: ${staff.category || "—"}`,
  ].join("\n");
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "staff", "edit")) {
    return NextResponse.json(
      { error: "Staff edit permission required to draft agreements with AI" },
      { status: 403 },
    );
  }

  let body: {
    mode?: StaffAgreementAiMode;
    staffId?: string;
    language?: SchoolDocumentLanguage;
    details?: string;
    agreementType?: string;
    currentTitle?: string;
    currentBody?: string;
    changeRequest?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode: StaffAgreementAiMode = body.mode === "revise" ? "revise" : "create";
  const staffId = String(body.staffId || "").trim();
  const language = body.language || "both";
  const details = String(body.details || "").trim();
  const agreementType = (body.agreementType || "appointment") as StaffAgreementAiType;
  const currentTitle = String(body.currentTitle || "").trim();
  const currentBody = String(body.currentBody || "").trim();
  const changeRequest = String(body.changeRequest || "").trim();

  const staff = (masters.staff ?? []).find((s) => s.id === staffId);
  if (!staff) {
    return NextResponse.json({ error: "Staff not found" }, { status: 400 });
  }

  if (mode === "revise" && !currentBody) {
    return NextResponse.json(
      { error: "Current agreement text is required for AI revision" },
      { status: 400 },
    );
  }

  const dep = masters.departments.find((d) => d.id === staff.departmentId);
  const des = masters.designations.find((d) => d.id === staff.designationId);
  const profile = normalizeSchoolProfile(masters.schoolProfile);

  const userMessage = buildStaffAgreementUserPrompt({
    mode,
    agreementType,
    language,
    schoolName: profile.legalName,
    displayName: profile.displayName,
    city: profile.city,
    affiliationNo: profile.affiliationNo,
    staffContext: staffContextBlock(staff, dep, des),
    details,
    currentTitle,
    currentBody,
    changeRequest,
  });

  const system = buildStaffAgreementSystemPrompt(language);

  let result = await generateStaffAgreementText({
    system,
    userMessage,
  });

  if (result.ok) {
    const validationError = validateAgreementDoc(result.doc, language);
    if (validationError) {
      const retry = await generateStaffAgreementText({
        system,
        userMessage: `${userMessage}\n\n${buildStaffAgreementRetryPrompt(language)}`,
      });
      if (retry.ok && !validateAgreementDoc(retry.doc, language)) {
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

  const validationError = validateAgreementDoc(result.doc, language);
  if (validationError) {
    return NextResponse.json(
      { ok: false, error: validationError, engine: result.engine },
      { status: 503 },
    );
  }

  const picked = pickAgreementTextFromDoc(result.doc, language);

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    mode,
    title: picked.title,
    body: picked.body,
    titleEn: result.doc.titleEn,
    titleHi: result.doc.titleHi,
    bodyEn: result.doc.bodyEn,
    bodyHi: result.doc.bodyHi,
  });
}
