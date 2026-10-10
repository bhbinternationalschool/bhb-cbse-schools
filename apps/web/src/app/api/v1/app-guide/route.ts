/**
 * POST /api/v1/app-guide — the parent and staff apps' screen guide
 * (director, 9 Oct 2026: guides "for parent as well as staff app").
 *
 *   { action: "draft",  screen, screenLabel, history }  → { draft: question | card }
 *   { action: "submit", screen, screenLabel, history, card } → stored for the director
 *   { action: "stuck",  screen, message }                → counted under Stuck points
 *
 * The same store and inbox as the web ERP's guide (lib/moduleRequests): a
 * request from the app shows in Modules → Requests marked with the app and
 * who sent it, and is built only after the director approves it. Any
 * signed-in parent or staff member may send one.
 */

import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { generateModuleRequestJson } from "@/lib/aiLlm.server";
import { addModuleRequest, recordStuckSignal, type ModuleRequest, type ModuleRequestKind } from "@/lib/moduleRequests";
import { updateModuleRequests } from "@/lib/moduleRequests.server";

export const runtime = "nodejs";

type Turn = { role: "user" | "assistant"; text: string };
const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function readTranscript(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .slice(-12)
    .map((t) => ({ role: t.role === "assistant" ? ("assistant" as const) : ("user" as const), text: String(t.text).slice(0, 600) }));
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const session = ctx.session;
    const app = session.persona === "parent" ? "parent app" : "staff app";
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // The app's own route, kept apart from web paths so the inbox shows where it came from.
    const screen = s(body.screen, 160) || "/";
    const pathname = `app:${session.persona === "parent" ? "parent" : "staff"}${screen.startsWith("/") ? "" : "/"}${screen}`;
    const screenLabel = s(body.screenLabel, 120);
    const pageLabel = screenLabel ? `${screenLabel} (${app})` : app;

    if (body.action === "stuck") {
      const message = s(body.message, 300);
      if (!message) throw new ApiError("bad_request", "message required", 400);
      const who = session.fullName || session.staffId || session.persona;
      const r = await updateModuleRequests((st) =>
        recordStuckSignal(st, { module: app, pathname, message, user: who, now: new Date().toISOString() }),
      );
      return apiOk({ recorded: r.ok });
    }

    const transcript = readTranscript(body.history);
    if (body.action === "draft") {
      if (!transcript.some((t) => t.role === "user")) {
        throw new ApiError("bad_request", "Tell us what you would like changed first.", 400);
      }
      const r = await generateModuleRequestJson({ pageLabel, module: app, pathname, tab: "", transcript });
      if (!r.ok) throw new ApiError("server_error", r.error, 503);
      return apiOk({ draft: r.draft });
    }

    if (body.action === "submit") {
      const card = (body.card ?? {}) as Record<string, unknown>;
      const title = s(card.title, 160);
      const suggestion = s(card.suggestion, 4000);
      if (!title || !suggestion) throw new ApiError("bad_request", "The request needs a title and what should change.", 400);
      const kind = (["change", "bug", "stuck"] as const).find((k) => k === card.kind) ?? ("change" as ModuleRequestKind);
      const now = new Date().toISOString();
      const req: ModuleRequest = {
        id: `mr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        byStaffId: session.staffId || "",
        byName: session.fullName || "",
        byRole: session.persona === "parent" ? "parent" : session.roleCode || "staff",
        module: app,
        pathname,
        tab: "",
        pageLabel,
        kind,
        title,
        problem: s(card.problem, 2000),
        wanted: s(card.wanted, 2000),
        suggestion,
        transcript,
        status: "new",
        decidedAt: "",
        decidedBy: "",
        directorNote: "",
        prUrl: "",
      };
      const saved = await updateModuleRequests((st) => addModuleRequest(st, req));
      if (!saved.ok) throw new ApiError("server_error", saved.error, 503);
      return apiOk({ id: req.id });
    }

    throw new ApiError("bad_request", "action must be draft, submit or stuck", 400);
  } catch (e) {
    return apiErr(e);
  }
}
