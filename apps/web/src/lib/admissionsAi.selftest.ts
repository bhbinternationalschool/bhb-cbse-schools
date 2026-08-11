/**
 * Run: npx tsx src/lib/admissionsAi.selftest.ts
 *
 * Exercises only leadConversionScore()/leadConversionLikelihood() — the pure
 * heuristic. The AI-suggested next-best-action path needs a live LLM call
 * (OpenAI/Gemini) so it's excluded here and verified live instead.
 */
import assert from "node:assert/strict";

import type { AdmissionLead, FollowUpOutcome } from "./admissions";
import { leadConversionLikelihood, leadConversionScore } from "./admissionsAi";

console.log("admissionsAi.selftest.ts");

function baseLead(partial?: Partial<AdmissionLead>): AdmissionLead {
  return {
    id: "lead_1",
    householdId: "hh_1",
    enquiryNo: "ENQ-1",
    applicationNo: "",
    stage: "enquiry",
    academicYearCode: "2026-27",
    source: "walk_in",
    childName: "Test Child",
    dob: "2018-01-01",
    gender: "",
    classSoughtId: "",
    classAdmittedId: "",
    sectionId: "",
    medium: "",
    admissionKind: "new",
    guardianName: "Test Parent",
    motherName: "",
    mobile: "9876543210",
    whatsappSame: true,
    whatsapp: "9876543210",
    email: "",
    fatherOccupation: "",
    category: "",
    locality: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    previousSchool: "",
    previousTcNo: "",
    transportInterest: "undecided",
    siblingInSchool: false,
    referredByStaffId: "",
    campaignNote: "",
    declarationAccepted: false,
    registrationFeePaid: false,
    registrationFeeNote: "",
    docsBirthCert: false,
    docsPhoto: false,
    docsAadhaar: false,
    docsTc: false,
    docsCategory: false,
    admissionDate: "",
    admissionNo: "",
    studentId: "",
    sisMatch: "",
    sisStudentId: "",
    sisStudentStatus: "",
    sisStudentInfo: "",
    sisMatchKind: "",
    sisMismatchNotes: [],
    sisReviewStatus: "",
    sisDismissedStudentId: "",
    whatsappDisplayName: "",
    whatsappWaId: "",
    feeGroupId: "",
    rte: false,
    rteGovtApplicationNo: "",
    penStatus: "",
    note: "",
    lostReason: "",
    assignedTo: "",
    nextFollowUpAt: "",
    lastFollowUpAt: "",
    followUps: [],
    leadDate: "2026-08-01",
    registrationDate: "",
    registrationFeeHeadId: "",
    registrationFeeAmountPaise: 0,
    registrationPaymentId: "",
    registrationPaymentStatus: "",
    parentGroupKey: "",
    surveyBeatId: "",
    surveyPhotoDataUrl: "",
    parentConsentAt: "",
    parentConsentBy: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    createdBy: "test",
    ...partial,
  } as AdmissionLead;
}

function withOutcome(outcome: FollowUpOutcome): AdmissionLead["followUps"] {
  return [
    {
      id: "fu_1",
      at: new Date().toISOString(),
      channel: "call",
      outcome,
      note: "",
      nextFollowUpAt: "",
      by: "test",
    },
  ];
}

// --- lost leads are always floored, regardless of other signals ----------
{
  const lead = baseLead({ stage: "lost", registrationFeePaid: true });
  assert.equal(leadConversionScore(lead), 5);
}

// --- scores are always clamped to [5, 95] ---------------------------------
{
  const strong = leadConversionScore(
    baseLead({
      stage: "verified",
      registrationFeePaid: true,
      siblingInSchool: true,
      docsBirthCert: true,
      docsPhoto: true,
      docsAadhaar: true,
      docsTc: true,
      docsCategory: true,
      followUps: withOutcome("visit_scheduled"),
    }),
  );
  assert.ok(strong <= 95, "score must never claim absolute certainty");

  const weak = leadConversionScore(
    baseLead({ stage: "enquiry", followUps: withOutcome("wrong_number") }),
  );
  assert.ok(weak >= 5, "score must never claim absolute zero chance");
}

// --- later stages score higher than earlier ones, all else equal ---------
{
  const enquiry = leadConversionScore(baseLead({ stage: "enquiry" }));
  const applied = leadConversionScore(baseLead({ stage: "applied" }));
  const verified = leadConversionScore(baseLead({ stage: "verified" }));
  assert.ok(applied > enquiry, "applied must score higher than enquiry");
  assert.ok(verified > applied, "verified must score higher than applied");
}

// --- registration payment raises the score --------------------------------
{
  const unpaid = leadConversionScore(baseLead({ stage: "applied" }));
  const paid = leadConversionScore(
    baseLead({ stage: "applied", registrationFeePaid: true }),
  );
  assert.ok(paid > unpaid, "a paid registration fee must raise the score");
}

// --- a negative follow-up outcome lowers the score, a positive one raises it
{
  const neutral = leadConversionScore(baseLead({ stage: "enquiry" }));
  const interested = leadConversionScore(
    baseLead({ stage: "enquiry", followUps: withOutcome("interested") }),
  );
  const notInterested = leadConversionScore(
    baseLead({ stage: "enquiry", followUps: withOutcome("not_interested") }),
  );
  assert.ok(interested > neutral, "an interested outcome must raise the score");
  assert.ok(
    notInterested < neutral,
    "a not-interested outcome must lower the score",
  );
}

// --- an overdue follow-up lowers the score (stale/neglected lead) --------
{
  const onTrack = leadConversionScore(
    baseLead({ stage: "applied", nextFollowUpAt: "2099-01-01" }),
  );
  const overdue = leadConversionScore(
    baseLead({ stage: "applied", nextFollowUpAt: "2020-01-01" }),
  );
  assert.ok(overdue < onTrack, "an overdue follow-up must lower the score");
}

// --- label/tone buckets line up with the score thresholds -----------------
{
  const lost = leadConversionLikelihood(baseLead({ stage: "lost" }));
  assert.equal(lost.tone, "danger");
  assert.equal(lost.label, "At risk — re-engage or close");

  const strong = leadConversionLikelihood(
    baseLead({
      stage: "verified",
      registrationFeePaid: true,
      followUps: withOutcome("visit_scheduled"),
    }),
  );
  assert.equal(strong.tone, "good");
  assert.equal(strong.label, "Likely to convert");
}

console.log("OK — admissionsAi.selftest.ts");
