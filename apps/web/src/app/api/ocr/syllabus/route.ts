import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import {
  parseSyllabusFromText,
  syllabusOcrQuality,
} from "@/lib/syllabusOcr";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "ocr-syllabus",
    visionConfigured: visionConfigured(),
  });
}

/**
 * POST /api/ocr/syllabus — read a textbook contents page.
 *
 * Returns *candidates* only. Nothing is written here: the caller shows
 * the detected chapters for review and posts the confirmed list through
 * the normal syllabus save path. The raw text comes back too, so a page
 * the parser misread can still be fixed by hand rather than being a dead
 * end.
 */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageBase64 = (body.imageBase64 || "").trim();
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }

  if (!visionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        visionConfigured: false,
        error:
          "Google Vision not configured — set GOOGLE_VISION_API_KEY or enable Cloud Vision API on your Maps key",
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
      { ok: false, error: vision.error },
      { status: 400 },
    );
  }

  const parsed = parseSyllabusFromText(vision.text);
  const quality = syllabusOcrQuality(parsed);

  return NextResponse.json({
    ok: true,
    chapters: parsed.chapters,
    ignored: parsed.ignored,
    quality,
    // Surfaced so a poor parse is still recoverable by hand.
    rawText: vision.text,
  });
}
