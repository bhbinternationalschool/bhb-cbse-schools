/**
 * The UI reports what a human did with an AI draft — closes the loop on
 * ai_generations so acceptance/edit/reject rates per route and per prompt
 * version are queryable. Staff only; only rows of this tenant are touched;
 * unknown ids are a no-op.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { setAiGenerationOutcome, type AiOutcome } from "@/lib/aiGenerations.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  let body: {
    ids?: unknown;
    id?: unknown;
    outcome?: unknown;
    targetType?: unknown;
    targetId?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const outcome = body.outcome;
  if (outcome !== "accepted" && outcome !== "edited" && outcome !== "rejected") {
    return NextResponse.json({ error: "outcome must be accepted | edited | rejected" }, { status: 400 });
  }
  const ids = (Array.isArray(body.ids) ? body.ids : [body.id])
    .map((x) => String(x ?? "").trim())
    .filter((x) => /^aig_[a-z0-9]{8,32}$/i.test(x))
    .slice(0, 50);
  if (ids.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }
  const targetType = String(body.targetType ?? "").slice(0, 60);
  const targetId = String(body.targetId ?? "").slice(0, 120);
  const results = await Promise.all(
    ids.map((id) =>
      setAiGenerationOutcome({ id, outcome: outcome as AiOutcome, targetType, targetId }),
    ),
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    return NextResponse.json({ ok: false, error: failed[0].error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: ids.length });
}
