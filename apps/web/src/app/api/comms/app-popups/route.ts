/**
 * Comms → App pop-ups (web ERP): post, edit and switch off pop-ups for the
 * parent and staff apps, and see how each is doing (lib/appPopups).
 *
 * GET  (notices · view) → { popups, stats: { [id]: { shown, dismissed, done, pendingNow? } } }
 *   pendingNow, for a rule pop-up: families the rule matches right now.
 * POST (notices · edit) { action: "save", popup } | { action: "delete", id }
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { aadhaarInScope, normalizeAppPopup, type AppPopup } from "@/lib/appPopups";
import { popupTextTooLong } from "@/lib/appPopupText";
import { familyFacts, readAppPopups, schoolAadhaarGaps, writeAppPopups } from "@/lib/appPopups.server";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function stats(popups: AppPopup[]) {
  const out: Record<string, { shown: number; dismissed: number; done: number; pendingNow?: number }> = {};
  for (const p of popups) out[p.id] = { shown: 0, dismissed: 0, done: 0 };
  const ctx = await getServerTenantContext();
  if (ctx && popups.length) {
    const { data } = await ctx.sb
      .from("app_popup_events")
      .select("popup_id, subject_key, event")
      .eq("tenant_id", ctx.tenantId)
      .in("popup_id", popups.map((p) => p.id))
      .limit(20000);
    // People, not taps: each family or staff member counted once per event kind.
    const seen = new Set<string>();
    for (const r of data ?? []) {
      const k = `${r.popup_id}|${r.subject_key}|${r.event}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const st = out[String(r.popup_id)];
      if (st && (r.event === "shown" || r.event === "dismissed" || r.event === "done")) st[r.event as "shown"] += 1;
    }
  }
  const rulePopups = popups.filter((p) => p.targetMode === "rule");
  if (rulePopups.length) {
    await ensureSisHydratedServer();
    const byHousehold = new Map<string, SisStudent[]>();
    for (const s of loadSis().students) {
      if (s.status !== "active" || !s.householdId) continue;
      byHousehold.set(s.householdId, [...(byHousehold.get(s.householdId) ?? []), s]);
    }
    for (const p of rulePopups) {
      let n = 0;
      for (const kids of byHousehold.values()) {
        const f = familyFacts(kids, p.consentKey && p.consentKey !== "apaar" ? [p.consentKey] : []);
        if (p.rule === "missing_docs" && f.missingDocs.length) n += 1;
        if (p.rule === "missing_aadhaar" && aadhaarInScope(f.missingAadhaar, p.aadhaarScope).length) n += 1;
        if (p.rule === "consent_pending" && (p.consentKey || "apaar") === "apaar" && f.pendingConsents.includes("apaar")) n += 1;
      }
      out[p.id]!.pendingNow = n;
    }
  }
  return out;
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "view");
  if (!auth.ok) return auth.response;
  const state = await readAppPopups();
  if (!state) return NextResponse.json({ ok: false, error: "Could not read app pop-ups" }, { status: 503 });
  await ensureSchoolMirrorHydrated();
  const ay = currentAcademicYearCode(loadMasters());
  const aadhaarCounts = await schoolAadhaarGaps(ay).catch(() => null);
  return NextResponse.json(
    { ok: true, popups: state.popups, stats: await stats(state.popups), aadhaarCounts },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const state = await readAppPopups();
  if (!state) return NextResponse.json({ ok: false, error: "Could not read app pop-ups — nothing was saved." }, { status: 503 });
  const now = new Date().toISOString();
  const by = auth.ctx.session.fullName || "Office";

  if (body.action === "delete") {
    const id = String(body.id ?? "");
    const next = { ...state, popups: state.popups.filter((p) => p.id !== id) };
    const w = await writeAppPopups(next);
    return NextResponse.json(w.ok ? { ok: true } : { ok: false, error: w.error }, { status: w.ok ? 200 : 503 });
  }
  if (body.action !== "save") return NextResponse.json({ ok: false, error: "action must be save or delete" }, { status: 400 });

  const raw = (body.popup ?? {}) as Record<string, unknown>;
  const id = String(raw.id || `pop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  const prev = state.popups.find((p) => p.id === id);
  const popup = normalizeAppPopup({ ...raw, id, createdBy: prev?.createdBy || by, createdAt: prev?.createdAt || now, updatedAt: now });
  if (!popup) return NextResponse.json({ ok: false, error: "A pop-up needs a title." }, { status: 400 });
  // One phone screen, no scrolling (lib/appPopupText) — checked here too, not only in the editor.
  // Only when the words change: stopping or starting an older, longer pop-up still works.
  const textKeys = ["title", "titleHi", "body", "bodyHi", "consentText", "consentTextHi", "form", "imageUrl"] as const;
  const textChanged = !prev || textKeys.some((k) => prev[k] !== popup[k]);
  const tooLong = textChanged ? popupTextTooLong(popup) : "";
  if (tooLong) return NextResponse.json({ ok: false, error: tooLong }, { status: 400 });
  if (popup.form === "consent" && !popup.consentText.trim()) {
    return NextResponse.json({ ok: false, error: "Write the consent text the parent agrees to." }, { status: 400 });
  }
  const next = { ...state, popups: prev ? state.popups.map((p) => (p.id === id ? popup : p)) : [popup, ...state.popups] };
  const w = await writeAppPopups(next);
  return NextResponse.json(w.ok ? { ok: true, popup } : { ok: false, error: w.error }, { status: w.ok ? 200 : 503 });
}
