/**
 * Rounds — the list somebody reads before a child loses a bus seat.
 *
 * GET  ?id=…        one round with its children
 * GET               recent rounds, newest first (add ?holdCode= to narrow)
 * POST              build a new draft round for one service
 * PATCH             the bulk decision: one verdict across many children
 * PUT               apply a draft — the only call that changes what a child
 *                   may do, and the only one that needs `fees:edit`
 *
 * Building and reading are `fees:view`. Seeing who would be caught is exactly
 * the thing an office clerk should be able to check before raising it, and a
 * draft round withholds nothing.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  commitRoundDecisions,
  fetchDefaulterPolicy,
  fetchDefaulterPopulation,
  fetchRound,
  insertRound,
  listRounds,
  setRoundDecisions,
} from "@/lib/defaulterHold.server";
import { gateFor, isBlockableHold } from "@/lib/defaulterHoldPolicy";
import {
  applyRound,
  buildHoldRound,
  countRound,
  roundBlockers,
  staleItems,
  type HoldDecision,
} from "@/lib/defaulterHoldRound";
import type { HoldCode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayIso(): string {
  // Asia/Kolkata. A round built at 1 am UTC must carry the school's date, not
  // yesterday's, or the list is named for a day nobody was at work.
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ctx: null,
      response: NextResponse.json(
        { ok: false, error: "Server is not configured for database access" },
        { status: 503 },
      ),
    };
  }
  return { ctx, response: null };
}

async function runningYear(): Promise<string> {
  const { ensureSchoolMirrorHydrated } = await import(
    "@/lib/schoolDataMirror.server"
  );
  await ensureSchoolMirrorHydrated();
  const { loadMasters, currentAcademicYearCode } = await import("@/lib/masters");
  return currentAcademicYearCode(loadMasters());
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const { ctx, response } = await tenant();
  if (!ctx) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() || "";

  if (id) {
    const res = await fetchRound(ctx.sb, ctx.tenantId, id);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }
    if (!res.round) {
      return NextResponse.json(
        { ok: false, error: "No such round" },
        { status: 404 },
      );
    }

    // Anyone whose bill has moved since the list was built. Reported, never
    // dropped: removing a name from a list somebody already read is its own
    // surprise, and paying up is exactly the case the office must see.
    const ay = await runningYear();
    const pop = await fetchDefaulterPopulation(
      ctx.sb,
      ctx.tenantId,
      ay,
      todayIso(),
    );

    return NextResponse.json({
      ok: true,
      round: res.round,
      counts: countRound(res.round),
      blockers: roundBlockers(res.round),
      stale: pop.ok ? staleItems(res.round, pop.population) : [],
      // A failed population read must not masquerade as "nobody has paid".
      staleKnown: pop.ok,
    });
  }

  const holdCodeRaw = url.searchParams.get("holdCode")?.trim() || "";
  const res = await listRounds(ctx.sb, ctx.tenantId, {
    holdCode: isBlockableHold(holdCodeRaw) ? (holdCodeRaw as HoldCode) : undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rounds: res.rounds });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const { ctx, response } = await tenant();
  if (!ctx) return response;

  const body = (await req.json().catch(() => null)) as {
    holdCode?: string;
  } | null;
  const holdCode = String(body?.holdCode ?? "");

  if (!isBlockableHold(holdCode)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `${holdCode || "That"} is not a service a defaulter policy may withhold. ` +
          "Class attendance, homework and anything safety-shaped are never withheld.",
      },
      { status: 400 },
    );
  }

  const policyRes = await fetchDefaulterPolicy(ctx.sb, ctx.tenantId);
  if (!policyRes.ok) {
    return NextResponse.json(
      { ok: false, error: policyRes.error },
      { status: 500 },
    );
  }
  const gate = gateFor(policyRes.policy, holdCode as HoldCode);
  if (!gate || gate.mode === "off") {
    return NextResponse.json(
      {
        ok: false,
        error: `The ${holdCode} gate is switched off. Turn it on in the defaulter policy first.`,
      },
      { status: 400 },
    );
  }

  const asOf = todayIso();
  const ay = await runningYear();
  const pop = await fetchDefaulterPopulation(ctx.sb, ctx.tenantId, ay, asOf);
  if (!pop.ok) {
    return NextResponse.json({ ok: false, error: pop.error }, { status: 500 });
  }

  const round = buildHoldRound({
    id: `hrd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    holdCode: holdCode as HoldCode,
    gate,
    population: pop.population,
    asOf,
    createdBy: auth.ctx.session.fullName || auth.ctx.session.email || "",
  });

  const saved = await insertRound(ctx.sb, ctx.tenantId, round, ay);
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    round,
    counts: countRound(round),
    // So the screen can say "built from a cache last rebuilt at …" rather
    // than implying the numbers are live to the second.
    duesCacheUpdatedAt: pop.cacheUpdatedAt,
    populationSize: pop.population.length,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const { ctx, response } = await tenant();
  if (!ctx) return response;

  const body = (await req.json().catch(() => null)) as {
    roundId?: string;
    studentIds?: unknown;
    decision?: string;
    reason?: string;
  } | null;

  const roundId = String(body?.roundId ?? "");
  const decision = String(body?.decision ?? "") as HoldDecision;
  const reason = String(body?.reason ?? "");
  const studentIds = Array.isArray(body?.studentIds)
    ? body!.studentIds.map((v) => String(v)).filter(Boolean)
    : [];

  if (!roundId || studentIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Send { roundId, studentIds: [...], decision }" },
      { status: 400 },
    );
  }
  if (!["undecided", "disallow", "allow"].includes(decision)) {
    return NextResponse.json(
      { ok: false, error: "decision must be undecided, disallow or allow" },
      { status: 400 },
    );
  }
  // An allow with no reason is refused here as well as in the round's own
  // blockers. The office should hear about it on the button that caused it,
  // not three screens later when they try to apply.
  if (decision === "allow" && !reason.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Letting a family through needs a reason — it is what next month's round reads.",
      },
      { status: 400 },
    );
  }

  const existing = await fetchRound(ctx.sb, ctx.tenantId, roundId);
  if (!existing.ok) {
    return NextResponse.json(
      { ok: false, error: existing.error },
      { status: 500 },
    );
  }
  if (!existing.round) {
    return NextResponse.json({ ok: false, error: "No such round" }, { status: 404 });
  }
  if (existing.round.status !== "draft") {
    return NextResponse.json(
      {
        ok: false,
        error:
          existing.round.status === "applied"
            ? "This round has already been applied. Build a new one."
            : "This round was cancelled.",
      },
      { status: 409 },
    );
  }

  const res = await setRoundDecisions(
    ctx.sb,
    ctx.tenantId,
    roundId,
    studentIds,
    decision,
    reason,
  );
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }

  const after = await fetchRound(ctx.sb, ctx.tenantId, roundId);
  if (!after.ok || !after.round) {
    return NextResponse.json(
      { ok: false, error: after.ok ? "Round vanished" : after.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    changed: res.changed,
    // Fewer rows changed than ids sent means somebody was not in this round.
    // Reported rather than hidden: a closed list that quietly ignores names
    // is how an office thinks it acted on a child it never touched.
    requested: studentIds.length,
    counts: countRound(after.round),
    blockers: roundBlockers(after.round),
  });
}

export async function PUT(req: Request) {
  // Applying is the act that actually withholds something.
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;
  const { ctx, response } = await tenant();
  if (!ctx) return response;

  const body = (await req.json().catch(() => null)) as { roundId?: string } | null;
  const roundId = String(body?.roundId ?? "");
  if (!roundId) {
    return NextResponse.json(
      { ok: false, error: "Send { roundId }" },
      { status: 400 },
    );
  }

  const existing = await fetchRound(ctx.sb, ctx.tenantId, roundId);
  if (!existing.ok) {
    return NextResponse.json({ ok: false, error: existing.error }, { status: 500 });
  }
  if (!existing.round) {
    return NextResponse.json({ ok: false, error: "No such round" }, { status: 404 });
  }

  const appliedBy = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const result = applyRound(existing.round, appliedBy);
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
  }

  const committed = await commitRoundDecisions(
    ctx.sb,
    ctx.tenantId,
    result.round,
    result.records,
    appliedBy,
  );
  if (!committed.ok) {
    return NextResponse.json(
      { ok: false, error: committed.error },
      { status: 500 },
    );
  }

  const counts = countRound(result.round);
  return NextResponse.json({
    ok: true,
    round: result.round,
    counts,
    written: committed.written,
    message:
      `${counts.disallow} withheld, ${counts.allow} let through. ` +
      "Families are not told by this action — send them word yourself.",
  });
}
