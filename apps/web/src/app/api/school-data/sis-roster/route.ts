import { NextResponse } from "next/server";
import { stripEmptyList } from "@/lib/wirePayload";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { SisState } from "@/lib/sis";
import { sisDualWriteDbEnabled } from "@/lib/sisDbConfig";
import {
  deleteSisRecordsInDb,
  fetchSisFromDb,
  pushSisToDb,
} from "@/lib/sisNormalized.server";

export const runtime = "nodejs";

/** GET — pull SIS roster from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["sis-roster"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchSisFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "SIS roster fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  // Same lossless strip as admissions — normalizeStudent defaults absent
  // fields to "" exactly as an empty value would. See lib/wirePayload.ts.
  const lean = process.env.LEAN_WIRE_PAYLOAD?.trim().toLowerCase();
  const leanOn = lean === "true" || lean === "1";

  return NextResponse.json({
    ok: true,
    households: leanOn
      ? stripEmptyList(bundle.households as unknown as Record<string, unknown>[])
      : bundle.households,
    students: leanOn
      ? stripEmptyList(bundle.students as unknown as Record<string, unknown>[])
      : bundle.students,
    householdCount: bundle.households.length,
    studentCount: bundle.students.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type RosterPostBody = Pick<SisState, "households" | "students"> & {
  /**
   * Ids the user explicitly removed. Deletions have to be stated, not
   * inferred from what is absent in the snapshot — inference is how a
   * partial payload wipes a roster.
   */
  deleteStudentIds?: string[];
  deleteHouseholdIds?: string[];
};

/** POST — push full SIS roster snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["sis-roster"], "POST");
  if (!auth.ok) return auth.response
  if (!sisDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "SIS_DUAL_WRITE_DB disabled",
    });
  }

  let body: RosterPostBody;
  try {
    body = (await req.json()) as RosterPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletes run BEFORE the upsert: the roster in this same payload no longer
  // contains the removed rows, so upserting first then deleting would be a
  // no-op ordering hazard if the two ever disagreed.
  const removed = await deleteSisRecordsInDb({
    studentIds: Array.isArray(body.deleteStudentIds) ? body.deleteStudentIds : [],
    householdIds: Array.isArray(body.deleteHouseholdIds)
      ? body.deleteHouseholdIds
      : [],
  });
  if (!removed.ok) {
    return NextResponse.json(
      { ok: false, error: removed.error || "Delete failed" },
      { status: 502 },
    );
  }

  const result = await pushSisToDb({
    households: Array.isArray(body.households) ? body.households : [],
    students: Array.isArray(body.students) ? body.students : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    householdCount: result.householdCount,
    studentCount: result.studentCount,
    // Records another user changed since this client last read them. They
    // were deliberately not overwritten; the client warns and re-hydrates.
    conflicts: result.conflicts ?? [],
    guarded: result.guarded ?? false,
    // Authoritative versions so the client can re-stamp what it just wrote.
    studentVersions: result.studentVersions ?? {},
    householdVersions: result.householdVersions ?? {},
    updatedAt: new Date().toISOString(),
  });
}
