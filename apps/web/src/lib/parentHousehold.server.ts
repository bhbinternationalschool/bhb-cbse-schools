/**
 * Strict household lookup by mobile — for the paths where the answer
 * decides identity, not presentation.
 *
 * resolveParentHousehold() in lib/parentPortal.ts never returns null: an
 * unmatched mobile falls through to the demo household and then to
 * "whichever household has the most active children". That is survivable
 * for a portal screen already inside a session, and was not survivable in
 * the OTP routes, where it meant any number that received its own code
 * was handed a signed session for a real, unrelated family.
 *
 * This module answers the identity question only, and answers it three
 * ways: the household, null, or a thrown-away null with a warning when
 * the roster could not be read. "Not found" is never inferred from an
 * empty or stale cache — the database is asked before a real parent is
 * turned away, the same rule the WhatsApp bot now follows.
 */

import { loadSis, type Household, type SisState, type SisStudent } from "@/lib/sis";
import { setMirrorSlice } from "@/lib/schoolDataMirror";

/** Normalize to the bare 10 digits the roster stores. */
export function householdMobile10(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d.slice(-10);
}

/**
 * The household this mobile belongs to, in the loaded roster — or null.
 *
 * Checks the household's own three numbers first, then either parent's
 * number on a student row: a household whose contact number was left
 * blank (or a placeholder) is still reachable through its children, and
 * those parents must be able to sign in as themselves rather than be
 * refused or, worse, resolved to someone else.
 */
export function findHouseholdByMobileStrict(
  sis: SisState,
  mobile: string,
): Household | null {
  const m = householdMobile10(mobile);
  if (m.length !== 10) return null;

  const byHousehold = (sis.households ?? []).find(
    (h) =>
      householdMobile10(h.mobile) === m ||
      householdMobile10(h.whatsappMobile) === m ||
      householdMobile10(h.altMobile) === m,
  );
  if (byHousehold) return byHousehold;

  const student = (sis.students ?? []).find(
    (s) =>
      s.status === "active" &&
      (householdMobile10(s.fatherMobile) === m ||
        householdMobile10(s.motherMobile) === m),
  );
  if (!student?.householdId) return null;
  return (sis.households ?? []).find((h) => h.id === student.householdId) || null;
}

/**
 * Seed a household and its children into the server mirror, so whatever
 * runs next — the parent bot's own household lookup, a fee or receipt
 * answer — resolves the same person from the same place.
 */
export function patchMirrorHousehold(
  household: Household,
  students: SisStudent[],
) {
  const sis = loadSis();
  const studentIds = new Set(students.map((s) => s.id));
  setMirrorSlice("sis", {
    ...sis,
    households: [
      ...(sis.households ?? []).filter((h) => h.id !== household.id),
      household,
    ],
    students: [
      ...(sis.students ?? []).filter((s) => !studentIds.has(s.id)),
      ...students,
    ],
  });
}

/**
 * The household this mobile belongs to: the loaded roster first, the
 * database second. Null means the roster genuinely has no such number —
 * never "the cache had not caught up yet", and never a stand-in family.
 */
export async function resolveHouseholdByMobileServer(
  mobile: string,
): Promise<{ household: Household; students: SisStudent[] } | null> {
  const mobile10 = householdMobile10(mobile);
  if (mobile10.length !== 10) return null;

  const sis = loadSis();
  const cached = findHouseholdByMobileStrict(sis, mobile10);
  if (cached) {
    return {
      household: cached,
      students: (sis.students ?? []).filter((s) => s.householdId === cached.id),
    };
  }

  try {
    const { fetchSisHouseholdByMobileFromDb } = await import(
      "@/lib/sisNormalized.server"
    );
    const found = await fetchSisHouseholdByMobileFromDb(mobile10);
    if (!found) return null;
    patchMirrorHousehold(found.household, found.students);
    return found;
  } catch (e) {
    console.warn("[household] database lookup failed", e);
    return null;
  }
}
