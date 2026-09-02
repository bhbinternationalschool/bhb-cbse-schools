/**
 * The Register button and the guard must agree.
 *
 * A walk-in lead read as a broken button for exactly this reason: the guard
 * refused, the screen flashed the refusal for three seconds, and the ticks
 * that would clear it were a thousand lines further down. The rule now has
 * one home; this holds the two ends to it.
 */
import assert from "node:assert/strict";
import {
  defaultAdmissionsState,
  promoteToRegistration,
  registrationBlockers,
  type AdmissionsState,
} from "@/lib/admissions";

function stateWith(lead: Record<string, unknown>): AdmissionsState {
  const base = defaultAdmissionsState();
  return {
    ...base,
    leads: [
      {
        ...(base.leads[0] ?? {}),
        id: "L1",
        stage: "enquiry",
        householdId: "",
        motherName: "",
        guardianName: "Ram Yadav",
        childName: "Rudraksha",
        declarationAccepted: false,
        docsBirthCert: false,
        docsPhoto: false,
        ...lead,
      },
    ] as AdmissionsState["leads"],
  };
}

function run() {
  // The real walk-in lead from production: a mother, and nothing else ticked.
  const walkIn = stateWith({ motherName: "Priya Yadav" });
  const blockers = registrationBlockers(walkIn, "L1");
  const messages = blockers.map((b) => b.message).join(" ");
  assert.equal(blockers.length, 3, "declaration + birth certificate + photo");
  assert.match(messages, /declaration/i);
  assert.match(messages, /Birth certificate/i);
  assert.match(messages, /Passport photo/i);
  // Every blocker names a step, so the screen can send someone to the fix
  // rather than asking them to hunt for it.
  for (const b of blockers) {
    assert.ok(["child", "family", "checklist"].includes(b.where), b.message);
  }

  // The guard refuses for exactly the reasons the screen showed. If these two
  // ever disagree, one of them is lying to the office.
  const refused = promoteToRegistration(walkIn, "L1");
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    for (const b of blockers) {
      assert.ok(
        refused.reason.includes(b.message),
        `the guard must give the same reason the button shows: ${b.message}`,
      );
    }
  }

  // A missing mother is a FAMILY-step problem, not a checklist one.
  const noMother = registrationBlockers(stateWith({}), "L1");
  assert.ok(noMother.some((b) => b.where === "family" && /mother/i.test(b.message)));

  // Everything done → nothing blocking, and the guard lets it through.
  const ready = stateWith({
    motherName: "Priya Yadav",
    declarationAccepted: true,
    docsBirthCert: true,
    docsPhoto: true,
  });
  assert.deepEqual(registrationBlockers(ready, "L1"), []);
  assert.equal(promoteToRegistration(ready, "L1").ok, true);

  // Past the stage: one blocker that settles it, not a list of ticks that
  // would imply the lead could still be registered.
  const done = stateWith({
    stage: "enrolled",
    motherName: "Priya Yadav",
  });
  const late = registrationBlockers(done, "L1");
  assert.equal(late.length, 1);
  assert.match(late[0].message, /already at/i);

  console.log("registrationBlockers selftest: ok");
}

run();
