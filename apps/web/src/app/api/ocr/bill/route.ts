import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import { parseBillOcrFromText } from "@/lib/ocrParse";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "ocr-bill",
    visionConfigured: visionConfigured(),
    note: "POST { imageBase64, mimeType?, fileName?, photoNote?, fallbackAmountPaise, billDate? }",
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
    fileName?: string;
    photoNote?: string;
    fallbackAmountPaise?: number;
    billDate?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fallback = Math.max(0, Number(body.fallbackAmountPaise) || 0);
  const hasImage = !!(body.imageBase64 || "").trim();

  if (hasImage && visionConfigured()) {
    const vision = await visionExtractText({
      imageBase64: body.imageBase64!,
      mimeType: body.mimeType,
    });
    if (vision.ok) {
      const suggestion = parseBillOcrFromText(vision.text, {
        fallbackAmountPaise: fallback,
        billDate: body.billDate,
        fileName: body.fileName,
        photoNote: body.photoNote,
        engine: "vision",
      });
      return NextResponse.json({
        ok: true,
        visionConfigured: true,
        suggestion,
      });
    }
    if (body.mimeType === "application/pdf") {
      return NextResponse.json(
        { ok: false, error: vision.error, visionConfigured: true },
        { status: 400 },
      );
    }
  }

  const demoText = `${body.fileName || ""} ${body.photoNote || ""}`;
  const suggestion = parseBillOcrFromText(demoText, {
    fallbackAmountPaise: fallback,
    billDate: body.billDate,
    fileName: body.fileName,
    photoNote: body.photoNote,
    engine: "demo",
  });

  return NextResponse.json({
    ok: true,
    visionConfigured: visionConfigured(),
    suggestion,
    warning: hasImage
      ? visionConfigured()
        ? "Vision could not read image — used filename/note fallback"
        : "Vision not configured — used filename/note fallback"
      : undefined,
  });
}
