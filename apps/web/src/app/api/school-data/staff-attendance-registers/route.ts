import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { StaffAttendanceState } from "@/lib/staffAttendance";
import {
  deskFeatureGateFor,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import {
  readStaffAttendanceSettings,
  type StaffAttendanceDeskAncillary,
} from "@/lib/staffAttendanceDeskAncillary.server";
import {
  fetchStaffAttendanceDeskFromDb,
  pushStaffAttendanceDeskToDb,
  staffAttendanceDualWriteDbEnabled,
} from "@/lib/staffAttendanceNormalized.server";

import { readStampsParam } from "@/lib/rowStampClient";

export const runtime = "nodejs";

/** GET — pull full staff attendance desk from normalized tables */
/**
 * This desk's keys are named "staff/<key>" in the Attendance functions
 * (lib/rbacFeatureCatalog/academics.ts) so they never meet the student
 * register desk's — both are module "attendance", and both have "registers".
 */
const STAFF_PREFIX = "staff/";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["staff-attendance-registers"], "GET");
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "attendance", "read");
    if (!gate) return auth.response;
  }
  const desk = await fetchStaffAttendanceDeskFromDb();
  if (!desk.ok) {
    return NextResponse.json(
      { ok: false, error: "Staff attendance desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  // A teacher (attendance.view) used to download every colleague's daily
  // attendance and outdoor duty. Outside the office/leadership: own rows only.
  let registers = desk.registers;
  let outdoorDuty = desk.ancillary.outdoorDuty;
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope?.unrestricted) {
      const me = scopeCtx.session.staffId || "";
      registers = desk.registers.map((r) => ({ ...r, marks: r.marks.filter((m) => !!me && m.staffId === me) }));
      outdoorDuty = (outdoorDuty ?? []).filter((o) => !!me && o.staffId === me);
    }
  }
  // A function holder (Attendance → Staff register / Staff rules) gets the
  // lists of the functions they hold. The settings are the punch rules
  // every staff screen works to, so they are always served.
  if (gate) {
    const cut = stripDeskForFeatures("attendance", { registers, outdoorDuty }, gate, {
      prefix: STAFF_PREFIX,
    });
    registers = cut.registers;
    outdoorDuty = cut.outdoorDuty;
  }
  // Each register's updated_at (only for the registers served): the
  // browser's saves are stamped with them.
  const served = new Set(registers.map((r) => r.id));
  const stamps = { registers: Object.fromEntries(Object.entries(desk.stamps).filter(([id]) => served.has(id))) };
  return NextResponse.json({
    ok: true,
    registers,
    stamps,
    ancillary: { ...desk.ancillary, outdoorDuty },
    settings: desk.ancillary.settings,
    outdoorDuty,
    ...(gate ? { functionOnly: true } : {}),
    count: desk.registers.length,
    updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
    meta: desk.meta,
  });
}

type DeskPostBody = Pick<StaffAttendanceState, "registers" | "settings"> &
  Partial<StaffAttendanceDeskAncillary> & { stamps?: unknown };


/** POST — push staff attendance desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["staff-attendance-registers"], "POST");
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "attendance", "write");
    if (!gate) return auth.response;
  }
  // This push carries the whole staff attendance register (every member of staff).
  // "attendance.edit" alone let a teacher's browser send it — a stale copy
  // could overwrite other classes' registers. Teachers save one register at
  // a time through /api/v1/attendance/mark and punch through
  // /api/v1/staff/attendance/punch; this route is the office's.
  // A function holder is held to it too: the function says what may change,
  // not that a teacher's browser may push every colleague's register.
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
  if (!staffAttendanceDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "STAFF_ATTENDANCE_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The registers this browser changed and the stamp each was changed from.
  const stamps = readStampsParam(body.stamps, ["registers"])?.registers;

  // Function holders: merged onto the stored desk, only their functions'
  // slices — never the body as sent.
  if (gate) {
    const [desk, settings] = await Promise.all([
      fetchStaffAttendanceDeskFromDb(),
      readStaffAttendanceSettings(),
    ]);
    if (!desk.ok || !settings.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved staff register — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const stored = {
      registers: desk.registers,
      settings: settings.settings,
      outdoorDuty: desk.ancillary.outdoorDuty ?? [],
    };
    const merged = featurePushOutcome(gate, "attendance", stored, body, undefined, {
      prefix: STAFF_PREFIX,
    });
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = merged.state as unknown as DeskPostBody;
  }

  const result = await pushStaffAttendanceDeskToDb({
    registers: Array.isArray(body.registers) ? body.registers : [],
    settings: body.settings,
    outdoorDuty: Array.isArray(body.outdoorDuty) ? body.outdoorDuty : [],
  }, stamps);
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
    outdoorDutyCount: result.outdoorDutyCount ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
