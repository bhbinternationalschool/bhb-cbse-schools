/**
 * AI text for app pop-ups (Comms → App pop-ups, lib/appPopupText).
 *
 * POST (notices · edit)
 *   { mode: "draft", title, form, imageUrl? }           → { draft: { title, titleHi, body, bodyHi } }
 *   { mode: "translate", text, from: "en"|"hi", field, form, imageUrl? } → { text }
 * Draft only: nothing is saved here. Lengths are the one-screen limits.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateAppPopupTextJson } from "@/lib/aiLlm.server";
import { POPUP_CONSENT_MAX, POPUP_TITLE_MAX, popupBodyMax } from "@/lib/appPopupText";
import type { AppPopupForm } from "@/lib/appPopups";

export const runtime = "nodejs";

const FORMS: AppPopupForm[] = ["none", "aadhaar", "consent", "documents"];

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const form = (FORMS.includes(body.form as AppPopupForm) ? body.form : "none") as AppPopupForm;
  const bodyMax = popupBodyMax(form, typeof body.imageUrl === "string" && body.imageUrl.startsWith("https://"));

  if (body.mode === "draft") {
    const title = String(body.title ?? "").trim();
    if (title.length < 3) return NextResponse.json({ ok: false, error: "Type a title first." }, { status: 400 });
    const r = await generateAppPopupTextJson({ mode: "draft", title: title.slice(0, 200), form, bodyMax });
    return r.ok
      ? NextResponse.json({ ok: true, draft: r.draft, generationId: r.generationId })
      : NextResponse.json({ ok: false, error: r.error }, { status: 503 });
  }
  if (body.mode === "translate") {
    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Nothing to translate." }, { status: 400 });
    const field = body.field === "title" ? "title" : body.field === "consent" ? "consent" : "body";
    const max = field === "title" ? POPUP_TITLE_MAX : field === "consent" ? POPUP_CONSENT_MAX : bodyMax;
    const r = await generateAppPopupTextJson({ mode: "translate", text: text.slice(0, 1200), from: body.from === "hi" ? "hi" : "en", field, max });
    return r.ok
      ? NextResponse.json({ ok: true, text: r.text, generationId: r.generationId })
      : NextResponse.json({ ok: false, error: r.error }, { status: 503 });
  }
  return NextResponse.json({ ok: false, error: "mode must be draft or translate" }, { status: 400 });
}
