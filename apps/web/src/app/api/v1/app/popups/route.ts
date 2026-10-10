/**
 * App pop-ups for the signed-in parent or staff member (lib/appPopups).
 *
 * GET  → { popups: [...] } — what to show now, newest first (the app shows one).
 * POST { popupId, action: "shown" | "dismissed" }       → recorded
 * POST { popupId, action: "done", aadhaar?: {stu_…|father|mother: digits} }
 * POST { popupId, action: "done", consent: "yes" | "no" }
 *   A form is "done" only once its answer is saved: Aadhaar numbers onto the
 *   children's records (checked, never written over an existing number), an
 *   APAAR consent exactly as WhatsApp records it.
 */

import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  householdChildren,
  popupsFor,
  readAppPopups,
  readPopupEvents,
  recordPopupEvent,
  saveApaarConsentFromApp,
  saveFamilyAadhaar,
} from "@/lib/appPopups.server";
import type { SisStudent } from "@/lib/sis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

async function whoIs(request: Request) {
  const ctx = await resolveApiAuth(request);
  const s = ctx.session;
  if (s.persona === "parent") {
    if (!s.householdId) throw new ApiError("forbidden", "No family linked to this login", 403);
    const children: SisStudent[] = await householdChildren(s.householdId, s.academicYearCode || "");
    return { ctx, audience: "parents" as const, subjectKey: `hh:${s.householdId}`, children };
  }
  return { ctx, audience: "staff" as const, subjectKey: `staff:${s.staffId || s.email || s.fullName}`, children: [] as SisStudent[] };
}

export async function GET(request: Request) {
  try {
    const who = await whoIs(request);
    const [state, events] = await Promise.all([readAppPopups(), readPopupEvents(who.subjectKey)]);
    // Unreadable is not "nothing to show"… but it is nothing worth an error on the home screen.
    if (!state || !events) return apiOk({ popups: [] });
    return apiOk({ popups: popupsFor(state, { audience: who.audience, children: who.children, today: istToday() }, events) });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const who = await whoIs(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const popupId = String(body.popupId ?? "").slice(0, 40);
    const action = String(body.action ?? "");
    if (!popupId) throw new ApiError("bad_request", "popupId required", 400);
    if (action === "shown" || action === "dismissed") {
      await recordPopupEvent(popupId, who.subjectKey, action);
      return apiOk({ recorded: true });
    }
    if (action !== "done") throw new ApiError("bad_request", "action must be shown, dismissed or done", 400);

    const state = await readAppPopups();
    const popup = state?.popups.find((p) => p.id === popupId);
    if (!popup) throw new ApiError("not_found", "This pop-up is no longer active", 404);
    const by = `${who.ctx.session.fullName || "Parent"} · ${who.audience === "parents" ? "parent app" : "staff app"}`;
    const hindi = request.headers.get("accept-language")?.startsWith("hi") ?? false;

    if (popup.form === "aadhaar") {
      if (who.audience !== "parents") throw new ApiError("bad_request", "Aadhaar forms are for parents", 400);
      const raw = (body.aadhaar ?? {}) as Record<string, unknown>;
      const numbers = Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k).slice(0, 60), String(v ?? "")]));
      const r = await saveFamilyAadhaar(who.children, numbers, by);
      if (!r.ok) throw new ApiError("bad_request", r.error, 400);
      // Which ones were given — never the numbers.
      await recordPopupEvent(popupId, who.subjectKey, "done", { aadhaarFor: Object.keys(numbers) });
      return apiOk({ saved: r.saved });
    }

    if (popup.form === "consent") {
      const answer = body.consent === "yes" ? "yes" : body.consent === "no" ? "no" : "";
      if (!answer) throw new ApiError("bad_request", "consent must be yes or no", 400);
      if ((popup.consentKey || "apaar") === "apaar" && who.audience === "parents") {
        const r = await saveApaarConsentFromApp(who.children, answer === "yes" ? "given" : "refused", by, hindi);
        if (!r.ok && who.children.some((c) => !c.apaarConsent && !(c.apaarId || "").trim())) {
          throw new ApiError("server_error", "Could not record your answer just now — please try again.", 503);
        }
      }
      await recordPopupEvent(popupId, who.subjectKey, "done", { consent: answer, consentKey: popup.consentKey || "apaar" });
      return apiOk({ recorded: true });
    }

    await recordPopupEvent(popupId, who.subjectKey, "done");
    return apiOk({ recorded: true });
  } catch (e) {
    return apiErr(e);
  }
}
