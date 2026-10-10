import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { decideOfficeLink, readParentLinks, unlinkNumber } from "@/lib/parentNumberLink.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Comms → numbers parents linked from the app (lib/parentNumberLink).
 *
 * GET  (students · view) → { requests, linked } with each family's name
 * POST (students · edit) { action: "decide", id, approve, householdId? } | { action: "unlink", mobile10 }
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "students", "view");
  if (!auth.ok) return auth.response;
  const state = await readParentLinks();
  if (!state) return NextResponse.json({ ok: false, error: "Could not read — try again" }, { status: 503 });
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const family = (id: string) => {
    const h = sis.households.find((x) => x.id === id);
    if (!h) return "";
    const kids = sis.students.filter((s) => s.householdId === id && s.status === "active").map((s) => s.fullName);
    return `${h.guardianName || "Family"}${kids.length ? ` · ${[...new Set(kids)].join(", ")}` : ""}`;
  };
  return NextResponse.json(
    {
      ok: true,
      requests: state.requests.map((r) => ({ ...r, family: r.householdId ? family(r.householdId) : "" })),
      linked: state.linked.map((l) => ({ ...l, family: family(l.householdId) })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "students", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const by = auth.ctx.session.fullName || "office";
  if (body.action === "decide") {
    await ensureSchoolMirrorHydrated();
    const r = await decideOfficeLink({
      id: String(body.id ?? ""),
      approve: body.approve === true,
      householdId: typeof body.householdId === "string" ? body.householdId : undefined,
      by,
    });
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
  if (body.action === "unlink") {
    const m = String(body.mobile10 ?? "");
    if (!/^\d{10}$/.test(m)) return NextResponse.json({ ok: false, error: "mobile10 required" }, { status: 400 });
    return (await unlinkNumber(m)) ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "Could not save" }, { status: 503 });
  }
  return NextResponse.json({ ok: false, error: "action must be decide or unlink" }, { status: 400 });
}
