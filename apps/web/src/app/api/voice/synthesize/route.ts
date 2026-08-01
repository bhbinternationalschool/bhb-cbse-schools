import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { googleTextToSpeech } from "@/lib/googleSpeech.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  let body: { text?: string; languageCode?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const result = await googleTextToSpeech({
    text,
    languageCode: body.languageCode || "hi-IN",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    audioBase64: result.audioBase64,
    mimeType: result.mimeType,
  });
}
