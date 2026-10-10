/**
 * Who on the UDISE+ list is who in the ERP — even under a different name.
 *
 * Found on 2026-10-06: three children on the school's portal list matched
 * no active ERP child by PEN or name, and all three were in the ERP all along:
 *  - KAVYA JOSHI was "KAVYA" (surname never typed), and had left;
 *  - SUHANI PATEL was "ANJALI PATEL" (another name entirely), ERP PEN "0";
 *  - SIYA SAURABH DIXIT was AKSHITA DIXIT — who was ALSO on the portal under
 *    her own PEN: one child entered twice on UDISE+;
 *  - SHREYANSH PATEL matched only on first name + both parents: his birth
 *    date differs by nine days between the two systems.
 * A name is not an identity. A birth date plus a parent, or a birth date
 * plus the family's mobile, is — within one school's roll.
 *
 * Pure: the caller passes the portal list and EVERY ERP row (all years, any
 * status), and gets back what to do about each portal child the plain PEN
 * match could not place.
 */

import { isRealPortalId, type SisStudent } from "@/lib/sis";
import { udiseDobKey } from "@/lib/udiseStudentDetails";

export type PortalChild = {
  studentName?: unknown;
  studentCodeNat?: unknown;
  dob?: unknown;
  gender?: unknown;
  fatherName?: unknown;
  motherName?: unknown;
  primaryMobile?: unknown;
  secondaryMobile?: unknown;
  classDesc?: unknown;
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const firstToken = (n: string) => str(n).toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((t) => t && !/^(MR|MRS|MS|SHRI|SMT|KM|LATE)$/.test(t))[0] || "";
const mobile10 = (v: string) => {
  const d = str(v).replace(/\D/g, "");
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) && !/^(\d)\1{9}$/.test(m) ? m : "";
};

function erpMobiles(s: SisStudent, householdMobiles: (s: SisStudent) => string[]): Set<string> {
  return new Set([s.fatherMobile, s.motherMobile, ...householdMobiles(s)].map(mobile10).filter(Boolean));
}

/** Why two records are the same child, or "" when they are not shown to be. */
export function sameChildEvidence(
  p: PortalChild,
  s: SisStudent,
  householdMobiles: (s: SisStudent) => string[] = () => [],
): string {
  const pen = str(p.studentCodeNat);
  if (isRealPortalId(pen) && str(s.pen) === pen) return "same PEN";
  const pd = udiseDobKey(str(p.dob));
  const sd = udiseDobKey(s.dob || "");
  const pf = firstToken(str(p.fatherName));
  const pm = firstToken(str(p.motherName));
  if (!pd || !sd || pd !== sd) {
    // A typo in the birth date (SHREYANSH PATEL: 02/11 on the portal, 11/11 in
    // the ERP). Same first name AND both parents is one child — siblings
    // share the parents but not the first name. Said aloud, so the date
    // gets fixed.
    const sameFirst = firstToken(str(p.studentName)) && firstToken(str(p.studentName)) === firstToken(s.fullName);
    if (sameFirst && pf && pm && pf === firstToken(s.fatherName) && pm === firstToken(s.motherName)) {
      return "same first name + father + mother (birth dates differ — check)";
    }
    return "";
  }
  const reasons: string[] = [];
  if (pf && pf === firstToken(s.fatherName)) reasons.push("father");
  if (pm && pm === firstToken(s.motherName)) reasons.push("mother");
  const mobs = erpMobiles(s, householdMobiles);
  if ([str(p.primaryMobile), str(p.secondaryMobile)].map(mobile10).some((m) => m && mobs.has(m))) reasons.push("mobile");
  // A birth date alone is shared by strangers; with a parent or the family's
  // phone it is one child.
  return reasons.length ? `same birth date + ${reasons.join(" + ")}` : "";
}

export type ReconcileResult = {
  /** On the portal under another name; the ERP child is active now. */
  differentName: { portalName: string; pen: string; erpName: string; erpId: string; admissionNo: string; why: string }[];
  /** On the portal as ours, but the ERP says the child left. */
  leftSchool: { portalName: string; pen: string; erpName: string; erpId: string; lastYear: string; why: string }[];
  /** Nothing in the ERP, in any year, is this child. */
  notInErp: { portalName: string; pen: string; classDesc: string }[];
  /** Two portal records that are one child (same birth date + parent/mobile). */
  portalDuplicates: { a: string; aPen: string; b: string; bPen: string; why: string }[];
};

/**
 * `portal`: the school's current-year portal list. `erpAll`: every ERP row.
 * `activeIds`: ids of the ERP's active children this session (one row per
 * child). Portal children whose PEN already sits on an active ERP child are
 * settled and skipped.
 */
export function reconcilePortalWithErp(input: {
  portal: PortalChild[];
  erpAll: SisStudent[];
  activeIds: Set<string>;
  householdMobiles?: (s: SisStudent) => string[];
}): ReconcileResult {
  const hm = input.householdMobiles ?? (() => []);
  const activePens = new Set(
    input.erpAll.filter((s) => input.activeIds.has(s.id) && isRealPortalId(s.pen)).map((s) => str(s.pen)),
  );
  const out: ReconcileResult = { differentName: [], leftSchool: [], notInErp: [], portalDuplicates: [] };

  for (const p of input.portal) {
    const pen = str(p.studentCodeNat);
    if (isRealPortalId(pen) && activePens.has(pen)) continue;
    const hits = input.erpAll
      .map((s) => ({ s, why: sameChildEvidence(p, s, hm) }))
      .filter((h) => h.why);
    const active = hits.find((h) => input.activeIds.has(h.s.id));
    if (active) {
      out.differentName.push({
        portalName: str(p.studentName),
        pen,
        erpName: active.s.fullName,
        erpId: active.s.id,
        admissionNo: active.s.admissionNo,
        why: active.why,
      });
      continue;
    }
    if (hits.length) {
      const latest = [...hits].sort((a, b) => b.s.academicYearCode.localeCompare(a.s.academicYearCode))[0]!;
      out.leftSchool.push({
        portalName: str(p.studentName),
        pen,
        erpName: latest.s.fullName,
        erpId: latest.s.id,
        lastYear: latest.s.academicYearCode,
        why: latest.why,
      });
      continue;
    }
    out.notInErp.push({ portalName: str(p.studentName), pen, classDesc: str(p.classDesc) });
  }

  // The same child entered twice on the portal: same birth date and gender,
  // and the same father or the same mobile. Twins share all of that too, so
  // this is a question for the office, never an automatic action.
  const list = input.portal;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const ad = udiseDobKey(str(a.dob));
      if (!ad || ad !== udiseDobKey(str(b.dob)) || str(a.gender) !== str(b.gender)) continue;
      const why: string[] = [];
      if (firstToken(str(a.fatherName)) && firstToken(str(a.fatherName)) === firstToken(str(b.fatherName))) why.push("father");
      const am = mobile10(str(a.primaryMobile));
      if (am && am === mobile10(str(b.primaryMobile))) why.push("mobile");
      if (why.length) {
        out.portalDuplicates.push({
          a: str(a.studentName),
          aPen: str(a.studentCodeNat),
          b: str(b.studentName),
          bPen: str(b.studentCodeNat),
          why: `same birth date + gender + ${why.join(" + ")}`,
        });
      }
    }
  }
  return out;
}
