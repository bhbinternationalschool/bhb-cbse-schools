/**
 * GET /api/data/views/versions (data-layer 1.3, rule R3) — the handler,
 * kept out of the route file so a self-test can drive it with its
 * dependencies replaced (a Next.js route file may export only handlers and
 * route config).
 *
 *   200 { ok: true, versions: { <key>: { updated_at, count } }, at }
 *   401 no valid session (the same guard every /api/v1 GET uses:
 *       resolveApiAuth — a staff or parent cookie, or an API key)
 *   403 a parent session, or a family the school has made inactive. Staff
 *       only (13 Oct 2026): the answer carries school-wide counts (students,
 *       fee vouchers, …) and no parent screen uses it, so a parent cookie
 *       must not read them.
 *   503 { ok: false } — the versions could not be read; never `{}`
 *
 * The answer is the process-wide versions snapshot (lib/data/server/versions):
 * at most one erp_versions call per tenant per 2 s, however many tabs poll.
 */
import "server-only";

import { NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { readErpVersions, type VersionsSnapshot } from "./versions";

export type VersionsRouteDeps = {
  auth: (req: Request) => Promise<unknown>;
  read: () => Promise<VersionsSnapshot>;
};

const defaultDeps: VersionsRouteDeps = { auth: resolveApiAuth, read: readErpVersions };

const NO_STORE = { "Cache-Control": "no-store" };

export async function versionsGet(req: Request, deps: VersionsRouteDeps = defaultDeps): Promise<Response> {
  let ctx: unknown;
  try {
    ctx = await deps.auth(req);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 401;
    const error = e instanceof ApiError ? e.message : "Unauthorized";
    return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
  }
  if (!isStaffContext(ctx)) {
    return NextResponse.json({ ok: false, error: "Staff only" }, { status: 403, headers: NO_STORE });
  }
  const snap = await deps.read();
  if (!snap.ok) {
    return NextResponse.json(
      { ok: false, error: "Could not read what changed — please try again." },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json({ ok: true, versions: snap.versions, at: snap.at }, { headers: NO_STORE });
}

/** A staff session, or a server-to-server API key. Never a parent. */
function isStaffContext(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== "object") return false;
  const c = ctx as { authKind?: string; session?: { persona?: string } };
  if (c.authKind === "api_key") return true;
  return c.session?.persona === "staff";
}
