/**
 * Profile document verification — Vision OCR vs SIS / staff register.
 */

import type { StaffDocKey, StaffRecord } from "@/lib/foundationMasters";
import {
  extractPan,
  extractPersonName,
  extractPincode,
  parseAdmissionDocFromText,
  type AdmissionDocOcrKind,
  type BillOcrConfidence,
} from "@/lib/ocrParse";
import type { StudentDocKey, SisStudent } from "@/lib/sis";

export type DocVerificationOcrCheck = {
  field: string;
  label: string;
  ocrValue: string;
  recordValue: string;
  status: "match" | "mismatch" | "missing_ocr" | "missing_record" | "skipped";
  note?: string;
};

export type DocVerificationOcrOverall =
  | "likely_match"
  | "review"
  | "likely_mismatch"
  | "unreadable";

export type DocVerificationOcrResult = {
  kind: AdmissionDocOcrKind;
  confidence: BillOcrConfidence;
  checks: DocVerificationOcrCheck[];
  overall: DocVerificationOcrOverall;
  suggestedRemark: string;
  rawTextPreview: string;
};

export function studentDocOcrKind(docKey: StudentDocKey): AdmissionDocOcrKind {
  if (docKey === "aadhaar") return "aadhaar";
  if (docKey === "birthCert") return "birth_cert";
  return "generic";
}

export function staffDocOcrKind(docKey: StaffDocKey): AdmissionDocOcrKind {
  if (docKey === "aadhaar") return "aadhaar";
  return "generic";
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 1));
  const tb = nb.split(" ").filter((t) => t.length > 1);
  if (!tb.length) return false;
  const overlap = tb.filter((t) => ta.has(t)).length;
  return overlap >= Math.min(2, tb.length) || (tb.length === 1 && overlap === 1);
}

function aadhaarMatches(ocrFull: string, recordFull: string, recordLast4: string): boolean {
  const ocr = ocrFull.replace(/\D/g, "");
  const full = recordFull.replace(/\D/g, "");
  const last4 = recordLast4.replace(/\D/g, "").slice(-4);
  if (ocr.length === 12 && full.length === 12) return ocr === full;
  if (ocr.length === 12 && last4.length === 4) return ocr.slice(-4) === last4;
  if (ocr.length >= 4 && last4.length === 4) return ocr.slice(-4) === last4;
  return false;
}

function check(
  field: string,
  label: string,
  ocrValue: string,
  recordValue: string,
  matcher: (ocr: string, rec: string) => boolean,
): DocVerificationOcrCheck {
  const o = ocrValue.trim();
  const r = recordValue.trim();
  if (!o && !r) {
    return { field, label, ocrValue: "", recordValue: r, status: "skipped" };
  }
  if (!o) {
    return {
      field,
      label,
      ocrValue: "",
      recordValue: r,
      status: "missing_ocr",
      note: "Not found in scan",
    };
  }
  if (!r) {
    return {
      field,
      label,
      ocrValue: o,
      recordValue: "",
      status: "missing_record",
      note: "Not on register — verify manually",
    };
  }
  return {
    field,
    label,
    ocrValue: o,
    recordValue: r,
    status: matcher(o, r) ? "match" : "mismatch",
  };
}

function overallFromChecks(
  checks: DocVerificationOcrCheck[],
  confidence: BillOcrConfidence,
): DocVerificationOcrOverall {
  const active = checks.filter((c) => c.status !== "skipped");
  if (!active.length) return "unreadable";
  const mismatches = active.filter((c) => c.status === "mismatch").length;
  const matches = active.filter((c) => c.status === "match").length;
  const missingOcr = active.filter((c) => c.status === "missing_ocr").length;

  if (mismatches > 0) return "likely_mismatch";
  if (matches >= 2 && confidence.includes("high")) return "likely_match";
  if (matches >= 1 && mismatches === 0) return "review";
  if (missingOcr === active.length) return "unreadable";
  return "review";
}

function buildSuggestedRemark(
  checks: DocVerificationOcrCheck[],
  overall: DocVerificationOcrOverall,
): string {
  const mismatches = checks.filter((c) => c.status === "mismatch");
  if (mismatches.length) {
    return mismatches
      .map((c) => `${c.label}: scan "${c.ocrValue}" ≠ register "${c.recordValue}"`)
      .join("; ");
  }
  if (overall === "likely_match") return "Vision scan matches register — OK to approve";
  if (overall === "unreadable") {
    return "Could not read document clearly — please re-upload a sharper photo";
  }
  return "Vision scan incomplete — verify name/DOB/Aadhaar manually";
}

