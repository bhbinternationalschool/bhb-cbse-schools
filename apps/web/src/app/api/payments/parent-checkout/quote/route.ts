/**
 * Parent app — what paying the chosen dues online would cost, per way of
 * paying, BEFORE anything is created.
 *
 * Only due keys travel. The total comes from the same recomputation the
 * checkout uses, and the per-rail charge from the school's fee policy. When
 * the school absorbs every rail, `chargesParents` is false and the app skips
 * the picker entirely.
 */

import { NextResponse } from "next/server";
import {
  parentHouseholdFrom,
  quoteParentPayment,
  readDueKeys,
  resolveChosenDues,
} from "@/lib/parentFeeCheckout.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await parentHouseholdFrom(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { dueKeys?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wanted = readDueKeys(body.dueKeys);
  if (wanted.size === 0) return NextResponse.json({ error: "dueKeys required" }, { status: 400 });

  const resolved = await resolveChosenDues(auth.householdId, wanted);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const netPaise = resolved.dues.reduce((s, d) => s + d.balancePaise, 0);
  try {
    return NextResponse.json({ ok: true, ...(await quoteParentPayment(netPaise)) });
  } catch {
    // A policy that cannot be read must not stop a fee being paid: the app
    // then goes to the open checkout, which charges the fallback (free) rail.
    return NextResponse.json({ ok: true, netPaise, chargesParents: false, options: [] });
  }
}
