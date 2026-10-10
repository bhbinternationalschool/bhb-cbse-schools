/**
 * GET  /api/fees/defaulter-policy — what the school currently withholds.
 * PUT  /api/fees/defaulter-policy — change it.
 *
 * Reading the policy is a `fees:view` right, because the office needs to
 * answer "why is this child blocked" without being able to change the answer.
 * Editing it is `fees:edit`: deciding that a class of families loses the bus
 * is the same weight of act as writing off a bill, and it is the shape of
 * decision the concessions desk already reserves for a principal, admin or
 * owner.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  fetchDefaulterPolicy,
  saveDefaulterPolicy,
} from "@/lib/defaulterHold.server";
import {
  normalizeDefaulterPolicy,
  type StoredDefaulterPolicy,
} from "@/lib/defaulterHoldPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Server is not configured for database access" },
      { status: 503 },
    );
  }

  const res = await fetchDefaulterPolicy(ctx.sb, ctx.tenantId);
  if (!res.ok) {
    // A failed read is reported as a failure, never as an empty policy. "The
    // school withholds nothing" and "we could not find out what the school
    // withholds" must not look the same on the screen.
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, policy: res.policy });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Server is not configured for database access" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON" },
      { status: 400 },
    );
  }

  const raw = (body as { policy?: StoredDefaulterPolicy } | null)?.policy;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json(
      { ok: false, error: "Send { policy: … }" },
      { status: 400 },
    );
  }

  // Normalise before writing, not after reading. A gate for something the
  // policy may never withhold is dropped here, so it never reaches the table
  // and cannot be honoured by a later reader that forgot to check.
  const policy = normalizeDefaulterPolicy(raw);

  const saved = await saveDefaulterPolicy(ctx.sb, ctx.tenantId, policy);
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, policy });
}
