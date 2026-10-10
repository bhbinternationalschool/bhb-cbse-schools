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
  RTE_STAMPED_SLICES,
  RTE_TABLE_SLICES,
} from "@/lib/rteNormalized.server";
import { readStampsParam, type RowStamps } from "@/lib/rowStampClient";
import { stampsForServerMerge } from "@/lib/deskStamps.server";
import { rowFingerprint } from "@/lib/sliceRevClient";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding RTE functions only (e.g. Govt list &
  // admissions) — their slices; the rest comes back empty.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["rte-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok, stamps, settingsStamp } = await fetchRteDeskFromDb();
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
    stamps,
    settingsStamp,
  });
}

type RteDeskPostBody = Pick<RteState, "seats" | "applications" | "settings"> & {
  deletes?: unknown;
  stamps?: unknown;
  settingsBase?: string | null;
};

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
  // No stamps = a tab from before 10 Oct 2026: it may add, never replace.
  let stamps: RowStamps | undefined = readStampsParam(body.stamps, RTE_STAMPED_SLICES);
  let settingsBase: string | null = typeof body.settingsBase === "string" ? body.settingsBase : null;

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
    // Merged onto the copy just read: what differs from it goes at the
    // stamps that read returned.
    stamps = {
      seats: stampsForServerMerge(stored.bundle.seats, body.seats ?? [], stored.stamps?.seats),
      applications: stampsForServerMerge(stored.bundle.applications, body.applications ?? [], stored.stamps?.applications),
    };
    settingsBase =
      rowFingerprint(stored.bundle.settings) !== rowFingerprint(body.settings) ? (stored.settingsStamp ?? "") : null;
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
  }, deletes, { stamps, settingsBase });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") {
    // A row another device changed between our read and our write stands.
    if (Object.values(result.conflicts ?? {}).some((ids) => ids.length)) {
      return NextResponse.json(
        { ok: false, error: "Someone changed this RTE record a moment ago — reload and re-apply your change.", reason: "stale" },
        { status: 409 },
      );
    }
    return featureSavedResponse(true);
  }
  return NextResponse.json({
    ok: true,
    seatCount: body.seats?.length ?? 0,
    applicationCount: body.applications?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
  });
}
