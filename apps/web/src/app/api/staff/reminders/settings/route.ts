/**
 * Staff work reminder settings (lib/staffReminders.ts) — one
 * module_local_state row, written only here (server truth; no browser copy).
 *
 * GET — { settings, updatedAt }. Staff · view.
 * PUT — { settings, baseUpdatedAt } — refused (409) when the row changed
 *        since `baseUpdatedAt` was read. Staff · edit.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizeReminderSettings } from "@/lib/staffReminders";
import { readReminderSettings, writeReminderSettings } from "@/lib/staffReminders.server";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const got = await readReminderSettings();
  if (!got.ok) return NextResponse.json({ ok: false, error: "Could not read the reminder settings. Try again." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ ok: true, settings: got.value.settings, updatedAt: got.value.updatedAt }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  let body: { settings?: unknown; baseUpdatedAt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const base = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : "";
  const got = await readReminderSettings();
  if (!got.ok) return NextResponse.json({ ok: false, error: "Could not read the reminder settings — nothing was saved." }, { status: 503 });
  if (got.value.updatedAt !== base) {
    return NextResponse.json({ ok: false, error: "Someone else changed the reminder settings meanwhile — reload and try again. Nothing was saved." }, { status: 409 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  const settings = { ...normalizeReminderSettings(body.settings), updatedBy: by };
  const saved = await writeReminderSettings(settings, got.value.updatedAt);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: saved.conflict ? 409 : 500 });
  return NextResponse.json({ ok: true, settings: { ...settings, updatedAt: saved.updatedAt }, updatedAt: saved.updatedAt });
}
