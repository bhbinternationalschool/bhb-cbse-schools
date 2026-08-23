/**
 * Inventory — shared API route plumbing.
 *
 * Every inventory route is staff-authenticated and RBAC-checked on the
 * `store` module, and every handler's errors turn into a real HTTP status
 * with a message the UI can show. Nothing here reports success on failure.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RbacAction } from "@/lib/rbac";
import { InvError } from "@/lib/inventory/db.server";

export type InvHandlerCtx = {
  ctx: ApiAuthContext;
  /** Display name recorded on rows this request creates. */
  actor: string;
  academicYearCode: string;
};

/**
 * Run a handler behind staff auth + `store` RBAC, mapping thrown InvErrors to
 * their status. An unexpected error is logged and returned as 500 — never
 * swallowed into a 200, which is how the old desk sync hid a broken database.
 */
export async function invRoute(
  request: Request,
  action: RbacAction,
  handler: (h: InvHandlerCtx) => Promise<unknown>,
): Promise<NextResponse> {
  const auth = await requireStaffPermission(request, "store", action);
  if (!auth.ok) return auth.response;

  const session = auth.ctx.session;
  const actor = String(session.fullName || session.roleCode || "staff");
  const academicYearCode = String(session.academicYearCode || "");

  try {
    const data = await handler({ ctx: auth.ctx, actor, academicYearCode });
    return NextResponse.json({ ok: true, ...(data as object) });
  } catch (e) {
    if (e instanceof InvError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[inventory] route failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Parse a JSON body, rejecting malformed input with 400 rather than 500. */
export async function invBody<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new InvError("Invalid JSON body", 400);
  }
}

export function invQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
