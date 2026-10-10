import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { stripEmptyDocsList, stripEmptyList } from "@/lib/wirePayload";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { SisState } from "@/lib/sis";
import { hasPermission } from "@/lib/rbac";
import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { sisDualWriteDbEnabled } from "@/lib/sisDbConfig";
import {
  deleteSisRecordsInDb,
  fetchSisFromDb,
  fetchSisFromDbViaIdentitySplit,
  mergeSisStudentsInDb,
  pushSisToDb,
  sisIdentitySplitEnabled,
} from "@/lib/sisNormalized.server";

export const runtime = "nodejs";

/** GET — pull SIS roster from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["sis-roster"], "GET");
  if (!auth.ok) return auth.response

  // A teacher's browser gets the children (and families) of the sections
  // they teach — not the school. Until 2026-09-29 every login with
  // students.view downloaded all ~700 students, their parents' mobiles,
  // addresses and Aadhaar last-4. A teacher cannot push SIS (students.edit),
  // so a partial copy here can never be written back over the full one.
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    const canEditStudents = hasPermission(auth.ctx.session, auth.ctx.masters, "students", "edit", auth.ctx.rbac);
    if (scope && !scope.unrestricted && !canEditStudents) {
      const { bundle, meta, ok } = sisIdentitySplitEnabled()
        ? await fetchSisFromDbViaIdentitySplit()
        : await fetchSisFromDb();
      if (!ok) {
        return NextResponse.json({ ok: false, error: "SIS roster fetch failed" }, { status: 503 });
      }
      const students = bundle.students.filter((st) =>
        scope.sections.has(sectionKey(st.classId, st.sectionId)),
      );
      const hh = new Set(students.map((st) => st.householdId));
      const households = bundle.households.filter((h) => hh.has(h.id));
      return NextResponse.json(
        {
          ok: true,
          households,
          students: stripEmptyDocsList(students as unknown as Record<string, unknown>[]),
          tags: bundle.tags,
          classUpgrades: [],
          householdCount: households.length,
          studentCount: students.length,
          scopedToTeacher: true,
          updatedAt: meta?.updatedAt || "",
          meta,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  try {
    const result = await cachedDeskJson({
      cacheKey: "sis-roster",
      tables: ["sis_students", "sis_households", "sis_enrollments", "sis_student_identities"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const { bundle, meta, ok } = sisIdentitySplitEnabled()
          ? await fetchSisFromDbViaIdentitySplit()
          : await fetchSisFromDb();
        if (!ok) throw new Error("SIS roster fetch failed — tenant/db unavailable");
        // Same lossless strip as admissions — normalizeStudent defaults absent
        // fields to "" exactly as an empty value would. See lib/wirePayload.ts.
        const lean = process.env.LEAN_WIRE_PAYLOAD?.trim().toLowerCase();
        const leanOn = lean === "true" || lean === "1";

        // The empty document skeleton is stripped unconditionally, not
        // behind the flag. It is 40% of this payload — 4,991 slots across
        // 713 students, every one of them empty — and `loadSis()` normalises
        // every student on every read, so the browser rebuilds it exactly.
        // `sisWirePayload.selftest` asserts that round trip against the real
        // normaliser, which is why this does not need a flag to hide behind.
        const students = stripEmptyDocsList(
          bundle.students as unknown as Record<string, unknown>[],
        );

        return {
          ok: true,
          households: leanOn
            ? stripEmptyList(bundle.households as unknown as Record<string, unknown>[])
            : bundle.households,
          students: leanOn ? stripEmptyList(students) : students,
          // Tag definitions and the post-admission move history. Not stripped:
          // both are small, and `isActive: false` on a retired tag is exactly
          // the kind of falsy value stripEmptyList is documented not to touch.
          tags: bundle.tags,
          classUpgrades: bundle.classUpgrades,
          householdCount: bundle.households.length,
          studentCount: bundle.students.length,
          // Unknown meta is reported as "", not as "now" (see desk-slice route).
          updatedAt: meta?.updatedAt || "",
          meta,
        };
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "SIS roster fetch failed" },
      { status: 503 },
    );
  }
}

type RosterPostBody = Pick<SisState, "households" | "students"> &
  Partial<Pick<SisState, "tags" | "classUpgrades">> & {
  /**
   * Ids the user explicitly removed. Deletions have to be stated, not
   * inferred from what is absent in the snapshot — inference is how a
   * partial payload wipes a roster.
   */
  deleteStudentIds?: string[];
  deleteHouseholdIds?: string[];
  /** Duplicate merges: fold dropIds (and everything pointing at them) into keepId. */
  merges?: { keepId: string; dropIds: string[] }[];
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

  // Merges first (they move linked records, then delete the dropped rows),
  // then plain deletes, then the upsert: the roster in this same payload no
  // longer contains the removed rows, so upserting first would be a no-op
  // ordering hazard if the two ever disagreed.
  const merged = await mergeSisStudentsInDb(
    Array.isArray(body.merges) ? body.merges : [],
  );
  if (!merged.ok) {
    return NextResponse.json(
      { ok: false, error: merged.error || "Merge failed" },
      { status: 502 },
    );
  }

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
    // An older browser sends neither key; an empty list is upsert-nothing, so
    // it cannot clear what another browser has already stored.
    tags: Array.isArray(body.tags) ? body.tags : [],
    classUpgrades: Array.isArray(body.classUpgrades) ? body.classUpgrades : [],
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
    merged: merged.applied,
    updatedAt: new Date().toISOString(),
  });
}
