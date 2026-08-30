import assert from "node:assert/strict";
import {
  emptyDocFile,
  emptyStudentDocs,
  normalizeStudent,
  normalizeStudentDocs,
} from "./sis";
import {
  isEmptyDocSlot,
  stripEmptyDocsForWire,
  stripEmptyDocsList,
  stripEmptyForWire,
} from "./wirePayload";

console.log("sisWirePayload.selftest.ts");

/**
 * Stripping the empty document skeleton must be LOSSLESS.
 *
 * The claim is not "these fields look unimportant" — it is that the client
 * rebuilds them byte-for-byte, because `loadSis()` normalises every student
 * on every read. That is a property of the normaliser, so the normaliser is
 * what this tests. If someone gives a document field a non-empty default,
 * these assertions fail and the stripper must be reconsidered.
 */

// ── The stripper's idea of "empty" must match the normaliser's ──────────
{
  assert.ok(
    isEmptyDocSlot(emptyDocFile()),
    "emptyDocFile() must be recognised as empty, or nothing is ever stripped",
  );

  // Anything at all in the slot keeps it on the wire.
  assert.equal(isEmptyDocSlot({ ...emptyDocFile(), status: "pending" }), false);
  assert.equal(isEmptyDocSlot({ ...emptyDocFile(), status: "rejected" }), false);
  assert.equal(
    isEmptyDocSlot({ ...emptyDocFile(), fileUrl: "https://x/y.pdf" }),
    false,
  );
  assert.equal(
    isEmptyDocSlot({ ...emptyDocFile(), reviewNote: "blurred scan" }),
    false,
    "a review note is real content even with no file",
  );
  assert.equal(
    isEmptyDocSlot({ ...emptyDocFile(), size: 1024 }),
    false,
    "a size means a file existed",
  );
  assert.equal(isEmptyDocSlot(null), false);
  assert.equal(isEmptyDocSlot("missing"), false);
}

// ── An all-empty docs object is dropped, and rebuilt identically ────────
{
  const docs = emptyStudentDocs();
  const stripped = stripEmptyDocsForWire({ id: "st1", docs });
  assert.ok(!("docs" in stripped), "an entirely empty docs object goes");

  // The round trip that matters.
  assert.deepEqual(
    normalizeStudentDocs(undefined),
    docs,
    "the normaliser must rebuild exactly what was dropped",
  );
}

// ── A partly-filled docs object keeps only what is real ─────────────────
{
  const docs = {
    ...emptyStudentDocs(),
    tc: { ...emptyDocFile(), status: "received", fileUrl: "https://x/tc.pdf" },
  };
  const stripped = stripEmptyDocsForWire({ id: "st1", docs }) as {
    docs?: Record<string, unknown>;
  };
  assert.deepEqual(
    Object.keys(stripped.docs ?? {}),
    ["tc"],
    "only the slot holding something survives",
  );

  // And the six dropped slots come back empty, the one kept comes back whole.
  const rebuilt = normalizeStudentDocs(
    stripped.docs as Parameters<typeof normalizeStudentDocs>[0],
  );
  assert.deepEqual(rebuilt.tc.fileUrl, "https://x/tc.pdf");
  assert.deepEqual(rebuilt.birthCert, emptyDocFile());
  assert.deepEqual(rebuilt.aadhaar, emptyDocFile());
}

// ── The whole student survives the wire, normalised ─────────────────────
{
  // A student as the server holds one: every field present, docs all empty.
  const original = normalizeStudent({
    id: "st1",
    fullName: "Anaya Kumari",
    admissionNo: "ADM-0879",
    householdId: "hh1",
    classId: "c4",
    sectionId: "s4b",
    status: "active",
    academicYearCode: "2026-27",
    fatherName: "Rakesh Kumar",
    fatherMobile: "9990001111",
  });

  // What the wire would now carry: both strips applied, as the route does.
  const onWire = stripEmptyDocsForWire(
    stripEmptyForWire(original as unknown as Record<string, unknown>),
  );

  // What the browser reconstructs on read.
  const rebuilt = normalizeStudent(
    onWire as Parameters<typeof normalizeStudent>[0],
  );

  assert.deepEqual(
    rebuilt,
    original,
    "a stripped student must normalise back to exactly the original",
  );

  // And the strip has to actually be doing something, or this proves nothing.
  const before = JSON.stringify(original).length;
  const after = JSON.stringify(onWire).length;
  assert.ok(
    after < before * 0.5,
    `expected the wire form to be much smaller; got ${after} vs ${before}`,
  );
}

// ── The list helper leaves records with real docs alone ─────────────────
{
  const withFile = {
    id: "st2",
    docs: {
      ...emptyStudentDocs(),
      photo: { ...emptyDocFile(), fileUrl: "https://x/p.jpg" },
    },
  };
  const [out] = stripEmptyDocsList([withFile]);
  assert.deepEqual(Object.keys((out as { docs: object }).docs), ["photo"]);

  // A record with no docs key at all must pass through untouched.
  const plain = { id: "st3", fullName: "No Docs" };
  assert.deepEqual(stripEmptyDocsList([plain])[0], plain);
}

console.log("sisWirePayload.selftest: all assertions passed");
