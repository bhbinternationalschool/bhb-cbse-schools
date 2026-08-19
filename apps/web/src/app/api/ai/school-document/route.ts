import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateSchoolDocumentText } from "@/lib/aiLlm.server";
import {
  buildSchoolDocumentSystemPrompt,
  buildSchoolDocumentUserPrompt,
  type SchoolDocumentLanguage,
  type SchoolDocumentType,
} from "@/lib/schoolDocumentAi";
import { normalizeSchoolProfile } from "@/lib/foundationMasters";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "school-document-ai",
    note: "POST { docType, language, details }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "documents", "create")) {
    return NextResponse.json(
      { error: "Document maker create permission required" },
      { status: 403 },
    );
  }

  let body: {
    docType?: SchoolDocumentType;
    language?: SchoolDocumentLanguage;
    details?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const docType = body.docType || "formal_letter";
  const language = body.language || "both";
  const details = String(body.details || "").trim();
  const profile = normalizeSchoolProfile(masters.schoolProfile);

  const userMessage = buildSchoolDocumentUserPrompt({
    docType,
    language,
    details,
    schoolName: profile.legalName,
    displayName: profile.displayName,
    city: profile.city,
    affiliationNo: profile.affiliationNo,
  });

  const result = await generateSchoolDocumentText({
    system: buildSchoolDocumentSystemPrompt(),
    userMessage,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    titleEn: result.doc.titleEn,
    titleHi: result.doc.titleHi,
    bodyEn: result.doc.bodyEn,
    bodyHi: result.doc.bodyHi,
    subject: result.doc.subject,
  });
}
