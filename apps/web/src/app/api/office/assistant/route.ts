/**
 * Director console — the ERP "brain" behind @BHB_Office_bot.
 *
 * The n8n Telegram relay POSTs the director's plain Hindi/English here with
 * the shared secret; a Claude tool-use agent answers from the ERP's own
 * grounded data, builds report files, drafts (never sends) outward messages
 * for one-tap approval, and manages office tasks. The actual send happens
 * only from an approve_draft action (a button tap relayed back here).
 *
 * Auth: x-office-assistant-secret (OFFICE_ASSISTANT_SECRET) or the existing
 * x-wa-dispatch-secret (WA_DISPATCH_SECRET). Director-only: the caller passes
 * the director's chat id, checked against TELEGRAM_DIRECTOR_CHAT_ID.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { isDirectorChat, type AssistantInput } from "@/lib/officeAssistant";
import { runOfficeAssistant } from "@/lib/officeAssistant.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "office-assistant",
    configured: !!process.env.ANTHROPIC_API_KEY,
    note: "POST { text, chat_id, locale?, action? } with x-office-assistant-secret (or x-wa-dispatch-secret). Director-only.",
  });
}

export async function POST(req: Request) {
  // Secret gate — accept a dedicated office secret or the WA dispatch secret.
  if (!requireJobSecret(req, ["OFFICE_ASSISTANT_SECRET", "WA_DISPATCH_SECRET"], ["x-office-assistant-secret", "x-wa-dispatch-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AssistantInput | null = null;
  try {
    body = (await req.json()) as AssistantInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Director-only. The relay sends the director's chat id; we check it here
  // too so the ERP endpoint is safe even if called directly.
  const directorChatId = process.env.TELEGRAM_DIRECTOR_CHAT_ID;
  if (directorChatId && !isDirectorChat(body?.chat_id, directorChatId)) {
    return NextResponse.json({ kind: "error", text: "This console is for the director only." }, { status: 403 });
  }

  const originUrl = process.env.ERP_BASE_URL?.trim() || new URL(req.url).origin;

  try {
    const out = await runOfficeAssistant(
      { text: String(body?.text || ""), chat_id: body?.chat_id, locale: body?.locale, action: body?.action },
      { originUrl },
    );
    return NextResponse.json(out);
  } catch (e) {
    console.error("[office-assistant] route failed", e);
    // Resilience: the n8n poller must not crash — return a plain answer.
    return NextResponse.json({ kind: "error", text: "The assistant hit an error. Please try again shortly." });
  }
}
