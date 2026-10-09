/**
 * The module guide's change requests (lib/moduleRequests, director 9 Oct 2026).
 *
 * POST { action: "draft", history, pathname, tab, pageLabel }
 *   → { ok, draft: { ready:false, question } | { ready:true, kind, title, problem, wanted, suggestion } }
 *   The guide asks what is still unclear, or writes the request card. Nothing
 *   is stored.
 * POST { action: "submit", card, history, pathname, tab, pageLabel }
 *   → stores the request as "new" for the director's inbox. Built only after
 *   the director approves it.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { generateModuleRequestJson } from "@/lib/aiLlm.server";
import { addModuleRequest, type ModuleRequest, type ModuleRequestKind } from "@/lib/moduleRequests";
import { updateModuleRequests } from "@/lib/moduleRequests.server";
import { moduleForHref } from "@/lib/rbac";

export const runtime = "nodejs";

type Turn = { role: "user" | "assistant"; text: string };

function readTranscript(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .slice(-12)
    .map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text).slice(0, 600) }));
}

const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pathname = s(body.pathname, 200) || "/home";
  const tab = s(body.tab, 60);
  const pageLabel = s(body.pageLabel, 120);
  const rbacModule = moduleForHref(tab ? `${pathname}?tab=${tab}` : pathname) || "";
  const transcript = readTranscript(body.history);

  if (body.action === "draft") {
    if (!transcript.some((t) => t.role === "user")) {
      return NextResponse.json({ ok: false, error: "Tell me what you would like changed first." }, { status: 400 });
    }
    const r = await generateModuleRequestJson({ pageLabel, module: rbacModule, pathname, tab, transcript });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 503 });
    return NextResponse.json({ ok: true, draft: r.draft });
  }

  if (body.action === "submit") {
    const card = (body.card ?? {}) as Record<string, unknown>;
    const title = s(card.title, 160);
    const suggestion = s(card.suggestion, 4000);
    if (!title || !suggestion) {
      return NextResponse.json({ ok: false, error: "The request needs a title and what should change." }, { status: 400 });
    }
    const kind = (["change", "bug", "stuck"] as const).find((k) => k === card.kind) ?? ("change" as ModuleRequestKind);
    const session = auth.ctx.session;
    const now = new Date().toISOString();
    const request: ModuleRequest = {
      id: `mr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      byStaffId: session.staffId || "",
      byName: session.fullName || "",
      byRole: session.roleCode || "",
      module: rbacModule,
      pathname,
      tab,
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
    const saved = await updateModuleRequests((st) => addModuleRequest(st, request));
    if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 503 });
    return NextResponse.json({ ok: true, id: request.id });
  }

  return NextResponse.json({ ok: false, error: "action must be draft or submit" }, { status: 400 });
}
