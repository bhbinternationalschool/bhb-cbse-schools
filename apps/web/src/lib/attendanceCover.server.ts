import "server-only";

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import {
  CLASS_COORDINATORS_KEY,
  coverSectionsFor,
  normalizeClassCoordinators,
  todayIst,
  type ClassCoordinatorsState,
  type CoverSection,
} from "@/lib/attendanceCover";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * The co-ordinator assignments — one module_local_state row, written only
 * through /api/v1/staff/coordinators (server truth; no browser copy).
 * null = the read failed: unknown, never "none".
 */
export async function readClassCoordinators(): Promise<{ state: ClassCoordinatorsState; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", CLASS_COORDINATORS_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[class-coordinators] read failed", error.message);
    return null;
  }
  return { state: normalizeClassCoordinators(data?.state), updatedAt: data?.updated_at ? String(data.updated_at) : "" };
}

/**
 * Saved only over the copy the editor loaded (`baseUpdatedAt`): two office
 * tabs editing at once must not silently drop each other's classes.
 */
export async function writeClassCoordinators(
  state: ClassCoordinatorsState,
  baseUpdatedAt: string,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string; conflict?: boolean }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  if (baseUpdatedAt) {
    const { data, error } = await ctx.sb
      .from("module_local_state")
      .update({ state, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("module_key", CLASS_COORDINATORS_KEY)
      .eq("updated_at", baseUpdatedAt)
      .select("updated_at");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: false, conflict: true, error: "Someone else changed the co-ordinators meanwhile — reload and try again." };
    }
    return { ok: true, updatedAt: now };
  }
  const { error } = await ctx.sb
    .from("module_local_state")
    .insert({ tenant_id: ctx.tenantId, module_key: CLASS_COORDINATORS_KEY, state, updated_at: now });
  if (error) {
    return /duplicate|unique/i.test(error.message)
      ? { ok: false, conflict: true, error: "Someone else saved co-ordinators meanwhile — reload and try again." }
      : { ok: false, error: error.message };
  }
  return { ok: true, updatedAt: now };
}

/**
 * Staff absent on `date`: marked A, leave or half day on the staff register,
 * or on approved leave covering the day. null when either could not be read.
 */
export async function absentStaffIdsOn(date: string, ay: string): Promise<Set<string> | null> {
  try {
    const [{ loadStaffAttendanceServer }, { findStaffRegister }, { readStaffHrServer }] = await Promise.all([
      import("@/lib/staffAttendance.server"),
      import("@/lib/staffAttendance"),
      import("@/lib/api/v1/staffLeave"),
    ]);
    const [att, hr] = await Promise.all([loadStaffAttendanceServer({ fresh: true }), readStaffHrServer()]);
    if (!hr.ok) return null;
    const out = new Set<string>();
    for (const m of findStaffRegister(att, date, ay)?.marks ?? []) {
      if (m.status === "A" || m.status === "LE" || m.status === "HD") out.add(m.staffId);
    }
    for (const r of hr.state.leaveRequests ?? []) {
      if (r.status === "approved" && r.fromDate <= date && date <= r.toDate) out.add(r.staffId);
    }
    return out;
  } catch (e) {
    console.warn("[attendance-cover] absence unknown:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Today's substitutions — the timetable desk's "substitutions" slice only
 * (loadTimetable() is empty on the server, and the staff app's home screen
 * asks for this on every open, so the grids are not read).
 */
async function substitutionsOn(date: string) {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return [];
    const { data, error } = await ctx.sb
      .from("timetable_desk_slices")
      .select("payload")
      .eq("tenant_id", ctx.tenantId)
      .eq("slice_key", "substitutions")
      .maybeSingle();
    if (error || !Array.isArray(data?.payload)) return [];
    const { normalizeSubstitution } = await import("@/lib/timetable");
    return (data.payload as Record<string, unknown>[])
      .map((r) => normalizeSubstitution(r))
      .filter((s): s is NonNullable<typeof s> => !!s && s.date === date);
  } catch {
    return [];
  }
}

const coverByRequest = new WeakMap<ApiAuthContext, Promise<CoverSection[]>>();

/**
 * The classes this member of staff may take attendance for TODAY beyond
 * their own: substitutions, and co-ordinator classes whose teacher is away.
 * Any read failure gives fewer classes, never more.
 */
export function attendanceCoverToday(ctx: ApiAuthContext, ay: string): Promise<CoverSection[]> {
  const hit = coverByRequest.get(ctx);
  if (hit) return hit;
  const p = (async () => {
    const staffId = ctx.session.staffId || "";
    if (ctx.session.persona !== "staff" || !staffId) return [];
    const date = todayIst();
    const [subs, coord] = await Promise.all([substitutionsOn(date), readClassCoordinators()]);
    const hasCoordinatorClasses = !!coord?.state.byStaff[staffId]?.length;
    const absent = hasCoordinatorClasses ? await absentStaffIdsOn(date, ay) : new Set<string>();
    return coverSectionsFor({
      staffId,
      date,
      academicYearCode: ay,
      substitutions: subs,
      coordinators: coord?.state ?? normalizeClassCoordinators(null),
      staff: ctx.masters.staff,
      absentStaffIds: absent,
    });
  })();
  coverByRequest.set(ctx, p);
  return p;
}

/** True when today's cover lets this session take this section's register. */
export async function coversSectionToday(ctx: ApiAuthContext, ay: string, classId: string, sectionId: string): Promise<CoverSection | null> {
  const cover = await attendanceCoverToday(ctx, ay);
  return cover.find((c) => c.classId === classId && c.sectionId === sectionId) ?? null;
}
