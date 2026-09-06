import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { ensurePaymentsHydratedServer } from "@/lib/paymentsPersistence";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { householdWhatsApp, loadSis, type SisStudent } from "@/lib/sis";

/**
 * Everything the fee screens read, hydrated once per request.
 *
 * Order matters. The school mirror carries its own `fees` slice, so
 * hydrating it *after* the fee desk would put the partial copy back and the
 * route would then price dues — and number a receipt — off an incomplete
 * book. Mirror first, fee desk last.
 */
export async function loadFeeContext() {
  await ensureSchoolMirrorHydrated();
  await Promise.all([ensureSisHydratedServer(), ensurePaymentsHydratedServer()]);
  await ensureFeesHydratedServer();
  return { sis: loadSis(), fees: loadFees(), masters: loadMasters() };
}

/**
 * Refuse to touch money unless the server is holding the whole receipt book.
 *
 * A partial fees state is not "no receipts yet" — it is an unknown, and
 * acting on it mints a receipt number that already exists (the database's
 * unique index caught exactly that during development) and shows dues the
 * family has already paid. Counts come straight from the desk table.
 */
export async function assertFeeBookComplete(
  fees: ReturnType<typeof loadFees>,
): Promise<void> {
  const { getServerTenantContext } = await import("@/lib/serverTenant");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    throw new ApiError("server_error", "Fee data is unavailable right now", 503);
  }
  const { count, error } = await ctx.sb
    .from("fee_desk_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId);
  if (error) {
    throw new ApiError("server_error", "Could not verify the receipt book", 503);
  }
  const remote = count ?? 0;
  const local = fees.vouchers?.length ?? 0;
  if (local < remote) {
    console.warn(`[staff-fees] receipt book incomplete: ${local} local vs ${remote} in the desk`);
    throw new ApiError(
      "server_error",
      "The receipt book is still loading on the server — wait a moment and try again",
      503,
    );
  }
}

export function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export type DueOut = {
  dueKey: string;
  kind: string;
  label: string;
  dueOn: string | null;
  balancePaise: number;
  balanceLabel: string;
};

export function openDuesFor(
  student: SisStudent,
  masters: ReturnType<typeof loadMasters>,
  fees: ReturnType<typeof loadFees>,
  asOf = istToday(),
): DueOut[] {
  const rows: FeeDueLine[] = openFeeDues(
    computeStudentDues(student, masters, fees, {
      asOf,
      includeFuture: false,
      includePaid: true,
    }),
  );
  return rows
    .filter((d) => d.balancePaise > 0)
    .map((d) => ({
      dueKey: d.dueKey,
      kind: d.kind,
      label: d.label,
      dueOn: d.dueOn || null,
      balancePaise: d.balancePaise,
      balanceLabel: formatInr(d.balancePaise),
    }));
}

export function classLabelOf(
  ctx: ApiAuthContext,
  student: { classId: string; sectionId: string },
): string {
  const cls = ctx.masters.classes.find((c) => c.id === student.classId)?.name || "";
  const sec = ctx.masters.sections.find((s) => s.id === student.sectionId)?.name || "";
  return `${cls} ${sec}`.trim();
}

export function householdContact(
  sis: ReturnType<typeof loadSis>,
  householdId: string,
): { guardianName: string; mobile: string } {
  const hh = sis.households.find((h) => h.id === householdId);
  return {
    guardianName: hh?.guardianName || "Guardian",
    mobile: householdWhatsApp(hh) || hh?.mobile || "",
  };
}

/**
 * Name / roll / admission-no / mobile search over active students.
 * Deliberately narrow: a fee counter on a phone should find one child, not
 * browse the school, so it caps at 25 and needs at least two characters.
 */
export function searchStudents(
  sis: ReturnType<typeof loadSis>,
  ay: string,
  q: string,
  limit = 25,
): SisStudent[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const digits = needle.replace(/\D/g, "");
  const hits: { s: SisStudent; rank: number }[] = [];
  for (const s of sis.students) {
    if (s.status !== "active" || s.academicYearCode !== ay) continue;
    const name = (s.fullName || "").toLowerCase();
    const adm = (s.admissionNo || "").toLowerCase();
    const roll = (s.rollNo || "").toLowerCase();
    const hh = sis.households.find((h) => h.id === s.householdId);
    const mob = `${hh?.mobile || ""} ${hh?.altMobile || ""}`.replace(/\D/g, "");
    let rank = -1;
    if (adm && adm === needle) rank = 0;
    else if (name.startsWith(needle)) rank = 1;
    else if (digits.length >= 4 && mob.includes(digits)) rank = 2;
    else if (name.includes(needle)) rank = 3;
    else if (adm.includes(needle)) rank = 4;
    else if (roll === needle) rank = 5;
    if (rank >= 0) hits.push({ s, rank });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.s.fullName.localeCompare(b.s.fullName))
    .slice(0, limit)
    .map((h) => h.s);
}
