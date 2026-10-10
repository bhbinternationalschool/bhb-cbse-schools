import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { AttendanceRegister, AttendanceState } from "@/lib/attendance";
import {
  readAttendanceDeskAncillary,
  type AttendanceDeskAncillary,
} from "@/lib/attendanceDeskAncillary.server";
import {
  attendanceDualWriteDbEnabled,
  fetchAttendanceDeskFromDb,
  fetchAttendanceRegistersFromDb,
  pushAttendanceDeskToDb,
  ATTENDANCE_DELETABLE_TABLES,
  ATTENDANCE_TABLE_SLICES,
} from "@/lib/attendanceNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";
import {
  deskFeatureGateFor,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";

import { readStampsParam } from "@/lib/rowStampClient";

export const runtime = "nodejs";

type DeskBody = {
  registers?: AttendanceRegister[];
  stamps?: { registers?: Record<string, string> };
  ancillary?: Partial<AttendanceDeskAncillary>;
  count?: number;
} & Record<string, unknown>;

/** The whole-desk body narrowed to a teacher's sections — same shape. */
function scopeDeskBody(body: string, sections: Set<string>): DeskBody {
  const desk = JSON.parse(body) as DeskBody;
  const registers = (desk.registers ?? []).filter((r) =>
    sections.has(sectionKey(r.classId, r.sectionId)),
  );
  // Nudge logs carry a section but no class. Masters sections belong to one
  // class each (Section.classId), so the section id alone is enough there.
  const sectionIds = new Set([...sections].map((k) => k.split("|")[1] ?? ""));
  const ancillary = desk.ancillary
    ? {
        ...desk.ancillary,
        absentNudges: (desk.ancillary.absentNudges ?? []).filter((n) =>
          sectionIds.has(n.sectionId),
        ),
        exceptions: (desk.ancillary.exceptions ?? []).filter((x) =>
          sections.has(sectionKey(x.classId, x.sectionId)),
        ),
      }
    : desk.ancillary;
  return { ...desk, registers, ancillary, count: registers.length, stamps: stampsOf(registers, desk) };
}

/** The stamps of the registers a cut desk carries — not every register's. */
function stampsOf(registers: AttendanceRegister[], desk: DeskBody): { registers: Record<string, string> } {
  const all = desk.stamps?.registers ?? {};
  const out: Record<string, string> = {};
  for (const r of registers) if (all[r.id]) out[r.id] = all[r.id];
  return { registers: out };
}

/**
 * A function holder's copy (Attendance → Student register, Exceptions, …):
 * the lists of the functions they hold, the rest empty. The policy is the
 * school's marking cut-off — every register screen works to it — so it is
 * always served; only its owner may change it.
 */
function featureDeskBody(desk: DeskBody, gate: FeatureGate): DeskBody {
  const flat = {
    registers: desk.registers ?? [],
    absentNudges: desk.ancillary?.absentNudges ?? [],
    exceptions: desk.ancillary?.exceptions ?? [],
  };
  const cut = stripDeskForFeatures("attendance", flat, gate);
  return {
    ...desk,
    registers: cut.registers,
    stamps: stampsOf(cut.registers, desk),
    ancillary: desk.ancillary
      ? { ...desk.ancillary, absentNudges: cut.absentNudges, exceptions: cut.exceptions }
      : desk.ancillary,
    count: cut.registers.length,
    functionOnly: true,
  };
}

/** GET — pull full attendance desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["attendance-registers"], "GET");
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "attendance", "read");
    if (!gate) return auth.response;
  }
  // A teacher gets only their own sections' registers (2026-09-29). Every
  // register carries student ids and marks, and the nudges/exceptions carry
  // parents' numbers — "attendance.view" alone handed a teacher's browser
  // the whole school. Unknown scope (lookup failed) is treated as
  // restricted with no sections, never as school-wide.
  // A function holder is cut the same way, then to their functions.
  let sections: Set<string> | null = null;
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope?.unrestricted) sections = scope?.sections ?? new Set<string>();
  }
  try {
    const result = await cachedDeskJson({
      cacheKey: "attendance-registers",
      tables: ["attendance_desk_registers", "attendance_desk_marks"],
      // The shared cache and its ETag describe the WHOLE desk. A scoped
      // caller must never get a 304 against a whole-desk body its browser
      // may hold from an office login, so it always gets a fresh body.
      ifNoneMatch: sections || gate ? null : req.headers.get("if-none-match"),
      build: async () => {
        const desk = await fetchAttendanceDeskFromDb();
        if (!desk.ok) throw new Error("Attendance desk fetch failed — tenant/db unavailable");
        return {
          ok: true,
          registers: desk.registers,
          // Each register's updated_at: the browser's saves are stamped with them.
          stamps: { registers: desk.stamps },
          ancillary: desk.ancillary,
          count: desk.registers.length,
          updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
          meta: desk.meta,
        };
      },
    });
    if (gate && result.kind !== "not_modified") {
      const desk = sections ? scopeDeskBody(result.body, sections) : (JSON.parse(result.body) as DeskBody);
      return NextResponse.json(featureDeskBody(desk, gate), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (!sections || result.kind === "not_modified") return deskJsonResponse(result);
    return NextResponse.json(scopeDeskBody(result.body, sections), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Attendance desk fetch failed" },
      { status: 503 },
    );
  }
}

type DeskPostBody = Pick<AttendanceState, "registers"> &
  Partial<AttendanceDeskAncillary> & { deletes?: unknown; stamps?: unknown };

/** POST — push attendance desk snapshot (registers + policy + nudges + exceptions) */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["attendance-registers"], "POST");
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "attendance", "write");
    if (!gate) return auth.response;
  }
  // This push carries the whole student attendance desk (every class's registers, the policy and the parent nudges).
  // "attendance.edit" alone let a teacher's browser send it — a stale copy
  // could overwrite other classes' registers. Teachers save one register at
  // a time through /api/v1/attendance/mark and punch through
  // /api/v1/staff/attendance/punch; this route is the office's.
  // A function holder is held to it too — a teacher holding Student
  // register still marks one register at a time through the mark route.
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the full register. " +
            "Your own class and your own attendance are saved on their own.",
        },
        { status: 403 },
      );
    }
  }
  if (!attendanceDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ATTENDANCE_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, ATTENDANCE_DELETABLE_TABLES);
  // The registers this browser changed and the stamp each was changed from.
  const stamps = readStampsParam(body.stamps, ["registers"])?.registers;

  // Function holders (e.g. Attendance → Exceptions): merged onto the stored
  // desk, only their functions' slices — never the body as sent.
  if (gate) {
    const [regs, anc] = await Promise.all([
      fetchAttendanceRegistersFromDb(),
      readAttendanceDeskAncillary(),
    ]);
    if (!regs.ok || !anc.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved attendance desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const stored = { registers: regs.registers, ...anc.ancillary };
    const merged = featurePushOutcome(gate, "attendance", stored, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, ATTENDANCE_TABLE_SLICES, stored, merged.state);
    body = merged.state as unknown as DeskPostBody;
  }

  const result = await pushAttendanceDeskToDb({
    registers: Array.isArray(body.registers) ? body.registers : [],
    policy: body.policy,
    absentNudges: body.absentNudges ?? [],
    exceptions: body.exceptions ?? [],
  }, deletes, stamps);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const answer = {
    stamps: { registers: result.stamps ?? {} },
    conflicts: result.conflicts?.length ? { registers: result.conflicts } : {},
  };
  if (gate) {
    const saved = featureSavedResponse(true);
    return NextResponse.json({ ...(await saved.json()), ...answer }, { status: saved.status });
  }
  return NextResponse.json({
    ok: true,
    ...answer,
    count: result.registerCount,
    updatedAt: new Date().toISOString(),
  });
}
