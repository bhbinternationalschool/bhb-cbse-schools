import assert from "node:assert/strict";
import { defaultAdmissionsState, emptyAdmissionLead } from "./admissions";
import {
  createAudienceList,
  createSequence,
  defaultWaCampaignsState,
  normalizeWaCampaignsState,
  openEnquiryFilters,
  pruneSequenceQueue,
  sequenceStepWhen,
  startSequence,
  stopSequence,
} from "./waCampaigns";

console.log("waSequences.selftest.ts");

// Offsets: negative before the anchor, time kept.
assert.equal(sequenceStepWhen("2026-08-24", { dayOffset: -7, time: "10:00" }), "2026-08-17T10:00");
assert.equal(sequenceStepWhen("2026-08-24", { dayOffset: 1, time: "17:30" }), "2026-08-25T17:30");
assert.equal(sequenceStepWhen("2026-08-31", { dayOffset: 1, time: "09:00" }), "2026-09-01T09:00", "month roll-over");

// Normalise: garbage steps clamped, unknown template → custom, missing sequences → [].
{
  const s = normalizeWaCampaignsState({ sequences: [{ id: "q1", name: "x", listId: "l", steps: [{ dayOffset: 999, time: "25:99", templateKey: "nope", body: "b" }] }] } as never);
  assert.equal(s.sequences.length, 1);
  assert.equal(s.sequences[0].steps[0].dayOffset, 120);
  assert.equal(s.sequences[0].steps[0].time, "10:00");
  assert.equal(s.sequences[0].steps[0].templateKey, "custom");
  assert.deepEqual(normalizeWaCampaignsState({} as never).sequences, []);
}

// Start → one scheduled campaign per step, messages queued for the list; stop → paused + skipped.
{
  const adm = defaultAdmissionsState();
  adm.leads.push(
    emptyAdmissionLead({ id: "L1", stage: "enquiry", childName: "A", mobile: "9999900001", guardianName: "P1", leadDate: "2026-08-10" }),
    emptyAdmissionLead({ id: "L2", stage: "enquiry", childName: "B", mobile: "9999900002", guardianName: "P2", leadDate: "2026-08-11" }),
    emptyAdmissionLead({ id: "L3", stage: "lost", childName: "C", mobile: "9999900003", guardianName: "P3", leadDate: "2026-08-11" }),
  );
  let wa = defaultWaCampaignsState();
  const lr = createAudienceList(wa, { name: "Open enquiries", filters: openEnquiryFilters() }, "t", adm);
  wa = lr.state;
  const listId = lr.list.id;
  const bad = createSequence(wa, { name: "Empty", listId, steps: [] }, "t");
  assert.equal(bad.ok, false);
  const cr = createSequence(
    wa,
    {
      name: "Nurture",
      listId,
      anchor: "start",
      steps: [
        { id: "", dayOffset: 0, time: "11:00", label: "Hello", templateKey: "custom", body: "Hi {{guardianName}} step 1" },
        { id: "", dayOffset: 4, time: "11:00", label: "Visit", templateKey: "custom", body: "Hi {{guardianName}} step 2" },
      ],
    },
    "t",
  );
  assert.ok(cr.ok);
  if (!cr.ok) throw new Error();
  wa = cr.state;
  const st = startSequence(wa, cr.sequence.id, adm, "t", { today: "2026-08-19" });
  assert.ok(st.ok, !st.ok ? st.reason : "");
  if (!st.ok) throw new Error();
  assert.equal(st.campaigns, 2);
  const camps = st.wa.campaigns.filter((c) => c.sequenceId === cr.sequence.id).sort((a, b) => a.sequenceStep - b.sequenceStep);
  assert.deepEqual(camps.map((c) => c.scheduledAt), ["2026-08-19T11:00", "2026-08-23T11:00"]);
  assert.deepEqual(camps.map((c) => c.sequenceStep), [1, 2]);
  assert.ok(camps.every((c) => c.status === "scheduled"));
  // Only open leads (L1, L2) — lost L3 excluded by the list filter; 2 steps × 2 leads.
  assert.equal(st.queued, 4);
  assert.equal(st.wa.sequences[0].status, "started");
  // Restart refused while started.
  assert.equal(startSequence(st.wa, cr.sequence.id, st.admissions, "t").ok, false);

  // Prune: L2 becomes enrolled → its queued step messages skipped.
  const adm2 = { ...st.admissions, leads: st.admissions.leads.map((l) => (l.id === "L2" ? { ...l, stage: "enrolled" as const } : l)) };
  const pr = pruneSequenceQueue(st.wa, adm2);
  assert.equal(pr.skipped, 2);
  assert.ok(pr.wa.messages.filter((m) => m.leadId === "L2").every((m) => m.status === "skipped" && /Enrolled/.test(m.error)));
  assert.ok(pr.wa.messages.filter((m) => m.leadId === "L1").every((m) => m.status === "queued"));

  // Stop: remaining queued skipped, campaigns paused, status stopped.
  const stopped = stopSequence(pr.wa, cr.sequence.id);
  assert.ok(stopped.campaigns.filter((c) => c.sequenceId === cr.sequence.id).every((c) => c.status === "paused"));
  assert.ok(stopped.messages.filter((m) => m.leadId === "L1").every((m) => m.status === "skipped"));
  assert.equal(stopped.sequences[0].status, "stopped");
}

console.log("OK — waSequences.selftest.ts");
