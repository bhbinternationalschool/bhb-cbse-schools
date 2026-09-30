import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { googleSpeechToText } from "@/lib/googleSpeech.server";
import { MAX_DICTATION_BASE64_CHARS, speechAudioKind } from "@/lib/voiceDictation";

export const runtime = "nodejs";

/**
 * Dictation for staff free-text fields (remarks, notes, reasons).
 *
 * 2026-09-30: staff only. It used to accept ANY signed session — parents,
 * students, drivers — and every call is a paid Google speech request. The
 * only callers are the staff dictation mic (VoiceDictateButton); parents
 * talk through /api/parent-voice, which has its own gate.
 */
export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

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
  if (body.audioBase64.length > MAX_DICTATION_BASE64_CHARS) {
    return NextResponse.json(
      { ok: false, error: "Recording too long — keep it under a minute" },
      { status: 413 },
    );
  }
  // An mp4/aac recording sent on as LINEAR16 comes back as nonsense or
  // "no speech", which reads as the teacher's fault. The client converts
  // those to WAV; anything still unreadable is refused by name.
  if (!speechAudioKind(body.mimeType)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported recording format (${body.mimeType || "unknown"})` },
      { status: 415 },
    );
  }

  const languageCode = body.languageCode === "en-IN" ? "en-IN" : "hi-IN";
  const result = await googleSpeechToText({
    audioBase64: body.audioBase64,
    mimeType: body.mimeType,
    languageCode,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
