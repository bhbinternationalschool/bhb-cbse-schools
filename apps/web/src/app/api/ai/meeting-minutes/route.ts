/**
 * Meeting minutes from raw notes or a transcript — structured draft
 * (agenda, discussion, decisions, action items with owner/due as stated,
 * next meeting), nothing persisted. Staff with documents:create.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { generateMeetingMinutesJson, llmStatus } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import { MINUTES_MAX_NOTES_CHARS, type MinutesLanguage } from "@/lib/meetingMinutesAi";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "meeting-minutes",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    maxNotesChars: MINUTES_MAX_NOTES_CHARS,
    note: "POST { title?, date?, attendees?, notes, language?: en|hi|both } — staff with documents:create; returns structured minutes, saves nothing",
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
    return NextResponse.json({ error: "Document maker → Create permission required" }, { status: 403 });
  }
  let body: { title?: unknown; date?: unknown; attendees?: unknown; notes?: unknown; language?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const notes = String(body.notes ?? "").trim();
  if (notes.length < 20) {
    return NextResponse.json({ error: "Paste or dictate the meeting notes first (at least a few lines)" }, { status: 400 });
  }
  const language: MinutesLanguage = body.language === "hi" || body.language === "both" ? body.language : "en";
  const r = await generateMeetingMinutesJson({
    title: String(body.title ?? "").slice(0, 160),
    date: String(body.date ?? "").slice(0, 10),
    attendees: String(body.attendees ?? "").slice(0, 600),
    notes: notes.slice(0, MINUTES_MAX_NOTES_CHARS),
    language,
    schoolName: TENANT.nameDisplay,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, engine: r.engine }, { status: 502 });
  return NextResponse.json({
    ok: true,
    engine: r.engine,
    model: r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    language,
    generatedAt: new Date().toISOString(),
    generationId: r.generationId,
    draft: r.draft,
  });
}
