/**
 * What the UDISE robot may type into a child's UDISE+ profile form
 * (GP / EP / FP stepper, sdms.udiseplus.gov.in …/new-ac/…), from the ERP.
 *
 * Keys are the form's own `formcontrolname`s; values are the portal's own
 * option codes (read off the form on 2026-10-06). The extension fills only a
 * field that is EMPTY on the portal, outlines it, and a person checks the
 * page and presses Save. It never saves, and never touches the demographic
 * block (name, gender, DOB, Aadhaar), which the portal locks behind its own
 * "change" checkbox.
 *
 * Unknown must not become fact: a field is offered only when the ERP holds a
 * real value for it. A blank, or a value the ERP fills in by default (the
 * normaliser writes "Indian" into every empty nationality), is left for the
 * person — and listed, so they know what is still theirs to type.
 */

import type { Household, SisStudent } from "@/lib/sis";

export type UdiseFillField = {
  /** The form's formcontrolname. */
  control: string;
  kind: "text" | "select" | "radio";
  value: string;
  label: string;
  /** What the ERP holds, for the person to see beside it. */
  shown: string;
};

export type UdiseFillPlan = {
  fields: UdiseFillField[];
  /** Portal questions the ERP cannot answer — the person types these. */
  leftForYou: string[];
};

const SOCIAL: Record<string, string> = { GEN: "1", SC: "2", ST: "3", OBC: "4" };

const BLOOD: Record<string, string> = {
  "A+": "1",
  "A-": "2",
  "B+": "3",
  "B-": "4",
  "O+": "5",
  "O-": "6",
  "AB+": "7",
  "AB-": "8",
};

/** Portal minorityId from the ERP religion; Hindu is "7-NA" (not a minority). */
function minorityCode(religion: string): string {
  const r = religion.trim().toLowerCase();
  if (!r) return "";
  if (/^(muslim|islam)/.test(r)) return "1";
  if (/^christian/.test(r)) return "2";
  if (/^sikh/.test(r)) return "3";
  if (/^(buddh|bauddh)/.test(r)) return "4";
  if (/^(parsi|zoroastrian)/.test(r)) return "5";
  if (/^jain/.test(r)) return "6";
  if (/^hindu/.test(r)) return "7";
  return "";
}

/**
 * Highest completed level, portal scale: 1 Primary, 2 Upper Primary,
 * 3 Secondary, 4 Higher Secondary, 5 More than HS, 6 No schooling.
 * Only wording that says so outright; anything else is left blank.
 */
export function parentEducationCode(q: string): number | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  if (/\b(illiterate|no schooling|nil|none|anpadh|unpadh)\b/.test(s)) return 6;
  if (/\b(ph\.?\s?d|post ?grad\w*|m\.?\s?a|m\.?\s?sc|m\.?\s?com|mba|mca|m\.?\s?tech|b\.?\s?ed|m\.?\s?ed|grad\w*|b\.?\s?a|b\.?\s?sc|b\.?\s?com|b\.?\s?tech|bba|bca|llb|mbbs|diploma|iti|polytechnic)\b/.test(s)) return 5;
  if (/\b(12(th)?|xii|intermediate|inter|higher secondary|hsc|senior secondary)\b/.test(s)) return 4;
  if (/\b(10(th)?|x|high ?school|matric|secondary|ssc)\b/.test(s)) return 3;
  if (/\b(8(th)?|viii|middle|junior high|upper primary)\b/.test(s)) return 2;
  if (/\b(5(th)?|v|primary)\b/.test(s)) return 1;
  return null;
}

