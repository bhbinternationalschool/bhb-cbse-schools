/**
 * The worklist is an instruction, so the ordering has to be right — and the
 * never-contacted pile has to stay a day's work, not a year's.
 */
import assert from "node:assert/strict";
import {
  WORK_ORDER,
  bucketTotal,
  buildLeadWorklist,
  contacted,
  registrationReady,
  workKindOf,
  type LeadLike,
} from "@/lib/leadWorklist";

const T = "2026-09-02";
const lead = (p: Partial<LeadLike>): LeadLike => ({
  id: Math.random().toString(36).slice(2),
  stage: "enquiry",
  leadDate: "2026-01-01",
  mobile: "9000000000",
  ...p,
});

function run() {
  // "—" is how the bulk import wrote "no mother recorded". It is not a name.
  assert.equal(registrationReady(lead({ motherName: "—", declarationAccepted: true, docsBirthCert: true, docsPhoto: true })), false);
  assert.equal(registrationReady(lead({ motherName: "Priya", declarationAccepted: true, docsBirthCert: true, docsPhoto: true })), true);
  assert.equal(registrationReady(lead({ motherName: "Priya", declarationAccepted: true, docsBirthCert: true })), false);

  assert.equal(contacted(lead({})), false);
  assert.equal(contacted(lead({ followUps: [{}] })), true);

  // Each lead gets ONE next action, and the stage wins over everything.
  assert.equal(workKindOf(lead({ stage: "verified" }), T), "admit");
  assert.equal(workKindOf(lead({ stage: "applied" }), T), "admit");
  assert.equal(workKindOf(lead({ motherName: "P", declarationAccepted: true, docsBirthCert: true, docsPhoto: true }), T), "register");
  assert.equal(workKindOf(lead({}), T), "first_call", "never called comes before chasing papers");
  assert.equal(workKindOf(lead({ followUps: [{}], nextFollowUpAt: "2026-09-02" }), T), "callback");
  assert.equal(workKindOf(lead({ followUps: [{}], nextFollowUpAt: "2026-08-01" }), T), "callback", "an overdue promise is still a promise");
  assert.equal(workKindOf(lead({ followUps: [{}], nextFollowUpAt: "2026-12-01" }), T), "documents");
  assert.equal(workKindOf(lead({ followUps: [{}] }), T), "documents");

  // Closed leads are not work.
  const closed = buildLeadWorklist({ leads: [lead({ stage: "enrolled" }), lead({ stage: "lost" })], today: T });
  assert.deepEqual(closed.buckets, []);
  assert.equal(closed.openCount, 0);

  // THE ONE THAT MATTERS: 858 uncalled names must arrive as a day's work.
  const many = Array.from({ length: 858 }, (_, i) =>
    lead({ leadDate: `2025-01-${String((i % 28) + 1).padStart(2, "0")}` }));
  const w = buildLeadWorklist({ leads: [...many, lead({ stage: "verified" })], today: T, dailyCallTarget: 15 });
  const first = w.buckets.find((b) => b.kind === "first_call")!;
  assert.equal(first.leads.length, 15, "a wall does not get worked; fifteen does");
  assert.equal(bucketTotal([...many, lead({ stage: "verified" })], "first_call", T), 858, "but the true size is still reported");

  // Ready-to-admit outranks 858 cold names — the order is by value, not volume.
  assert.equal(w.buckets[0].kind, "admit");
  assert.equal(w.buckets[w.buckets.length - 1].kind, "first_call");

  // Newest first inside a bucket: last month's enquiry remembers enquiring.
  const dated = buildLeadWorklist({
    leads: [lead({ leadDate: "2024-03-01" }), lead({ leadDate: "2026-08-01" }), lead({ leadDate: "2025-05-01" })],
    today: T,
  }).buckets[0].leads.map((l) => l.leadDate);
  assert.deepEqual(dated, ["2026-08-01", "2025-05-01", "2024-03-01"]);

  // Empty buckets never render.
  assert.ok(buildLeadWorklist({ leads: [lead({ stage: "verified" })], today: T }).buckets.every((b) => b.leads.length > 0));

  // The declared order is the order used.
  assert.deepEqual(WORK_ORDER, ["admit", "register", "documents", "callback", "first_call"]);

  console.log("leadWorklist selftest: ok");
}

run();
