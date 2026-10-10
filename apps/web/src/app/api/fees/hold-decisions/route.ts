/**
 * GET  /api/fees/hold-decisions — every standing decision, plus the policy.
 * POST /api/fees/hold-decisions — lift blocks in bulk.
 *
 * The gates read the GET. It returns the policy alongside the decisions
 * because a gate needs both to answer: the decision says what a person
 * decided, the policy's mode says what silence means.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  fetchDefaulterPolicy,
  fetchLiveHoldDecisions,
  releaseHoldDecisions,
} from "@/lib/defaulterHold.server";
import { isBlockableHold } from "@/lib/defaulterHoldPolicy";
import type { HoldCode } from "@/lib/types";

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

  const [policy, decisions] = await Promise.all([
    fetchDefaulterPolicy(ctx.sb, ctx.tenantId),
    fetchLiveHoldDecisions(ctx.sb, ctx.tenantId),
  ]);

  // Either failure is reported as a failure. A gate that received an empty
  // list here would read it as "nobody is blocked" and let a child through
  // that the office had withheld.
  if (!policy.ok) {
    return NextResponse.json({ ok: false, error: policy.error }, { status: 500 });
  }
  if (!decisions.ok) {
    return NextResponse.json(
      { ok: false, error: decisions.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    policy: policy.policy,
    decisions: decisions.decisions,
  });
}

export async function POST(req: Request) {
  // Lifting a block changes what a child may do, so it needs the same right
  // as applying one.
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Server is not configured for database access" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    holdCode?: string;
    studentIds?: unknown;
    reason?: string;
  } | null;

  const holdCode = String(body?.holdCode ?? "");
  const reason = String(body?.reason ?? "").trim();
  const studentIds = Array.isArray(body?.studentIds)
    ? body!.studentIds.map((v) => String(v)).filter(Boolean)
    : [];

  if (!isBlockableHold(holdCode)) {
    return NextResponse.json(
      { ok: false, error: "Unknown service" },
      { status: 400 },
    );
  }
  if (studentIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Send { holdCode, studentIds: [...], reason }" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Lifting a block needs a reason — 'paid in full', 'principal agreed', something a colleague can read next month.",
      },
      { status: 400 },
    );
  }

  const res = await releaseHoldDecisions(
    ctx.sb,
    ctx.tenantId,
    holdCode as HoldCode,
    studentIds,
    auth.ctx.session.fullName || auth.ctx.session.email || "",
    reason,
  );
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    released: res.released,
    requested: studentIds.length,
  });
}