function digits(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function mobile10(v: string): string {
  const d = digits(v);
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}

function positiveNumber(v: string, max: number): string {
  const n = Number(String(v || "").trim());
  return Number.isFinite(n) && n > 0 && n <= max ? String(Math.round(n * 10) / 10) : "";
}

export function buildUdiseFillPlan(s: SisStudent, hh: Household | undefined): UdiseFillPlan {
  const fields: UdiseFillField[] = [];
  const left: string[] = [];
  const add = (f: UdiseFillField | null, missing: string) => {
    if (f && f.value) fields.push(f);
    else left.push(missing);
  };

  // GP — contact
  const address = hh
    ? [hh.address, hh.locality, hh.landmark, hh.city].map((x) => (x || "").trim()).filter(Boolean).join(", ")
    : "";
  add(address ? { control: "address", kind: "text", value: address.slice(0, 250), label: "Address", shown: address } : null, "Address");
  const pin = digits(hh?.pincode || "");
  add(pin.length === 6 ? { control: "pincode", kind: "text", value: pin, label: "Pincode", shown: pin } : null, "Pincode");
  const primary = mobile10(hh ? hh.whatsappMobile || hh.mobile : "") || mobile10(s.fatherMobile) || mobile10(s.motherMobile);
  add(primary ? { control: "primaryMobile", kind: "text", value: primary, label: "Mobile", shown: primary } : null, "Mobile");
  const second = [mobile10(s.motherMobile), mobile10(s.fatherMobile), mobile10(hh?.altMobile || "")].find((m) => m && m !== primary) || "";
  if (second) fields.push({ control: "secondaryMobile", kind: "text", value: second, label: "Alternate mobile", shown: second });
  const email = (hh?.email || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push({ control: "email", kind: "text", value: email, label: "Email", shown: email });

  // GP — social
  add(SOCIAL[s.category] ? { control: "socCatId", kind: "select", value: SOCIAL[s.category]!, label: "Social category", shown: s.category } : null, "Social category");
  const minority = minorityCode(s.religion || "");
  add(minority ? { control: "minorityId", kind: "select", value: minority, label: "Minority group", shown: s.religion } : null, "Minority group (religion)");
  if (s.category === "EWS") fields.push({ control: "ewsYN", kind: "radio", value: "1", label: "EWS", shown: "EWS" });
  else if (SOCIAL[s.category]) fields.push({ control: "ewsYN", kind: "radio", value: "2", label: "EWS", shown: `No (category ${s.category})` });
  else left.push("EWS");
  // isCwsn is a checkbox that is false until someone ticks it: false is not "No".
  if (s.isCwsn) fields.push({ control: "cwsnYN", kind: "radio", value: "1", label: "CWSN", shown: "Yes" });
  else left.push("CWSN (Yes/No)");
  left.push("BPL / AAY", "Nationality", "Out-of-school child");

  // EP — enrolment
  const bg = BLOOD[(s.bloodGroup || "").replace(/\s+/g, "").toUpperCase()] || "";
  add(bg ? { control: "bloodGroup", kind: "select", value: bg, label: "Blood group", shown: s.bloodGroup } : null, "Blood group");
  add(s.admissionNo ? { control: "admnNumber", kind: "text", value: s.admissionNo, label: "Admission no.", shown: s.admissionNo } : null, "Admission no.");
  add(digits(s.rollNo) ? { control: "rollNumber", kind: "text", value: digits(s.rollNo), label: "Roll no.", shown: s.rollNo } : null, "Roll no.");
  left.push("Admission date", "Previous year: status, class, result, marks, attendance");

  // FP — facility / health
  const h = positiveNumber(s.heightCm, 220);
  add(h ? { control: "heightInCm", kind: "text", value: h, label: "Height (cm)", shown: s.heightCm } : null, "Height");
  const w = positiveNumber(s.weightKg, 150);
  add(w ? { control: "weightInKg", kind: "text", value: w, label: "Weight (kg)", shown: s.weightKg } : null, "Weight");
  const edu = Math.max(
    ...[s.fatherQualification, s.motherQualification]
      .map((q) => parentEducationCode(q || ""))
      .map((c) => (c === null ? -1 : c === 6 ? 0 : c)),
  );
  add(
    edu > 0
      ? { control: "parentEducation", kind: "select", value: String(edu), label: "Parent education", shown: [s.fatherQualification, s.motherQualification].filter(Boolean).join(" / ") }
      : edu === 0
        ? { control: "parentEducation", kind: "select", value: "6", label: "Parent education", shown: [s.fatherQualification, s.motherQualification].filter(Boolean).join(" / ") }
        : null,
    "Parent education",
  );
  left.push("Distance from school", "Facilities received");

  return { fields, leftForYou: left };
}
