import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import {
  parseAdmissionDocFromText,
  type AdmissionDocOcrKind,
} from "@/lib/ocrParse";

export const runtime = "nodejs";

const KINDS = new Set<AdmissionDocOcrKind>([
  "aadhaar",
  "birth_cert",
  "generic",
]);

export async function GET() {
  return NextResponse.json({
    service: "ocr-admission-doc",
    visionConfigured: visionConfigured(),
    kinds: ["aadhaar", "birth_cert", "generic"],
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  let body: {
    imageBase64?: string;
    mimeType?: string;
    kind?: AdmissionDocOcrKind;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = KINDS.has(body.kind as AdmissionDocOcrKind)
    ? (body.kind as AdmissionDocOcrKind)
    : "generic";
  const imageBase64 = (body.imageBase64 || "").trim();

  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }

  if (!visionConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Vision not configured — set GOOGLE_VISION_API_KEY or enable Cloud Vision API on your Maps key",
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

  const suggestion = parseAdmissionDocFromText(vision.text, kind, "vision");

  return NextResponse.json({
    ok: true,
    visionConfigured: true,
    suggestion,
  });
}
