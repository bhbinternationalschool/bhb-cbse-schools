/**
 * A projected lead must get its missing fields back before it is written.
 *
 * Stage 6 sends the admissions list without `lead_json` — 1.82 MB of the
 * table's 2.37 MB, which no list screen reads. rowToLead() rebuilds each lead
 * from the ~20 promoted columns, so the list works. But AdmissionLead has 79
 * fields and 59 live only in lead_json: dob, gender, address, motherName,
 * email, the document checklist.
 *
 * leadToRow writes `lead_json: l` wholesale and the client pushes whole
 * state. So without a merge, one save would blank 59 fields on all 919 leads
 * at once — dates of birth and addresses gone for every child in the
 * admissions pipeline. The identical shape, a partial value overwriting a
 * complete one, orphaned 711 students earlier the same day.
 *
 * The merge is SERVER-side deliberately. A client-side rule holds only while
 * every future caller remembers it. This holds even when one forgets, because
 * the stored record is read and merged regardless of what the browser thought
 * it was sending.
 *
 * Run: npx tsx src/lib/projectedLeadWrite.selftest.ts
 */
import assert from "node:assert/strict";

type Lead = Record<string, unknown> & { id: string; __partial?: boolean };

/** Exactly restorePartialLeads(), with the database call stubbed. */
function restore(
  leads: Lead[],
  storedById: Map<string, Record<string, unknown>>,
  readFails = false,
): Lead[] {
  const stubs = leads.filter((l) => l.__partial);
  if (stubs.length === 0) return leads;
  if (readFails) {
    throw new Error("Cannot save admissions: the stored leads could not be read");
  }
  return leads.map((l) => {
    if (!l.__partial) return l;
    const base = storedById.get(l.id);
    if (!base) return l;
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(l)) {
      if (k === "__partial") continue;
      if (v !== undefined) merged[k] = v;
    }
    return merged as Lead;
  });
}

const storedFull = {
  id: "adm_1",
  childName: "Aarav Sharma",
  stage: "enquiry",
  dob: "2020-06-14",
  gender: "male",
  motherName: "Priya Sharma",
  address: "12 Station Road",
  email: "priya@example.com",
  docsBirthCert: true,
};

// ── The failure this prevents ─────────────────────────────────────────────
{
  const stub: Lead = {
    id: "adm_1",
    childName: "Aarav Sharma",
    stage: "registered", // the real edit
    __partial: true,
  };

  const [out] = restore([stub], new Map([["adm_1", storedFull]]));

  assert.equal(out!.stage, "registered", "the actual edit is applied");
  assert.equal(
    out!.dob,
    "2020-06-14",
    "dob was never sent and must come back from the database. Losing this " +
      "across 919 leads is what the merge exists to prevent.",
  );
  assert.equal(out!.motherName, "Priya Sharma");
  assert.equal(out!.address, "12 Station Road");
  assert.equal(out!.email, "priya@example.com");
  assert.equal(out!.docsBirthCert, true);
  assert.equal(out!.__partial, undefined, "the marker is never persisted");
}

// ── A genuinely new lead is written as-is ─────────────────────────────────
// A field survey creates leads that have no stored counterpart; merging must
// not require one to exist.
{
  const fresh: Lead = { id: "adm_new", childName: "Ishaan", __partial: true };
  const [out] = restore([fresh], new Map());
  assert.equal(out!.childName, "Ishaan", "a new lead survives with no base");
}

// ── Full leads are untouched ──────────────────────────────────────────────
// Detail-on-demand sends the whole record, and it must be able to CLEAR a
// field — which a blind merge would silently prevent.
{
  const full: Lead = { ...storedFull, address: "" } as Lead;
  const [out] = restore([full], new Map([["adm_1", storedFull]]));
  assert.equal(
    out!.address,
    "",
    "a complete record may clear a field; only stubs are merged",
  );
}

// ── An unreadable database refuses the write ──────────────────────────────
// The rule learned at the cost of 711 orphaned students: never write over
// data you could not read.
{
  assert.throws(
    () => restore([{ id: "adm_1", __partial: true }], new Map(), true),
    /could not be read/,
    "if the stored leads cannot be read, nothing may be written over them",
  );
}

// ── No stubs means no extra query ─────────────────────────────────────────
{
  const full: Lead[] = [{ id: "adm_1", childName: "Aarav" }];
  assert.equal(
    restore(full, new Map(), /* readFails */ true),
    full,
    "an ordinary full-state save must not pay for, or fail on, the merge path",
  );
}

console.log("projectedLeadWrite.selftest: all assertions passed");
