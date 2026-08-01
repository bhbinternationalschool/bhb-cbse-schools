import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { googleSpeechToText } from "@/lib/googleSpeech.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  let body: {
    audioBase64?: string;
    mimeType?: string;
    languageCode?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.audioBase64?.trim()) {
    return NextResponse.json({ error: "audioBase64 required" }, { status: 400 });
  }

  const result = await googleSpeechToText({
    audioBase64: body.audioBase64,
    mimeType: body.mimeType,
    languageCode: body.languageCode || "hi-IN",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
