import { NextResponse } from "next/server";
import { speechConfigured } from "@/lib/googleSpeech.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "voice",
    browserNote: "Staff/parent UIs use Web Speech API in Chrome; Google Cloud optional",
    googleSpeech: speechConfigured(),
    languages: ["en-IN", "hi-IN", "auto"],
    endpoints: {
      transcribe: "POST /api/voice/transcribe",
      synthesize: "POST /api/voice/synthesize",
      parentVoice: "POST /api/parent-voice",
      ivrs: "POST /api/ivrs/webhook",
    },
  });
}
