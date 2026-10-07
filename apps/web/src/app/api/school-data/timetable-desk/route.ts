import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
} from "@/lib/deskFeatureGate.server";
import type { TimetableState } from "@/lib/timetable";
import { timetableDualWriteDbEnabled } from "@/lib/timetableDbConfig";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "@/lib/timetableNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // A Timetable function holder reads the whole timetable: it is pinned on
  // every classroom wall, and building one class's grid or arranging a
  // substitute needs the bell schedule and every other grid (clashes).
  // What they may CHANGE is decided per slice on POST.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["timetable-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle, meta, ok } = await fetchTimetableDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Timetable desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    ...(gate.mode === "feature" ? { functionOnly: true } : {}),
    gridCount: bundle.grids.length,
    substitutionCount: bundle.substitutions.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["timetable-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!timetableDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TIMETABLE_DUAL_WRITE_DB disabled",
    });
  }

  let body: TimetableState;
  try {
    body = (await req.json()) as TimetableState;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Function holders (e.g. Timetable → Substitutions): merged onto the
  // stored desk, only their functions' slices — a class grid only for their
  // own classes when the function is limited to them.
  if (gate.mode === "feature") {
    const stored = await fetchTimetableDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved timetable — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "timetable", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = merged.state as unknown as TimetableState;
  }

  const result = await pushTimetableDeskToDb({
    version: 1,
    workingWeekdays: body.workingWeekdays ?? [],
    bellTemplate: body.bellTemplate ?? [],
    // Left undefined when an older page didn't send them — the writer then
    // keeps what the database already holds.
    extraBellTemplates: body.extraBellTemplates as TimetableState["extraBellTemplates"],
    classTeacherAllClassIds: body.classTeacherAllClassIds as TimetableState["classTeacherAllClassIds"],
    subjectRules: body.subjectRules as TimetableState["subjectRules"],
    grids: body.grids ?? [],
    publishedGrids: body.publishedGrids ?? [],
    substitutions: body.substitutions ?? [],
    // Not persisted by this normalized desk-slice writer (stateToSlices
    // doesn't touch it) — it rides the generic jsonb blob dual-write
    // instead (see TeacherTimeBlock's doc comment in lib/timetable.ts).
    // Included only to satisfy pushTimetableDeskToDb's TimetableState param.
    teacherTimeBlocks: body.teacherTimeBlocks ?? [],
    meta: body.meta ?? {
      status: "draft",
      publishedAt: "",
      publishedBy: "",
      generatedAt: "",
      solverStats: null,
    },
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    gridCount: body.grids?.length ?? 0,
    substitutionCount: body.substitutions?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
