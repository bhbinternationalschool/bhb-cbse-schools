import assert from "node:assert/strict";
import { emptyAdmissionLead } from "./admissions";
import {
  approvedTestimonialLines,
  normalizeReferralCode,
  normalizeReferrals,
  referralAttribution,
  referralCodeFor,
  resolveReferralCode,
  testimonialPolishProblems,
  upsertTestimonial,
} from "./referrals";

console.log("referrals.selftest.ts");

const hh = [
  { id: "hh_1", code: "HH-0042", mobile: "9999900123" },
  { id: "hh_2", code: "", mobile: "9999900456" },
];
// Deterministic, typeable, resolves back; garbage never resolves.
assert.equal(referralCodeFor(hh[0]), "BHB-0042-123");
assert.equal(referralCodeFor(hh[0]), referralCodeFor({ ...hh[0] }));
assert.match(referralCodeFor(hh[1]), /^BHB-[A-Z0-9]{4}-456$/);
assert.equal(normalizeReferralCode(" bhb-0042-123 "), "BHB-0042-123");
assert.equal(normalizeReferralCode("BHB-0042"), "");
assert.equal(resolveReferralCode("bhb-0042-123", hh), "hh_1");
assert.equal(resolveReferralCode("BHB-9999-999", hh), "");

// Attribution by resolved household or by unresolved code on the lead.
{
  const leads = [
    emptyAdmissionLead({ id: "a", stage: "enquiry", referredByHouseholdId: "hh_1" }),
    emptyAdmissionLead({ id: "b", stage: "enrolled", referralCode: "BHB-0042-123" }),
    emptyAdmissionLead({ id: "c", stage: "applied", referralCode: "bhb-0042-123" }),
    emptyAdmissionLead({ id: "d", stage: "enquiry", referralCode: "BHB-ZZZZ-000" }),
    emptyAdmissionLead({ id: "e", stage: "enquiry" }),
  ];
  const a = referralAttribution(leads, hh);
  assert.equal(a.length, 1);
  assert.equal(a[0].householdId, "hh_1");
  assert.equal(a[0].leads, 3);
  assert.equal(a[0].registered, 2);
  assert.equal(a[0].enrolled, 1);
}

// Testimonials: approval needs consent note; polish guard.
{
  let s = normalizeReferrals({});
  const r1 = upsertTestimonial(s, { householdId: "hh_1", parentName: "Mrs Verma", studentLabel: "Riya, Class II", rawText: "teachers r very caring, my daughter loves going to school. 2 yrs here.", status: "received", by: "t" });
  assert.ok(r1.ok);
  if (!r1.ok) throw new Error();
  s = r1.state;
  const bad = upsertTestimonial(s, { id: r1.testimonial.id, status: "approved", by: "t" });
  assert.equal(bad.ok, false);
  const good = upsertTestimonial(s, { id: r1.testimonial.id, status: "approved", consentNote: "WhatsApp YES 2026-08-20", polishedText: "The teachers are very caring and my daughter loves going to school. We have been here for 2 years.", showName: false, by: "t" });
  assert.ok(good.ok);
  if (!good.ok) throw new Error();
  const lines = approvedTestimonialLines(good.state);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /name withheld, Riya, Class II\): "The teachers are very caring/);
  assert.deepEqual(testimonialPolishProblems("teachers r caring. 2 yrs here.", "The teachers are caring. We have been here 2 years."), []);
  assert.ok(testimonialPolishProblems("teachers r caring", "The teachers are caring and 100% of parents agree").some((p) => /adds numbers/.test(p)));
  assert.ok(testimonialPolishProblems("short", "x".repeat(200)).some((p) => /longer/.test(p)));
}
console.log("OK — referrals.selftest.ts");
