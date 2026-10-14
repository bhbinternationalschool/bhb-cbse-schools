/**
 * One household's rows, read from SQL scoped to it (data-layer 4.1).
 *
 * The parent app's routes used to answer "this family's children" by
 * hydrating the whole roster into the process (`ensureSisHydratedServer`,
 * `ensureSchoolMirrorHydrated`: every household, every student row of every
 * year) and filtering it in Node. These read only the family's rows.
 *
 * - The SQL filters on `household_id`; the result is filtered again in Node,
 *   so a query that lost its filter still cannot hand a family someone
 *   else's child.
 * - Rows come back in `id` order, the order the whole-roster read had, so
 *   anything that keeps "the first row per child" keeps the same one.
 * - Each row goes through the same mapper the roster uses (`rowToStudent`,
 *   `rowToHousehold`), so a child reads exactly as the roster showed it.
 * - A failed read is `{ok:false}` — never an empty family (R6).
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";
import { rowToHousehold, rowToStudent } from "@/lib/sisNormalized.server";

export type HouseholdReadFail = { ok: false; reason: string };

type StudentRow = Parameters<typeof rowToStudent>[0];
type HouseholdRow = Parameters<typeof rowToHousehold>[0];

/** A family is a handful of rows; more than this is not one family. */
const MAX_ROWS = 500;

/** Every student row (all years, any status) of one household, in id order. */
export async function readHouseholdStudents(
  householdId: string,
): Promise<{ ok: true; students: SisStudent[] } | HouseholdReadFail> {
  if (!householdId) return { ok: true, students: [] };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "no tenant context" };
  const { data, error } = await ctx.sb
    .from("sis_students")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .order("id", { ascending: true })
    .limit(MAX_ROWS);
  if (error) return { ok: false, reason: error.message };
  const students = ((data ?? []) as StudentRow[])
    .map((row) => normalizeStudent(rowToStudent(row)))
    .filter((s) => s.householdId === householdId);
  return { ok: true, students };
}

/** One household row, or null when there is none. */
export async function readHousehold(
  householdId: string,
): Promise<{ ok: true; household: Household | null } | HouseholdReadFail> {
  if (!householdId) return { ok: true, household: null };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "no tenant context" };
  const { data, error } = await ctx.sb
    .from("sis_households")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", householdId)
    .limit(1);
  if (error) return { ok: false, reason: error.message };
  const row = ((data ?? []) as HouseholdRow[]).find((r) => String(r.id) === householdId);
  return { ok: true, household: row ? rowToHousehold(row) : null };
}

/** One student row by id, or null when there is none. */
export async function readStudentById(
  studentId: string,
): Promise<{ ok: true; student: SisStudent | null } | HouseholdReadFail> {
  if (!studentId) return { ok: true, student: null };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "no tenant context" };
  const { data, error } = await ctx.sb
    .from("sis_students")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", studentId)
    .limit(1);
  if (error) return { ok: false, reason: error.message };
  const row = ((data ?? []) as StudentRow[]).find((r) => String(r.id) === studentId);
  return { ok: true, student: row ? normalizeStudent(rowToStudent(row)) : null };
}
