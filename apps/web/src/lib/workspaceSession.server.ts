/**
 * Resolve workspace academic year for login cookies from Masters desk.
 */

import { DEFAULT_AY } from "@/lib/masters";
import { fetchCurrentAcademicYearFromDesk } from "@/lib/mastersNormalized.server";

export async function resolveLoginAcademicYearCode(
  requested?: string,
): Promise<string> {
  const trimmed = requested?.trim();
  if (trimmed) return trimmed;
  const fromDesk = await fetchCurrentAcademicYearFromDesk();
  return fromDesk || DEFAULT_AY;
}
