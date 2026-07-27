/**
 * Map Field Leads / Enquiry Survey Excel workbooks into Admission ImportLeadRow[].
 */

import type { AdmissionSource, ImportLeadRow } from "@/lib/admissions";

/** Canonical class names in masters → match loose survey labels. */
const CLASS_ALIASES: Record<string, string> = {
  nursery: "Nursery",
  nur: "Nursery",
  "pre-nursery": "Nursery",
  prenursery: "Nursery",
  lkg: "LKG",
  "l.k.g": "LKG",
  "l.k.g.": "LKG",
  ukg: "UKG",
  "u.k.g": "UKG",
  "u.k.g.": "UKG",
  "1": "I",
  "1st": "I",
  first: "I",
  "class 1": "I",
  "class1": "I",
  i: "I",
  "2": "II",
  "2nd": "II",
  second: "II",
  "class 2": "II",
  "class2": "II",
  ii: "II",
  "3": "III",
  "3rd": "III",
  third: "III",
  "class 3": "III",
  "class3": "III",
  iii: "III",
  "4": "IV",
  "4th": "IV",
  fourth: "IV",
  "class 4": "IV",
  "class4": "IV",
  iv: "IV",
  "5": "V",
  "5th": "V",
  fifth: "V",
  "class 5": "V",
  "class5": "V",
  v: "V",
  "6": "VI",
  "6th": "VI",
  sixth: "VI",
  "class 6": "VI",
  "class6": "VI",
  vi: "VI",
  "7": "VII",
  "7th": "VII",
  seventh: "VII",
  "class 7": "VII",
  "class7": "VII",
  vii: "VII",
  "8": "VIII",
  "8th": "VIII",
  eighth: "VIII",
  "class 8": "VIII",
  "class8": "VIII",
  viii: "VIII",
  "9": "IX",
  "9th": "IX",
  ninth: "IX",
  "class 9": "IX",
  "class9": "IX",
  ix: "IX",
  "10": "X",
  "10th": "X",
  tenth: "X",
  "class 10": "X",
  "class10": "X",
  x: "X",
  "11": "XI",
  "11th": "XI",
  "class 11": "XI",
  "class11": "XI",
  xi: "XI",
  "12": "XII",
  "12th": "XII",
  "class 12": "XII",
  "class12": "XII",
  xii: "XII",
};

