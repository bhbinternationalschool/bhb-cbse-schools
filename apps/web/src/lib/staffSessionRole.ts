/**
 * The role code a staff session carries, decided from the roster.
 *
 * One function for every place that mints or re-checks a staff session —
 * password login, WhatsApp-OTP login, and every v1 API request — so the
 * three can never disagree. Before 2026-09-29 each login route had its own
 * copy, and a signed cookie kept whatever it was minted with for ever: a
 * cookie from before the 2026-08-14 fix still said "principal" for a
 * teacher, and nothing ever looked again.
 */

import { inferRoleCodes } from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";
import { superAdminRoleCode } from "@/lib/superAdmin";

const PRIORITY = [
  "principal",
  "admin",
  "driver",
  "accounts",
  "office",
  "transport",
  "gate",
  "teacher",
  "support",
] as const;

export function staffRoleCodeFor(
  person: { email?: string | null; fullName: string; staffId?: string },
  masters: MastersState,
  fallback = "teacher",
): string {
  const owner = superAdminRoleCode(person.email);
  if (owner) return owner;
  const codes = inferRoleCodes(
    {
      // Blank on purpose: the stale code must not feed its own regex.
      roleCode: "",
      email: person.email || undefined,
      fullName: person.fullName,
      persona: "staff",
      staffId: person.staffId,
    },
    masters,
  );
  return PRIORITY.find((c) => codes.includes(c)) ?? fallback;
}
