/**
 * A projected lead must never blank the record it came from.
 *
 * Stage 6 replaces the 2.37 MB whole-table admissions read with a projection:
 * the ~20 promoted columns, not `lead_json`. rowToLead() already rebuilds a
 * lead from those columns when lead_json is absent, which makes the switch
 * look like a one-line change.
 *
 * It is not. AdmissionLead has 79 fields and 59 of them live ONLY in
 * lead_json — dob, gender, address, motherName, email, the document
 * checklist, the admission details. A projected lead is a stub, and saving
 * one back would blank 59 fields on a real child's record.
 *
 * That is the same shape as the failure that orphaned 711 students earlier
 * today: a partial value overwriting a complete one, with nothing in the way.
 * It is why the projection could not simply be switched on, and why this
 * guard lands FIRST — nothing produces partial leads yet, so it changes
 * nothing today and makes the read-path work safe to do tomorrow.
 *
 * Run: npx tsx src/lib/partialLead.selftest.ts
 */
import assert from "node:assert/strict";
import { isPartialLead, mergeProjectedLead } from "./admissions";
import type { AdmissionLead } from "./admissions";

const full = {
  id: "adm_1",
  childName: "Aarav Sharma",
  stage: "enquiry",
  mobile: "9876543210",
  // the fields that exist only in lead_json
  dob: "2020-06-14",
  gender: "male",
  motherName: "Priya Sharma",
  address: "12 Station Road",
  email: "priya@example.com",
  docsBirthCert: true,
} as unknown as AdmissionLead;

const projected = {
  id: "adm_1",
  childName: "Aarav Sharma",
  stage: "registered", // the one thing that genuinely changed
  mobile: "9876543210",
  __partial: true,
} as unknown as AdmissionLead;

// ── The guard recognises a stub ───────────────────────────────────────────
{
  assert.equal(isPartialLead(projected), true);
  assert.equal(isPartialLead(full), false);
  assert.equal(isPartialLead(undefined), false, "absent is not partial");
}

// ── A stub must not blank the 59 fields it never carried ─────────────────
{
  const merged = mergeProjectedLead(full, projected) as unknown as Record<string, unknown>;

  assert.equal(
    merged.stage,
    "registered",
    "the projection's own columns still win — it is a real update",
  );
  assert.equal(
    merged.dob,
    "2020-06-14",
    "dob is not in the projection and must survive it. Losing this on a real " +
      "child's record is the failure this guard exists to prevent.",
  );
  assert.equal(merged.motherName, "Priya Sharma");
  assert.equal(merged.address, "12 Station Road");
  assert.equal(merged.email, "priya@example.com");
  assert.equal(merged.docsBirthCert, true);
  assert.equal(merged.__partial, undefined, "the marker is not persisted");
}

// ── A complete lead replaces wholesale ────────────────────────────────────
// Detail-on-demand fetches the full record; that one is authoritative and
// must be able to CLEAR a field, which a merge would prevent.
{
  const editedFull = { ...full, address: "" } as unknown as AdmissionLead;
  const merged = mergeProjectedLead(full, editedFull) as unknown as Record<string, unknown>;
  assert.equal(
    merged.address,
    "",
    "a full record may clear a field — only stubs are merged",
  );
}

// ── First sight of a lead ─────────────────────────────────────────────────
{
  const merged = mergeProjectedLead(undefined, projected);
  assert.equal(
    merged,
    projected,
    "with nothing to protect, a projected lead is simply taken — the list " +
      "must still show leads this browser has not opened",
  );
}

console.log("partialLead.selftest: all assertions passed");
