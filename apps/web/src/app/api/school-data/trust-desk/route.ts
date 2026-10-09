import { NextResponse } from "next/server";
import { readRevsParam } from "@/lib/sliceRevMerge";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import type { TrustLabourEntry, TrustState } from "@/lib/trust";
import { trustDualWriteDbEnabled } from "@/lib/trustDbConfig";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
  TRUST_SLICE_KEYS,
} from "@/lib/trustNormalized.server";

export const runtime = "nodejs";

/**
 * A function-only save may record labour, never pay it. Paying writes a cost
 * line and a cash or bank posting on other desks that a function holder
 * cannot save, so a "paid" flag from one would say a wage was paid that the
 * books never saw. And a paid entry is in the books: only the Trust grant
 * changes or removes it. Returns the refusal, or null.
 */
function labourPaymentRefusal(
  stored: TrustLabourEntry[],
  merged: TrustLabourEntry[],
): string | null {
  const before = new Map(stored.map((l) => [l.id, l]));
  const after = new Map(merged.map((l) => [l.id, l]));
  for (const [id, prev] of before) {
    if (prev.paidStatus !== "paid") continue;
    const next = after.get(id);
    if (!next || JSON.stringify(next) !== JSON.stringify(prev)) {
      return "A paid labour entry is in the accounts — only someone with the whole Trust module can change or remove it.";
    }
  }
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (next.paidStatus === "paid") {
      return "Paying labour posts to the accounts — ask someone with the whole Trust module to pay it.";
    }
  }
  return null;
}

export async function GET(req: Request) {
  // The whole desk, or — holding Trust functions only — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["trust-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchTrustDeskFromDb();
  // Projects and their work items are the frame every register hangs on
  // (the project picker on each tab), so any Trust function reads them;
  // only "Projects & works" may change them — the POST merge sees to that.
  const bundle =
    gate.mode === "feature"
      ? {
          ...stripDeskForFeatures("trust", full, gate),
          projects: full.projects,
          workItems: full.workItems,
        }
      : full;
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Trust desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    projectCount: bundle.projects.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["trust-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!trustDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TRUST_DUAL_WRITE_DB disabled",
    });
  }

  let body: TrustState & { revs?: unknown };
  try {
    body = (await req.json()) as TrustState & { revs?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Which rows this browser changed, and from which `_rev`. Absent = an older
  // browser: its rows win as before.
  const revs = readRevsParam(body.revs, TRUST_SLICE_KEYS);

  // Function-only writers (e.g. Trust → Site materials): merged onto the
  // stored desk, only their functions' slices — never the body as sent.
  // Bills, cost lines and contractors belong to no writing function, so a
  // function save can never touch them.
  if (gate.mode === "feature") {
    const stored = await fetchTrustDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved trust desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "trust", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    const next = merged.state as unknown as TrustState;
    const refusal = labourPaymentRefusal(stored.bundle.labourEntries ?? [], next.labourEntries ?? []);
    if (refusal) {
      return NextResponse.json(
        { ok: false, error: refusal, reason: "feature_forbidden" },
        { status: 403 },
      );
    }
    body = next;
  }

  const result = await pushTrustDeskToDb({
    version: 1,
    projects: body.projects ?? [],
    workItems: body.workItems ?? [],
    materials: body.materials ?? [],
    labourEntries: body.labourEntries ?? [],
    allotments: body.allotments ?? [],
    contractors: body.contractors ?? [],
    workOrders: body.workOrders ?? [],
    raBills: body.raBills ?? [],
    costLines: body.costLines ?? [],
    rateCard: body.rateCard ?? [],
  }, { revs });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") {
    // No desk revision for a function holder, on purpose — but its rows'
    // new versions, so its next edit is made from the version it wrote.
    return NextResponse.json({
      ok: true,
      functionOnly: true,
      changed: true,
      revs: result.revs ?? {},
      conflicts: result.conflicts ?? {},
    });
  }
  return NextResponse.json({
    ok: true,
    // New `_rev` of each row written, and rows refused because they changed
    // elsewhere first — the browser updates its versions / reloads.
    revs: result.revs ?? {},
    conflicts: result.conflicts ?? {},
    projectCount: body.projects?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
