import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import type { RteState } from "@/lib/rteEws";
import { rteDualWriteDbEnabled } from "@/lib/rteDbConfig";
import {
  fetchRteDeskFromDb,
  pushRteDeskToDb,
  RTE_DELETABLE_TABLES,
  RTE_TABLE_SLICES,
} from "@/lib/rteNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding RTE functions only (e.g. Govt list &
  // admissions) — their slices; the rest comes back empty.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["rte-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchRteDeskFromDb();
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("rte", full, gate) : full;
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "RTE desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    seats: bundle.seats,
    applications: bundle.applications,
    settings: bundle.settings,
    seatCount: bundle.seats?.length ?? 0,
    applicationCount: bundle.applications?.length ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type RteDeskPostBody = Pick<RteState, "seats" | "applications" | "settings"> & { deletes?: unknown };

export async function POST(req: Request) {
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["rte-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!rteDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "RTE_DUAL_WRITE_DB disabled",
    });
  }

  let body: RteDeskPostBody;
  try {
    body = (await req.json()) as RteDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, RTE_DELETABLE_TABLES);

  // Function-only writers (director, 6 Oct 2026 — e.g. RTE → Govt list &
  // admissions): merged onto the stored desk, their functions' slices only,
  // row by row — never the body as sent. A desk we cannot read is unknown,
  // not empty: nothing is written.
  if (gate.mode === "feature") {
    const stored = await fetchRteDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved RTE desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "rte", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, RTE_TABLE_SLICES, stored.bundle, merged.state);
    body = merged.state as unknown as RteDeskPostBody;
  }

  const result = await pushRteDeskToDb({
    version: 1,
    seats: Array.isArray(body.seats) ? body.seats : [],
    applications: Array.isArray(body.applications) ? body.applications : [],
    settings: body.settings ?? {
      mandatedPct: 25,
      autoApplyFeeWaiver: true,
      note: "",
    },
  }, deletes);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    seatCount: body.seats?.length ?? 0,
    applicationCount: body.applications?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
