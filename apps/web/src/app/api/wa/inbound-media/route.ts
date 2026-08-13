/**
 * Staff review queue for inbound WhatsApp media (photos/PDFs parents send —
 * Aadhaar, birth cert, payment proof) — list + view + OCR-verify + mark
 * reviewed. Media bytes are never persisted; "view"/"runOcr" fetch on
 * demand from Meta's CDN via the stored media id.
 */
import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { getDemoSession } from "@/lib/auth";
import {
  buildStaffDocVerificationOcr,
  buildStudentDocVerificationOcr,
} from "@/lib/docVerificationOcr";
import type { StaffDocKey } from "@/lib/foundationMasters";
import { visionConfigured, visionExtractText } from "@/lib/googleVision.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, type StudentDocKey } from "@/lib/sis";
import {
  fetchWaMediaAsDataUrl,
  getInboundMediaById,
  listInboundMedia,
  markInboundMediaReviewed,
  saveInboundMediaOcrResult,
} from "@/lib/waInboundMedia.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const url = new URL(req.url);
  const onlyPending = url.searchParams.get("pending") === "1";
  const items = await listInboundMedia({ onlyPending, limit: 200 });
  const sis = loadSis();
  const enriched = items.map((item) => ({
    ...item,
    householdChildren: item.householdId
      ? sis.students
          .filter((s) => s.householdId === item.householdId)
          .map((s) => ({ id: s.id, name: s.fullName }))
      : [],
  }));
  return NextResponse.json({
    ok: true,
    items: enriched,
    visionConfigured: visionConfigured(),
  });
}

export async function POST(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();

  let body: {
    action?: string;
    id?: string;
    by?: string;
    subject?: "student" | "staff";
    subjectId?: string;
    docKey?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const item = await getInboundMediaById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.action === "view") {
    const media = await fetchWaMediaAsDataUrl(item.mediaId);
    if (!media.ok) {
      return NextResponse.json({ error: media.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, dataUrl: media.dataUrl, mimeType: media.mimeType });
  }

  if (body.action === "markReviewed") {
    const session = await getDemoSession();
    const r = await markInboundMediaReviewed(id, body.by || session?.fullName || "Desk");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "runOcr") {
    const session = await getDemoSession();
    if (!session || session.persona !== "staff") {
      return NextResponse.json({ error: "Staff login required" }, { status: 401 });
    }
    const masters = loadMasters();
    const subject = body.subject;
    const subjectId = (body.subjectId || "").trim();
    const docKey = (body.docKey || "").trim();
    if (!subject || !subjectId || !docKey) {
      return NextResponse.json(
        { error: "subject, subjectId, docKey required" },
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
    } else {
      if (
        !hasPermission(session, masters, "staff", "approve") &&
        !hasPermission(session, masters, "staff", "edit")
      ) {
        return NextResponse.json({ error: "Not allowed" }, { status: 403 });
      }
    }
    if (!visionConfigured()) {
      return NextResponse.json(
        { error: "Google Vision not configured", visionConfigured: false },
        { status: 503 },
      );
    }
    const media = await fetchWaMediaAsDataUrl(item.mediaId);
    if (!media.ok) {
      return NextResponse.json({ error: media.error }, { status: 502 });
    }
    const vision = await visionExtractText({
      imageBase64: media.dataUrl,
      mimeType: media.mimeType,
    });
    if (!vision.ok) {
      return NextResponse.json({ ok: false, error: vision.error }, { status: 400 });
    }

    let result;
    if (subject === "student") {
      const sis = loadSis();
      const student = sis.students.find((s) => s.id === subjectId);
      if (!student) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }
      const hh = sis.households.find((h) => h.id === student.householdId);
      result = buildStudentDocVerificationOcr(
        vision.text,
        student,
        docKey as StudentDocKey,
        { householdPincode: hh?.pincode },
      );
    } else {
      const staff = masters.staff.find((s) => s.id === subjectId);
      if (!staff) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }
      result = buildStaffDocVerificationOcr(vision.text, staff, docKey as StaffDocKey);
    }

    await saveInboundMediaOcrResult(id, result);
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
