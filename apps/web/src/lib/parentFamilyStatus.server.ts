/**
 * Is a parent's family still on roll? (director, 10 Oct 2026)
 *
 * When the school makes every child of a family inactive, the parent app is
 * closed to that family: no login code is sent, an open session is refused,
 * and the app says to contact the school to be made active again. A family
 * with at least one child on roll is not affected.
 *
 * Read straight from sis_students (a few rows per family), cached for five
 * minutes per family so every app request does not query. A failed read is
 * "unknown" and never blocks anyone — unknown is not "inactive".
 */

import { childrenOnRoll } from "@/lib/appPopups";
import type { SisStudent } from "@/lib/sis";
import { getServerTenantContext } from "@/lib/serverTenant";

export const FAMILY_INACTIVE_MESSAGE =
  "The school has marked your child's admission inactive, so the app is closed for this family. Please contact the school office to make it active again. / " +
  "स्कूल ने आपके बच्चे का प्रवेश निष्क्रिय (inactive) कर दिया है, इसलिए इस परिवार के लिए ऐप बंद है। फिर से सक्रिय कराने के लिए कृपया स्कूल कार्यालय से संपर्क करें।";

export type FamilyRollStatus = "on_roll" | "inactive" | "unknown";

/**
 * From a family's student rows: "inactive" only when the family has children
 * on record and none of them is on roll (see childrenOnRoll). A family with
 * no rows at all is "unknown" — that is a lookup question, not a decision
 * the school made.
 */
export function familyRollStatus(rows: SisStudent[], sessionAy: string): FamilyRollStatus {
  if (!rows.length) return "unknown";
  return childrenOnRoll(rows, sessionAy).length ? "on_roll" : "inactive";
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; status: FamilyRollStatus }>();

export async function readFamilyRollStatus(householdId: string, sessionAy: string): Promise<FamilyRollStatus> {
  if (!householdId) return "unknown";
  const key = `${householdId}|${sessionAy}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const ctx = await getServerTenantContext();
  if (!ctx) return "unknown";
  const { data, error } = await ctx.sb
    .from("sis_students")
    .select("id, household_id, admission_no, academic_year_code, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .limit(200);
  if (error) return "unknown";
  const rows = (data ?? []).map(
    (r) =>
      ({
        id: String(r.id),
        householdId: String(r.household_id ?? ""),
        admissionNo: String(r.admission_no ?? ""),
        academicYearCode: String(r.academic_year_code ?? ""),
        status: r.status === "active" ? "active" : "inactive",
      }) as unknown as SisStudent,
  );
  const status = familyRollStatus(rows, sessionAy);
  cache.set(key, { at: Date.now(), status });
  return status;
}