export function buildStudentDocVerificationOcr(
  text: string,
  student: SisStudent,
  docKey: StudentDocKey,
  ctx?: { householdPincode?: string },
): DocVerificationOcrResult {
  const kind = studentDocOcrKind(docKey);
  const parsed = parseAdmissionDocFromText(text, kind, "vision");
  const checks: DocVerificationOcrCheck[] = [];

  if (docKey === "photo") {
    return {
      kind,
      confidence: parsed.confidence,
      checks: [
        {
          field: "photo",
          label: "Photo",
          ocrValue: "",
          recordValue: student.fullName,
          status: "skipped",
          note: "Photo docs — verify visually",
        },
      ],
      overall: "review",
      suggestedRemark: "Passport photo — confirm face matches student",
      rawTextPreview: parsed.rawTextPreview,
    };
  }

  checks.push(
    check("name", "Name", parsed.childName, student.fullName, namesLikelyMatch),
  );

  if (docKey === "birthCert" || docKey === "aadhaar") {
    checks.push(
      check("dob", "Date of birth", parsed.dob, student.dob, (a, b) => a === b),
    );
  }

  if (docKey === "aadhaar" || docKey === "birthCert") {
    const recordAadhaar =
      student.aadhaarNumber || student.aadhaarLast4
        ? student.aadhaarNumber || `XXXX${student.aadhaarLast4}`
        : "";
    checks.push({
      field: "aadhaar",
      label: "Aadhaar",
      ocrValue: parsed.aadhaar
        ? `XXXX${parsed.aadhaar.slice(-4)}`
        : "",
      recordValue: recordAadhaar
        ? recordAadhaar.length > 4
          ? `XXXX${recordAadhaar.slice(-4)}`
          : recordAadhaar
        : "",
      status: parsed.aadhaar
        ? aadhaarMatches(
            parsed.aadhaar,
            student.aadhaarNumber,
            student.aadhaarLast4,
          )
          ? "match"
          : recordAadhaar
            ? "mismatch"
            : "missing_record"
        : recordAadhaar
          ? "missing_ocr"
          : "skipped",
    });
  }

  if (docKey === "birthCert" && parsed.registrationNo) {
    checks.push({
      field: "regNo",
      label: "Registration no.",
      ocrValue: parsed.registrationNo,
      recordValue: "",
      status: "missing_record",
      note: "Compare with physical certificate",
    });
  }

  if (docKey === "addressProof") {
    const pin = extractPincode(text);
    checks.push(
      check(
        "pincode",
        "Pincode",
        pin,
        ctx?.householdPincode || "",
        (a, b) => a === b,
      ),
    );
  }

  const overall = overallFromChecks(checks, parsed.confidence);
  return {
    kind,
    confidence: parsed.confidence,
    checks,
    overall,
    suggestedRemark: buildSuggestedRemark(checks, overall),
    rawTextPreview: parsed.rawTextPreview,
  };
}

export function buildStaffDocVerificationOcr(
  text: string,
  staff: StaffRecord,
  docKey: StaffDocKey,
): DocVerificationOcrResult {
  const kind = staffDocOcrKind(docKey);
  const parsed = parseAdmissionDocFromText(text, kind, "vision");
  const checks: DocVerificationOcrCheck[] = [];

  if (docKey === "photo") {
    return {
      kind,
      confidence: parsed.confidence,
      checks: [],
      overall: "review",
      suggestedRemark: "Passport photo — confirm face matches staff record",
      rawTextPreview: parsed.rawTextPreview,
    };
  }

  const ocrName =
    parsed.childName || extractPersonName(text, kind) || extractPersonName(text, "generic");
  checks.push(
    check("name", "Name", ocrName, staff.fullName, namesLikelyMatch),
  );

  if (docKey === "aadhaar") {
    checks.push({
      field: "aadhaar",
      label: "Aadhaar",
      ocrValue: parsed.aadhaar ? `XXXX${parsed.aadhaar.slice(-4)}` : "",
      recordValue: staff.aadhaarNo
        ? `XXXX${staff.aadhaarNo.replace(/\D/g, "").slice(-4)}`
        : "",
      status: parsed.aadhaar
        ? aadhaarMatches(parsed.aadhaar, staff.aadhaarNo, staff.aadhaarNo)
          ? "match"
          : staff.aadhaarNo
            ? "mismatch"
            : "missing_record"
        : staff.aadhaarNo
          ? "missing_ocr"
          : "skipped",
    });
  }

  if (docKey === "pan") {
    const pan = extractPan(text) || extractPan(parsed.rawTextPreview);
    checks.push(
      check("pan", "PAN", pan, staff.panNo, (a, b) => a.toUpperCase() === b.toUpperCase()),
    );
  }

  if (docKey === "addressProof") {
    const pin = extractPincode(text) || parsed.pincode;
    checks.push(
      check(
        "pincode",
        "Pincode",
        pin,
        staff.pincode || "",
        (a, b) => a === b,
      ),
    );
  }

  const overall = overallFromChecks(checks, parsed.confidence);
  return {
    kind,
    confidence: parsed.confidence,
    checks,
    overall,
    suggestedRemark: buildSuggestedRemark(checks, overall),
    rawTextPreview: parsed.rawTextPreview,
  };
}
