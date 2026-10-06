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
 * The portal decides which classes may be added (on 2026-10-06: PP3 to
 * Class I only); the extension offers only classes whose "Add Student"
 * button is on the dashboard. The robot never guesses that permission.
 *
 * Same rules as the profile fill: only values the ERP really holds, the rest
 * listed for the person; never Save.
 */

import { aadhaarChecksumValid, aadhaarDigits } from "@/lib/aadhaar";
import { isRealPortalId, type Household, type SisStudent } from "@/lib/sis";
import { udiseDobKey, udiseNamesCompatible } from "@/lib/udiseStudentDetails";
import type { UdiseFillField } from "@/lib/udisePortalFill";

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

export type PortalListEntry = { studentName?: unknown; dob?: unknown; fatherName?: unknown };

/** Is this ERP child probably already on the portal (unapplied)? */
export function probablyOnPortal(s: SisStudent, portal: PortalListEntry[]): boolean {
  const dob = udiseDobKey(s.dob || "");
  return portal.some((p) => {
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
    left.push("Name as per Aadhaar (copy from the card)");
  } else {
    left.push("Aadhaar (not in the ERP — may be left blank and added later)");
  }
  const primary = mobile10(hh ? hh.whatsappMobile || hh.mobile : "") || mobile10(s.fatherMobile) || mobile10(s.motherMobile);
  add(primary ? { control: "primaryMobile", kind: "text", value: primary, label: "Mobile", shown: primary } : null, "Mobile");
  const second = [mobile10(s.motherMobile), mobile10(s.fatherMobile), mobile10(hh?.altMobile || "")].find((m) => m && m !== primary) || "";
  if (second) fields.push({ control: "secondaryMobile", kind: "text", value: second, label: "Alternate mobile", shown: second });
  if (s.isCwsn) fields.push({ control: "cwsnYN", kind: "radio", value: "1", label: "CWSN", shown: "Yes" });
  else left.push("CWSN (Yes/No)");
  left.push("Admission date");
  if (s.joinedOn) hints.push(`ERP says joined this session on ${dmy(s.joinedOn) || s.joinedOn} — use the admission register date.`);
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
}): { candidates: UdiseAddCandidate[]; alreadyOnPortal: string[]; noPortalClass: string[] } {
  const candidates: UdiseAddCandidate[] = [];
  const alreadyOnPortal: string[] = [];
  const noPortalClass: string[] = [];
  for (const s of input.students) {
    if (s.status !== "active" || isRealPortalId(s.pen) || s.udiseInboundTransferPending) continue;
    const { className, sectionName } = input.classLabelOf(s);
    const portalClassId = portalClassIdFor(className);
    if (portalClassId === null) {
      noPortalClass.push(`${s.fullName} (${className || "no class"})`);
      continue;
    }
    if (probablyOnPortal(s, input.portal)) {
      alreadyOnPortal.push(`${s.fullName} (${className})`);
      continue;
    }
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
  return { candidates, alreadyOnPortal, noPortalClass };
}