export function normalizeClassSoughtLabel(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[^\w.\s/,&|;+-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";
  // Take first class from multi-class cells ("4, 5" / "7th & 1st" / "Nursery, 1")
  const first = cleaned
    .split(/[,&/;|+]+/)
    .map((p) => p.trim())
    .find(Boolean);
  if (!first) return "";
  if (CLASS_ALIASES[first]) return CLASS_ALIASES[first]!;
  const noClass = first.replace(/^class\s+/, "").trim();
  if (CLASS_ALIASES[noClass]) return CLASS_ALIASES[noClass]!;
  // "7th 1st" leftover — take leading ordinal/number token
  const token = noClass.split(/\s+/)[0] || "";
  if (CLASS_ALIASES[token]) return CLASS_ALIASES[token]!;
  return first;
}

export function excelSerialToIsoDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel serial (1900 date system) → JS Date
    const utc = Date.UTC(1899, 11, 30) + Math.round(value * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return "";
}

function pickPhone(...candidates: unknown[]): string {
  for (const c of candidates) {
    const digits = String(c ?? "").replace(/\D/g, "");
    if (digits.length >= 10) return digits.slice(-10);
  }
  return "";
}

function splitChildNames(raw: string): string[] {
  return String(raw || "")
    .split(/[\n;|]+/)
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function mapKnowAboutUsToSource(raw: string): AdmissionSource {
  const s = raw.toLowerCase();
  if (/survey|field|door|beat/.test(s)) return "field_survey";
  if (/google|search/.test(s)) return "google";
  if (/facebook|instagram|social|whatsapp/.test(s)) return "social";
  if (/refer|friend|relative|neighbour|neighbor/.test(s)) return "referral";
  if (/web|online|site/.test(s)) return "website";
  if (/phone|call|sms/.test(s)) return "phone";
  if (/walk|visit|office|school/.test(s)) return "walk_in";
  return "field_survey";
}

function rowGet(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  // Case-insensitive / fuzzy header match
  const entries = Object.entries(row);
  for (const want of keys) {
    const w = want.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = entries.find(([k]) => {
      const n = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      return n === w || n.includes(w);
    });
    if (hit && String(hit[1] ?? "").trim()) return String(hit[1]).trim();
  }
  return "";
}

/** Field_Leads.xlsx → import rows (source: field_survey). */
export function mapFieldLeadsRows(
  rows: Record<string, unknown>[],
): ImportLeadRow[] {
  const out: ImportLeadRow[] = [];
  for (const row of rows) {
    const guardianName =
      rowGet(row, "ParentName", "System_Name", "Guardian", "Father") ||
      "Parent";
    const mobile = pickPhone(
      row.Phone,
      row.System_Phone,
      rowGet(row, "Phone", "System_Phone", "Mobile"),
    );
    const address = rowGet(row, "Address");
    const classRaw = rowGet(row, "ClassSeeking", "Class");
    const className = normalizeClassSoughtLabel(classRaw);
    const interest = rowGet(row, "Interest_level", "Interest");
    const leadDate = excelSerialToIsoDate(
      row.Date ?? row.leadDate ?? rowGet(row, "Date"),
    );
    const children = splitChildNames(rowGet(row, "ChildName", "Child"));
    const names = children.length ? children : ["(unnamed child)"];
    for (const childName of names) {
      if (childName === "(unnamed child)" && !mobile) continue;
      out.push({
        childName,
        guardianName: guardianName.replace(/[\u{1F300}-\u{1FAFF}]/gu, "").trim() || "Parent",
        mobile,
        className,
        address,
        locality: address,
        leadDate,
        source: "field_survey",
        stage: "enquiry",
        note: [
          interest ? `Interest: ${interest.replace(/[^\w\s]/g, " ").trim()}` : "",
          classRaw && classRaw !== className ? `Classes noted: ${classRaw}` : "",
          "Imported from Field_Leads.xlsx",
        ]
          .filter(Boolean)
          .join(" · "),
        campaignNote: "Field_Leads.xlsx",
      });
    }
  }
  return out;
}

/** BHB_School_Enquiry_Survey.xlsx → import rows. */
export function mapEnquirySurveyRows(
  rows: Record<string, unknown>[],
): ImportLeadRow[] {
  const out: ImportLeadRow[] = [];
  for (const row of rows) {
    const guardianName =
      rowGet(row, "Father’s Name", "Father's Name", "Father Name", "Guardian") ||
      "Parent";
    const motherName = rowGet(
      row,
      "Mother’s Name",
      "Mother's Name",
      "Mother Name",
    );
    const mobile = pickPhone(
      rowGet(
        row,
        "Mobile No./What’s UP No.",
        "Mobile No./What's UP No.",
        "Mobile",
        "WhatsApp",
      ),
      rowGet(row, "Alternate No."),
    );
    const address = rowGet(row, "Address");
    const classRaw = rowGet(row, "Classes for Admission", "Class");
    const className = normalizeClassSoughtLabel(classRaw);
    const know = rowGet(row, "How do you Know About Us?");
    const rating = rowGet(row, "Please feel free to give us your rating.");
    const improve = rowGet(
      row,
      "Our resolution is to prepare your child for international level. If you feel that we need improvement then please tell us what should we improve?",
    );
    const currentSchool = rowGet(row, "Current School Name");
    const visitRaw = rowGet(
      row,
      "When are you planning for Visit to our School or follow up date?",
    );
    const visit =
      excelSerialToIsoDate(visitRaw) ||
      (visitRaw && !/^\d+(\.\d+)?$/.test(visitRaw) ? visitRaw : "");
    const email = rowGet(row, "E-Mail", "Email");
    const leadDate =
      excelSerialToIsoDate(row.Survey_Date) ||
      excelSerialToIsoDate(row.Timestamp) ||
      excelSerialToIsoDate(rowGet(row, "Survey_Date", "Timestamp"));
    const children = splitChildNames(
      rowGet(row, "Child’s Name", "Child's Name", "Child Name"),
    );
    // "Satyam Mishra and Shuvam" → split on " and "
    const expanded = children.flatMap((n) =>
      n.split(/\s+and\s+/i).map((x) => x.trim()).filter(Boolean),
    );
    const names = expanded.length ? expanded : ["(unnamed child)"];
    const source = mapKnowAboutUsToSource(know);
    for (const childName of names) {
      if (childName === "(unnamed child)" && !mobile) continue;
      out.push({
        childName,
        guardianName,
        motherName,
        mobile,
        className,
        address,
        locality: address,
        leadDate,
        source,
        stage: "enquiry",
        note: [
          know ? `Know us: ${know}` : "",
          currentSchool ? `Current school: ${currentSchool}` : "",
          visit ? `Visit/follow-up: ${visit}` : "",
          rating ? `Rating: ${rating}` : "",
          improve ? `Feedback: ${improve}` : "",
          email ? `Email: ${email}` : "",
          classRaw && classRaw !== className ? `Classes noted: ${classRaw}` : "",
          "Imported from BHB_School_Enquiry_Survey.xlsx",
        ]
          .filter(Boolean)
          .join(" · "),
        campaignNote: "BHB_School_Enquiry_Survey.xlsx",
      });
    }
  }
  return out;
}

export function detectLeadWorkbookKind(
  sheetName: string,
  headers: string[],
): "field_leads" | "enquiry_survey" | "generic" {
  const joined = `${sheetName} ${headers.join(" ")}`.toLowerCase();
  if (
    joined.includes("classseeking") ||
    joined.includes("system_phone") ||
    joined.includes("interest_level")
  ) {
    return "field_leads";
  }
  if (
    joined.includes("classes for admission") ||
    joined.includes("how do you know") ||
    joined.includes("form responses")
  ) {
    return "enquiry_survey";
  }
  return "generic";
}
