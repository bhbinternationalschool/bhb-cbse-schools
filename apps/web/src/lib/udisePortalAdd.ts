/**
 * The robot's "add missing children" queue: ERP children with no PEN, and
 * what to type into the UDISE+ "Add New Student" form for each
 * (#/school/<id>/new-ac/addStudent/<portalClassId>/<portalSectionId>,
 * read off the portal on 2026-10-06).
 *
 * Who is offered:
 *  - active, this session, one row per child (callers pass studentsInSession);
 *  - no real PEN, and not waiting for a transfer (a transfer has a PEN at the
 *    old school and comes in through the Dropbox, never through Add);
 *  - NOT already on the portal under the name + birth date or name + father
 *    the robot can see in the portal's own list — that child needs the
 *    portal list applied in the ERP, not a second record on UDISE+.
 *
 * UDISE+ requires the Aadhaar field to add a student (rule 4.1.7: "It is a
 * mandatory field"; admission date is optional). The portal's own code treats
 * 999999999999 as "AADHAAR not available": it clears and disables "Name as per
 * Aadhaar", and its reports print "AADHAAR not available" (read from the
 * portal's script on 2026-10-06; other schools' records already carry it). So
 * a child with no Aadhaar in the ERP is added with that value, listed under
 * `aadhaarPlaceholder` so the real number is collected and entered later. APAAR
 * cannot be generated until it is.
 *
 * The portal decides which classes may be added (on 2026-10-06: PP3 to
 * Class I only); the extension offers only classes whose "Add Student"
 * button is on the dashboard. The robot never guesses that permission.
 *
 * Same rules as the profile fill: only values the ERP really holds, the rest
 * listed for the person; never Save.
 */

import { aadhaarChecksumValid, aadhaarDigits } from "@/lib/aadhaar";

/** The portal's own "AADHAAR not available" value for the Aadhaar box. */
export const UDISE_AADHAAR_NOT_AVAILABLE = "999999999999";
import { isRealPortalId, type Household, type SisStudent } from "@/lib/sis";
import { udiseDobKey, udiseNamesCompatible } from "@/lib/udiseStudentDetails";
import type { UdiseFillField } from "@/lib/udisePortalFill";
import { sameChildEvidence } from "@/lib/udisePortalReconcile";

/** Portal classId for an ERP class name; null when the portal has no such class here. */
export function portalClassIdFor(className: string): number | null {
  const n = className.trim().toLowerCase().replace(/[\s.-]+/g, "");
  if (/^(nursery|nur|pp3|prenursery|playgroup)$/.test(n)) return -3;
  if (/^(lkg|kg1|pp2)$/.test(n)) return -2;
  if (/^(ukg|kg2|pp1)$/.test(n)) return -1;
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  const m = n.match(/^(?:class)?(\d{1,2}|[ivx]{1,4})$/);
  if (!m) return null;
  const k = m[1]!;
  const num = /^\d+$/.test(k) ? Number(k) : roman[k];
  return num && num >= 1 && num <= 12 ? num : null;
}

export type PortalListEntry = {
  studentName?: unknown;
  dob?: unknown;
  fatherName?: unknown;
  motherName?: unknown;
  primaryMobile?: unknown;
  studentCodeNat?: unknown;
};

/** Is this ERP child probably already on the portal (unapplied)? */
export function probablyOnPortal(
  s: SisStudent,
  portal: PortalListEntry[],
  householdMobiles: (s: SisStudent) => string[] = () => [],
): boolean {
  const dob = udiseDobKey(s.dob || "");
  return portal.some((p) => {
    // The same child under another name (SUHANI PATEL on the portal was
    // ANJALI PATEL in the ERP): birth date + a parent or the family phone.
    if (sameChildEvidence(p, s, householdMobiles)) return true;
    const name = String(p.studentName || "");
    if (!udiseNamesCompatible(s.fullName, name)) return false;
    if (dob && udiseDobKey(String(p.dob || "")) === dob) return true;
    const pf = String(p.fatherName || "");
    return !!s.fatherName && !!pf && udiseNamesCompatible(s.fatherName, pf);
  });
}

