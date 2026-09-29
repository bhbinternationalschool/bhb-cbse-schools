/**
 * Run: npx tsx src/lib/aiSchoolStatus.selftest.ts
 *
 * The school is recognised by the Government of Uttar Pradesh and holds no
 * CBSE affiliation. The certificate and staff-agreement prompts used to call
 * it "CBSE-affiliated" and pass the placeholder "CBSE Affiliation: 213XXXX"
 * (or "CBSE" when blank) — so a drafted bonafide or appointment letter could
 * claim an affiliation that does not exist. Every prompt this builds must
 * carry the rule against it, and mention CBSE only as that rule or as the
 * syllabus framework.
 */
import assert from "node:assert/strict";
import {
  buildStudentCertificateSystemPrompt,
  buildStudentCertificateUserPrompt,
} from "./studentCertificateAi";
import {
  buildStaffAgreementSystemPrompt,
  buildStaffAgreementUserPrompt,
  type StaffAgreementAiType,
} from "./staffAgreementAi";
import type { CertificateKind } from "./certificates";
import type { SchoolDocumentLanguage } from "./schoolDocumentAi";

console.log("aiSchoolStatus.selftest.ts");

const LANGS: SchoolDocumentLanguage[] = ["en", "hi", "both"];
const KINDS: CertificateKind[] = ["tc", "bonafide", "character", "fee_clearance", "fees_paid", "aadhaar_uidai"];
const TYPES: StaffAgreementAiType[] = ["appointment", "confidentiality", "policy", "conduct"];
const RECOGNITIONS = ["", "Recognised by the Government of Uttar Pradesh"];

/** Lines that may say CBSE: the rule itself, and the syllabus framework. */
const ALLOWED_CBSE = /NEVER state or imply|NCERT\/CBSE|Remove any statement that the school is affiliated/;

function check(label: string, prompt: string, recognition: string) {
  assert.match(prompt, /NEVER state or imply that the school is affiliated to CBSE/, `${label}: carries the rule`);
  assert.doesNotMatch(prompt, /CBSE Affiliation:/, `${label}: no affiliation fact line`);
  assert.doesNotMatch(prompt, /213XXXX|70XXX/, `${label}: no placeholder numbers`);
  for (const line of prompt.split("\n")) {
    if (/cbse/i.test(line)) {
      assert.match(line, ALLOWED_CBSE, `${label}: CBSE only as the rule or the syllabus — got: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.ok(
    prompt.includes(`Recognition: ${recognition || "—"}`),
    `${label}: the recognition fact is the helper's line, or — when there is none`,
  );
}

for (const recognition of RECOGNITIONS) {
  for (const language of LANGS) {
    for (const kind of KINDS) {
      for (const mode of ["create", "revise"] as const) {
        const prompt =
          buildStudentCertificateSystemPrompt(language) +
          "\n" +
          buildStudentCertificateUserPrompt({
            mode, kind, language,
            schoolName: "BHB Educational Trust", displayName: "BHB International School",
            city: "Varanasi", recognition, udiseCode: "09674104900",
            studentContext: "Name: Test", purpose: "bank", details: "",
            currentBody: "Old text", changeRequest: "",
          });
        check(`certificate ${kind}/${language}/${mode}/${recognition ? "recognised" : "blank"}`, prompt, recognition);
      }
    }
    for (const agreementType of TYPES) {
      for (const mode of ["create", "revise"] as const) {
        const prompt =
          buildStaffAgreementSystemPrompt(language) +
          "\n" +
          buildStaffAgreementUserPrompt({
            mode, agreementType, language,
            schoolName: "BHB Educational Trust", displayName: "BHB International School",
            city: "Varanasi", recognition,
            staffContext: "Name: Test", details: "",
            currentTitle: "Appointment", currentBody: "Old draft", changeRequest: "",
          });
        check(`agreement ${agreementType}/${language}/${mode}/${recognition ? "recognised" : "blank"}`, prompt, recognition);
      }
    }
  }
}

// A revise must also be told to take an existing affiliation claim OUT of the draft.
assert.match(
  buildStaffAgreementUserPrompt({
    mode: "revise", agreementType: "appointment", language: "en",
    schoolName: "S", displayName: "S", staffContext: "", details: "",
    currentBody: "The school is affiliated to CBSE (Aff. 213XXXX).",
  }),
  /Remove any statement that the school is affiliated to CBSE or any board/,
);

console.log("  ok");
