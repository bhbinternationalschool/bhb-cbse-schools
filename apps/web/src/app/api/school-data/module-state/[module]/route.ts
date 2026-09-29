/**
 * Generic per-module state (module_local_state) — GET pulls, POST upserts,
 * one row per (tenant, module). RBAC per module from lib/moduleStateRegistry.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { isModuleStateKey, MODULE_STATE_DEFS } from "@/lib/moduleStateRegistry";
import { getServerTenantContext } from "@/lib/serverTenant";
import { complaintScopeFilter } from "@/lib/api/v1/staffComplaints";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import type { ComplaintTicket } from "@/lib/complaints";
import { isMergedModuleState, mergeModuleState } from "@/lib/moduleStateMerge";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

/** Books a teacher adds to one entry at a time through /api/v1/staff/*. */
const STUDENT_BOOKS: Record<string, string[]> = {
  discipline: ["incidents"],
  health: ["visits", "medications", "vaccinations"],
};

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ module: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  if (!isModuleStateKey(module)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const auth = await requireStaffPermission(req, MODULE_STATE_DEFS[module].rbac, "view");
  if (!auth.ok) return auth.response;

  const tctx = await getServerTenantContext();
  if (!tctx) return NextResponse.json({ ok: false, error: "Tenant unavailable" }, { status: 503 });
  const { data, error } = await tctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", tctx.tenantId)
    .eq("module_key", module)
    .maybeSingle();
  if (error) {
    // Unknown is not empty.
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }
  let state: unknown = data?.state ?? null;
  if (module === "complaints" && !auth.viaMirrorSecret && state) {
    // complaints.view is held by every teacher, and this row is the whole
    // school's complaints book. A teacher's browser gets only the tickets
    // about their own classes or assigned to them — the same set as
    // /api/v1/staff/complaints (2026-09-29). Pushing it back is refused below.
    let filter: Awaited<ReturnType<typeof complaintScopeFilter>>;
    try {
      filter = await complaintScopeFilter(auth.ctx);
    } catch (e) {
      // Unknown scope is not "everything": fail rather than guess.
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not work out your classes" },
        { status: 503 },
      );
    }
    if (!filter.unrestricted) {
      // Filter the stored rows as they are (normalizing would restamp
      // every updatedAt); a row normalize would drop is dropped here too.
      const book = state as { tickets?: unknown };
      const tickets = Array.isArray(book.tickets) ? (book.tickets as ComplaintTicket[]) : [];
      state = { ...(state as object), tickets: tickets.filter((t) => !!t && filter.allows(t)) };
    }
  }
  if (module in STUDENT_BOOKS && !auth.viaMirrorSecret && state) {
    // discipline.view / health.view are held by teachers, and these rows are
    // the whole school's registers (health: children's medical notes). A
    // teacher's browser gets only their own sections' children (2026-09-29).
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "Could not work out your classes" }, { status: 503 });
    }
    if (!scope.unrestricted) {
      await ensureSchoolMirrorHydrated();
      await ensureSisHydratedServer();
      const mine = new Set(
        loadSis()
          .students.filter((s) => scopeAllows(scope, s.classId, s.sectionId))
          .map((s) => s.id),
      );
      const book = { ...(state as Record<string, unknown>) };
      for (const key of STUDENT_BOOKS[module]!) {
        const rows = Array.isArray(book[key]) ? (book[key] as { studentId?: string }[]) : [];
        book[key] = rows.filter((r) => !!r?.studentId && mine.has(r.studentId));
      }
      delete book.deletedIds;
      state = book;
    }
  }
  return NextResponse.json({
    ok: true,
    state,
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  if (!isModuleStateKey(module)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const auth = await requireStaffPermission(req, MODULE_STATE_DEFS[module].rbac, "edit");
  if (!auth.ok) return auth.response;
  if (module in STUDENT_BOOKS && !auth.viaMirrorSecret) {
    // Same rule for discipline / health: a teacher's copy is filtered to
    // their classes, so pushing it whole would erase every other class.
    // Teachers log entries through /api/v1/staff/discipline|health.
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `Only the office or principal can save the whole ${MODULE_STATE_DEFS[module].label} register. ` +
            "Entries for your own class are saved one at a time.",
        },
        { status: 403 },
      );
    }
  }
  if (module === "complaints" && !auth.viaMirrorSecret) {
    // This push is the whole complaints book, upserted over the office's
    // copy. "complaints.edit" alone let a teacher's browser send it — a stale
    // or class-filtered copy would erase the office's triage and every other
    // class's tickets. Teachers move their own tickets one at a time through
    // /api/v1/staff/complaints/update; this route is the office's
    // (2026-09-29, same rule as the attendance register push).
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the complaints book. " +
            "Your own tickets are updated one at a time on the Complaints page.",
        },
        { status: 403 },
      );
    }
  }

  let body: { state?: unknown };
  try {
    body = (await req.json()) as { state?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.state === undefined || body.state === null || typeof body.state !== "object") {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }
  const tctx = await getServerTenantContext();
  if (!tctx) return NextResponse.json({ ok: false, error: "Tenant unavailable" }, { status: 503 });
  const now = new Date().toISOString();
  if (module === "visitors") {
    // Gate-QR self-service writes the same row without a browser session;
    // union by id so neither side erases the other's rows.
    const { mergeWriteVisitorState } = await import("@/lib/visitorSelfService.server");
    const { normalizeVisitorState } = await import("@/lib/visitors");
    const merged = await mergeWriteVisitorState(normalizeVisitorState(body.state));
    if (!merged) return NextResponse.json({ ok: false, error: "Merge write failed" }, { status: 502 });
    return NextResponse.json({ ok: true, updatedAt: now });
  }
  let state: unknown = body.state;
  if (module === "fee_adjustments") {
    // Union by id, never overwrite (lib/feeAdjustmentsMerge). A browser that
    // opened the fee desk this morning and saves one adjustment this
    // afternoon used to erase every adjustment another PC posted in between.
    const { data: current, error: readErr } = await tctx.sb
      .from("module_local_state")
      .select("state")
      .eq("tenant_id", tctx.tenantId)
      .eq("module_key", module)
      .maybeSingle();
    if (readErr) {
      // Unreadable is not empty: writing now could erase the whole book.
      return NextResponse.json({ ok: false, error: `Could not read the current adjustments: ${readErr.message}` }, { status: 503 });
    }
    const { mergeFeeAdjustmentRows } = await import("@/lib/feeAdjustmentsMerge");
    const rowsOf = (v: unknown) =>
      Array.isArray((v as { rows?: unknown })?.rows) ? ((v as { rows: never[] }).rows) : [];
    state = {
      ...(body.state as Record<string, unknown>),
      rows: mergeFeeAdjustmentRows(rowsOf(current?.state), rowsOf(body.state)),
    };
  }
  if (isMergedModuleState(module)) {
    // Merge, never overwrite (lib/moduleStateMerge): teachers' phones add
    // entries to this same row between two office saves.
    const { data: current, error: readErr } = await tctx.sb
      .from("module_local_state")
      .select("state")
      .eq("tenant_id", tctx.tenantId)
      .eq("module_key", module)
      .maybeSingle();
    if (readErr) {
      // Unreadable is not empty: writing now could erase the whole book.
      return NextResponse.json(
        { ok: false, error: `Could not read the current ${MODULE_STATE_DEFS[module].label}: ${readErr.message}` },
        { status: 503 },
      );
    }
    state = mergeModuleState(module, current?.state ?? null, body.state as Record<string, unknown>);
  }
  const { error } = await tctx.sb.from("module_local_state").upsert(
    { tenant_id: tctx.tenantId, module_key: module, state, updated_at: now },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, updatedAt: now });
}