function dmy(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function mobile10(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}

const GENDER: Record<string, string> = { M: "1", F: "2", O: "3" };

export type UdiseAddPlan = {
  fields: UdiseFillField[];
  leftForYou: string[];
  /** Shown beside the form, never typed (a guess would become a portal fact). */
  hints: string[];
};

export function buildUdiseAddPlan(s: SisStudent, hh: Household | undefined): UdiseAddPlan {
  const fields: UdiseFillField[] = [];
  const left: string[] = [];
  const hints: string[] = [];
  const add = (f: UdiseFillField | null, missing: string) => {
    if (f && f.value) fields.push(f);
    else left.push(missing);
  };
  const name = s.fullName.trim().replace(/\s+/g, " ").toUpperCase();
  add(name ? { control: "studentName", kind: "text", value: name.slice(0, 100), label: "Student name", shown: name } : null, "Student name");
  add(GENDER[s.gender] ? { control: "gender", kind: "select", value: GENDER[s.gender]!, label: "Gender", shown: s.gender } : null, "Gender");
  const dob = dmy(s.dob);
  add(dob ? { control: "dob", kind: "text", value: dob, label: "Date of birth", shown: dob } : null, "Date of birth");
  add(s.motherName.trim() ? { control: "motherName", kind: "text", value: s.motherName.trim().toUpperCase(), label: "Mother's name", shown: s.motherName } : null, "Mother's name");
  add(s.fatherName.trim() ? { control: "fatherName", kind: "text", value: s.fatherName.trim().toUpperCase(), label: "Father's name", shown: s.fatherName } : null, "Father's name");
  const guardian = (hh?.guardianName || "").trim();
  if (guardian) fields.push({ control: "guardianName", kind: "text", value: guardian.toUpperCase(), label: "Guardian's name", shown: guardian });
  // The portal checks the Aadhaar against UIDAI; a number that fails its own
  // checksum would only come back "failed", so it is not typed.
  const aadhaar = aadhaarDigits(s.aadhaarNumber || "");
  if (aadhaar.length === 12 && aadhaarChecksumValid(aadhaar)) {
    fields.push({ control: "uuid", kind: "text", value: aadhaar, label: "Aadhaar", shown: `********${aadhaar.slice(-4)}` });
    left.push("Name as per Aadhaar (copy exactly from the card)");
  } else {
    fields.push({
      control: "uuid",
      kind: "text",
      value: UDISE_AADHAAR_NOT_AVAILABLE,
      label: "Aadhaar not available (999999999999)",
      shown: "not in the ERP",
    });
    hints.push("No Aadhaar in the ERP: entered as 999999999999, the portal's “AADHAAR not available”. Collect the real number and update UDISE+ later; APAAR cannot be made until then.");
  }
  const primary = mobile10(hh ? hh.whatsappMobile || hh.mobile : "") || mobile10(s.fatherMobile) || mobile10(s.motherMobile);
  add(primary ? { control: "primaryMobile", kind: "text", value: primary, label: "Mobile", shown: primary } : null, "Mobile");
  const second = [mobile10(s.motherMobile), mobile10(s.fatherMobile), mobile10(hh?.altMobile || "")].find((m) => m && m !== primary) || "";
  if (second) fields.push({ control: "secondaryMobile", kind: "text", value: second, label: "Alternate mobile", shown: second });
  if (s.isCwsn) fields.push({ control: "cwsnYN", kind: "radio", value: "1", label: "CWSN", shown: "Yes" });
  else left.push("CWSN (Yes/No)");
  // Optional on the portal (rule 4.1.9). The ERP's joinedOn is NOT shown or
  // filled here: until 7 Oct 2026 the student import overwrote the day of
  // most join dates with the month (2023-02-10 → 2023-02-02), so a date read
  // off the ERP would put that error on the government record.
  hints.push("Admission date is optional. If you fill it, take it from the paper admission register, not from the ERP.");
  if (s.admissionNo) hints.push(`Admission no. ${s.admissionNo}`);
  return { fields, leftForYou: left, hints };
}

export type UdiseAddCandidate = {
  studentId: string;
  name: string;
  classLabel: string;
  sectionName: string;
  portalClassId: number;
} & UdiseAddPlan;

/** The add queue, before the extension narrows it to classes the portal allows. */
export function listUdiseAddCandidates(input: {
  students: SisStudent[];
  portal: PortalListEntry[];
  classLabelOf: (s: SisStudent) => { className: string; sectionName: string };
  householdOf: (s: SisStudent) => Household | undefined;
}): { candidates: UdiseAddCandidate[]; alreadyOnPortal: string[]; noPortalClass: string[]; aadhaarPlaceholder: string[] } {
  const candidates: UdiseAddCandidate[] = [];
  const alreadyOnPortal: string[] = [];
  const noPortalClass: string[] = [];
  const aadhaarPlaceholder: string[] = [];
  for (const s of input.students) {
    if (s.status !== "active" || isRealPortalId(s.pen) || s.udiseInboundTransferPending) continue;
    const { className, sectionName } = input.classLabelOf(s);
    const portalClassId = portalClassIdFor(className);
    if (portalClassId === null) {
      noPortalClass.push(`${s.fullName} (${className || "no class"})`);
      continue;
    }
    if (probablyOnPortal(s, input.portal, (x) => {
      const h = input.householdOf(x);
      return h ? [h.whatsappMobile, h.mobile, h.altMobile] : [];
    })) {
      alreadyOnPortal.push(`${s.fullName} (${className})`);
      continue;
    }
    const digits = aadhaarDigits(s.aadhaarNumber || "");
    if (!(digits.length === 12 && aadhaarChecksumValid(digits))) aadhaarPlaceholder.push(`${s.fullName} (${className})`);
    candidates.push({
      studentId: s.id,
      name: s.fullName,
      classLabel: [className, sectionName].filter(Boolean).join(" "),
      sectionName,
      portalClassId,
      ...buildUdiseAddPlan(s, input.householdOf(s)),
    });
  }
  candidates.sort((a, b) => a.portalClassId - b.portalClassId || a.name.localeCompare(b.name));
  return { candidates, alreadyOnPortal, noPortalClass, aadhaarPlaceholder };
}
