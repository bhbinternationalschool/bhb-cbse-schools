import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  buildStaffDocVerificationOcr,
  buildStudentDocVerificationOcr,
} from "@/lib/docVerificationOcr";
import type { StaffDocKey } from "@/lib/foundationMasters";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, type StudentDocKey } from "@/lib/sis";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "ocr-profile-doc",
    visionConfigured: visionConfigured(),
    note: "POST { subject, subjectId, docKey, imageBase64, mimeType? } — staff verifier",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();

  let body: {
    subject?: "student" | "staff";
    subjectId?: string;
    docKey?: string;
    imageBase64?: string;
    mimeType?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = body.subject;
  const subjectId = (body.subjectId || "").trim();
  const docKey = (body.docKey || "").trim();
  const imageBase64 = (body.imageBase64 || "").trim();

  if (!subject || !subjectId || !docKey || !imageBase64) {
    return NextResponse.json(
      { error: "subject, subjectId, docKey, imageBase64 required" },
      { status: 400 },
    );
  }

  if (subject === "student") {
    if (
      !hasPermission(session, masters, "students", "approve") &&
      !hasPermission(session, masters, "students", "edit")
    ) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  } else if (subject === "staff") {
    if (
      !hasPermission(session, masters, "staff", "approve") &&
      !hasPermission(session, masters, "staff", "edit")
    ) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "subject must be student or staff" }, { status: 400 });
  }

  if (!visionConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Vision not configured — set GOOGLE_VISION_API_KEY or enable Vision on Maps key",
        visionConfigured: false,
      },
      { status: 503 },
    );
  }

  const vision = await visionExtractText({
    imageBase64,
    mimeType: body.mimeType,
  });

  if (!vision.ok) {
    return NextResponse.json(
      { ok: false, error: vision.error, visionConfigured: true },
      { status: 400 },
    );
  }

  if (subject === "student") {
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === subjectId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const hh = sis.households.find((h) => h.id === student.householdId);
    const result = buildStudentDocVerificationOcr(
      vision.text,
      student,
      docKey as StudentDocKey,
      { householdPincode: hh?.pincode },
    );
    return NextResponse.json({ ok: true, visionConfigured: true, result });
  }

  const staff = masters.staff.find((s) => s.id === subjectId);
  if (!staff) {
    return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  }
  const result = buildStaffDocVerificationOcr(
    vision.text,
    staff,
    docKey as StaffDocKey,
  );
  return NextResponse.json({ ok: true, visionConfigured: true, result });
}
