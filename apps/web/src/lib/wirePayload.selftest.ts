/**
 * Stripping empties off the wire must be reversible, or it is data loss.
 *
 * A lead ships with all 79 fields whether or not they hold anything, because
 * emptyAdmissionLead() builds a complete object literal. Measured on all 919
 * production leads: 1.826 MB, of which 0.686 MB (37.5%) is empty strings and
 * nulls that the client will recreate anyway.
 *
 * The whole change rests on one property of the client's normalizers:
 *
 *     address: partial?.address || ""
 *
 * absent and "" produce the same result. This file pins that property, and —
 * more importantly — pins the cases where it does NOT hold.
 *
 * `false` and `0` are not rebuildable:
 *
 *     whatsappSame: partial?.whatsappSame !== false
 *
 * Omit that key and false returns as true, silently re-pointing a parent's
 * WhatsApp number. The first version of this stripped false and 0 and saved
 * 51% instead of 37.5%. That extra 13.5% was a corruption bug.
 *
 * Run: npx tsx src/lib/wirePayload.selftest.ts
 */
import assert from "node:assert/strict";
import { stripEmptyForWire, stripEmptyList } from "./wirePayload";

/** The client's defaulting, exactly as emptyAdmissionLead does it. */
function rebuild(wire: Record<string, unknown>) {
  return {
    id: (wire.id as string) || "",
    childName: (wire.childName as string) || "",
    address: (wire.address as string) || "",
    locality: (wire.locality as string) || "",
    // the boolean that must NOT be inferred from absence
    whatsappSame: wire.whatsappSame !== false,
    registrationFeeAmountPaise: (wire.registrationFeeAmountPaise as number) ?? 0,
  };
}

// ── The round trip is byte-identical ──────────────────────────────────────
{
  const full = {
    id: "adm_1",
    childName: "Aarav Sharma",
    address: "",
    locality: "",
    whatsappSame: true,
    registrationFeeAmountPaise: 0,
  };

  const wire = stripEmptyForWire(full);
  assert.deepEqual(
    rebuild(wire as Record<string, unknown>),
    full,
    "a stripped record must rebuild to exactly what was sent",
  );
  assert.equal("address" in wire, false, "empty strings are dropped");
  assert.equal("childName" in wire, true, "real values are kept");
}

// ── false is NEVER stripped ───────────────────────────────────────────────
// This is the corruption the first version would have shipped.
{
  const full = {
    id: "adm_2",
    childName: "Ishaan",
    address: "",
    locality: "",
    whatsappSame: false, // parent uses a DIFFERENT WhatsApp number
    registrationFeeAmountPaise: 0,
  };

  const wire = stripEmptyForWire(full);
  assert.equal(
    "whatsappSame" in wire,
    true,
    "false must survive — `x !== false` turns an absent key into true, which " +
      "silently re-points a parent's WhatsApp number",
  );
  assert.equal(
    rebuild(wire as Record<string, unknown>).whatsappSame,
    false,
    "and it must rebuild as false",
  );
}

// ── 0 is never stripped ───────────────────────────────────────────────────
// A fee of zero is a fact. Absent would also rebuild to 0 here, but other
// consumers use `?? default`, where absent and 0 differ.
{
  const wire = stripEmptyForWire({ id: "adm_3", registrationFeeAmountPaise: 0 });
  assert.equal("registrationFeeAmountPaise" in wire, true, "0 is a value");
}

// ── null is stripped, and rebuilds the same ───────────────────────────────
{
  const wire = stripEmptyForWire({ id: "adm_4", locality: null });
  assert.equal("locality" in wire, false);
  assert.equal(rebuild(wire as Record<string, unknown>).locality, "");
}

// ── id survives even when empty ───────────────────────────────────────────
// It is the join key for every merge; absent-vs-empty is not a distinction
// worth saving 8 bytes on.
{
  const wire = stripEmptyForWire({ id: "", childName: "X" });
  assert.equal("id" in wire, true, "id is kept by default");
}

// ── Nested structures are untouched ───────────────────────────────────────
// docs / sisStudentInfo have their own defaulting rules this does not know.
{
  const wire = stripEmptyForWire({
    id: "adm_5",
    docs: { birthCert: "", photo: "" },
    tags: [],
  }) as Record<string, unknown>;
  assert.deepEqual(wire.docs, { birthCert: "", photo: "" }, "nested untouched");
  assert.deepEqual(wire.tags, [], "an empty ARRAY is a value, not an empty");
}

// ── Lists ─────────────────────────────────────────────────────────────────
{
  const out = stripEmptyList([
    { id: "a", childName: "A", address: "" },
    { id: "b", childName: "", address: "Main Road" },
  ]);
  assert.equal(out.length, 2);
  assert.equal("address" in out[0]!, false);
  assert.equal("childName" in out[1]!, false);
  assert.equal((out[1] as Record<string, unknown>).address, "Main Road");
}

console.log("wirePayload.selftest: all assertions passed");
