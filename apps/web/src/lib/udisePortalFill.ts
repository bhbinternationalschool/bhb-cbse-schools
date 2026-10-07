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
import { schoolAnswerFields, type UdiseSchoolAnswers } from "@/lib/udiseSchoolAnswers";

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
  /**
   * The form controls behind each leftForYou line, so the robot can drop a
   * line the portal already answers (extension 1.2+). Not every line has one.
   */
  leftControls: Record<string, string[]>;
};

/** What the fill route knows beyond the child's own row. */
export type UdiseFillExtras = {
  /** The office's confirmed school answers (lib/udiseSchoolAnswers). */
  school?: UdiseSchoolAnswers;
  /**
   * The same child's ERP row for the previous academic year, if there is one:
   * portal class ids for then and now (lib/udisePortalAdd portalClassIdFor).
   */
  previousYear?: { yearCode: string; className: string; portalClassId: number; currentPortalClassId: number | null } | null;
  /** Road distance to the campus from the family's (exactly matched) village. */
  distance?: { km: number; from: string } | null;
  /**
   * The robot can fill fields the portal shows only after another choice
   * (previous-year class and result appear once the status is chosen).
   * Extension 1.2+ asks with v=2; older versions get those listed instead.
   */
  dependentFields?: boolean;
};

/** Portal 4.3.6 distance band: 1 <1 km, 2 1–3, 3 3–5, 4 >5. */
export function distanceBand(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return "";
  if (km < 1) return "1";
  if (km < 3) return "2";
  if (km < 5) return "3";
  return "4";
}

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

export function buildUdiseFillPlan(s: SisStudent, hh: Household | undefined, extras: UdiseFillExtras = {}): UdiseFillPlan {
  const fields: UdiseFillField[] = [];
  const left: string[] = [];
  const leftControls: Record<string, string[]> = {};
  const CONTROLS: Record<string, string[]> = {
    Address: ["address"],
    Pincode: ["pincode"],
    Mobile: ["primaryMobile"],
    "Social category": ["socCatId"],
    "Minority group (religion)": ["minorityId"],
    EWS: ["ewsYN"],
    "CWSN (Yes/No)": ["cwsnYN"],
    "BPL / AAY": ["isBplYN"],
    Nationality: ["natIndYN"],
    "Out-of-school child": ["ooscYN"],
    "Blood group": ["bloodGroup"],
    "Admission no.": ["admnNumber"],
    "Roll no.": ["rollNumber"],
    Height: ["heightInCm"],
    Weight: ["weightInKg"],
    "Parent education": ["parentEducation"],
    "Distance from school": ["distanceFrmSchool"],
  };
  const leave = (label: string, controls = CONTROLS[label]) => {
    left.push(label);
    if (controls?.length) leftControls[label] = controls;
  };
  const add = (f: UdiseFillField | null, missing: string) => {
    if (f && f.value) fields.push(f);
    else leave(missing);
  };
  const school = extras.school ? schoolAnswerFields(extras.school, s) : null;

  // GP — contact
  const address = hh
    ? [hh.address, hh.locality, hh.landmark, hh.city]
        // "AYAR, AYAR, VARANASI, VARANASI": the same place typed into two boxes.
        .flatMap((x) => (x || "").split(","))
        .map((x) => x.trim())
        .filter((x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
        .join(", ")
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
  else leave("EWS");
  // isCwsn is a checkbox that is false until someone ticks it: false is not
  // "No" — only the office's confirmed school answer makes it one.
  if (s.isCwsn) fields.push({ control: "cwsnYN", kind: "radio", value: "1", label: "CWSN", shown: "Yes" });
  if (school) {
    fields.push(...school.fields);
    for (const l of school.left) leave(l);
  }
  for (const q of ["CWSN (Yes/No)", "BPL / AAY", "Nationality", "Out-of-school child"]) {
    if (q === "CWSN (Yes/No)" && s.isCwsn) continue;
    if (!school?.covers.has(q)) leave(q);
  }

  // EP — enrolment
  const bg = BLOOD[(s.bloodGroup || "").replace(/\s+/g, "").toUpperCase()] || "";
  add(bg ? { control: "bloodGroup", kind: "select", value: bg, label: "Blood group", shown: s.bloodGroup } : null, "Blood group");
  add(s.admissionNo ? { control: "admnNumber", kind: "text", value: s.admissionNo, label: "Admission no.", shown: s.admissionNo } : null, "Admission no.");
  add(digits(s.rollNo) ? { control: "rollNumber", kind: "text", value: digits(s.rollNo), label: "Roll no.", shown: s.rollNo } : null, "Roll no.");
  // ERP join dates are not the admission register's date — and more than half
  // carry the day-equals-month parser fault (04/04, 07/07; 7 Oct 2026).
  leave("Admission date (from the admission register)", ["admnStartDate"]);

  // Previous academic year: the ERP knows where the child studied last year
  // only when it holds the child's own row for that year.
  const py = extras.previousYear;
  if (py) {
    fields.push({ control: "enrStatusPY", kind: "select", value: "1", label: "Previous year status", shown: `Studied here in ${py.yearCode} (${py.className})` });
    if (extras.dependentFields) {
      fields.push({ control: "classPY", kind: "select", value: String(py.portalClassId), label: "Previous class", shown: `${py.className} (${py.yearCode})` });
      // Moved up a class = promoted; whether by exam is the school's answer.
      // The SAME class both years is not read as "not promoted": a playgroup
      // year filed as Nursery looks exactly like that (ABHI PATEL, 7 Oct 2026).
      const movedUp = py.currentPortalClassId !== null && py.currentPortalClassId > py.portalClassId;
      if (movedUp && extras.school?.answers.promotionByExam) {
        const byExam = py.portalClassId >= 1;
        fields.push({
          control: "examResultPy",
          kind: "select",
          value: byExam ? "1" : "4",
          label: "Previous year result",
          shown: `${byExam ? "Promoted/Passed" : "Promoted without exam"} (${py.className} → this year's class; school answer)`,
        });
      } else if (py.currentPortalClassId === py.portalClassId) {
        leave(`Previous year: result (the ERP shows ${py.className} in both years — check)`, ["examResultPy"]);
      } else {
        leave("Previous year: result", ["examResultPy"]);
      }
      leave("Previous year: marks %, days attended", ["examMarksPy", "attendancePy"]);
    } else {
      leave("Previous year: class, result, marks, days attended", ["classPY"]);
    }
  } else {
    leave("Previous year: status, class, result, marks, attendance", ["enrStatusPY"]);
  }

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
  // The village centre is not the house: a figure within half a km of a band
  // edge could fall either side, so it is shown, not typed.
  const km = extras.distance?.km ?? 0;
  const nearEdge = [1, 3, 5].some((edge) => Math.abs(km - edge) < 0.5);
  const band = extras.distance && !nearEdge ? distanceBand(km) : "";
  if (extras.distance && nearEdge) {
    leave(`Distance from school (${extras.distance.from} is ≈${km.toFixed(1)} km by road — close to a band edge, check)`, ["distanceFrmSchool"]);
  } else {
    add(
      band
        ? {
            control: "distanceFrmSchool",
            kind: "select",
            value: band,
            label: "Distance from school",
            shown: `≈${km.toFixed(1)} km by road from ${extras.distance!.from} (village centre)`,
          }
        : null,
      "Distance from school",
    );
  }

  return { fields, leftForYou: left, leftControls };
}
