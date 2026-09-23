import assert from "node:assert/strict";
import {
  PUTER_SURFACES,
  assertPuterSafe,
  buildPosterPrompt,
  ocrFirstPassUsable,
  piiKinds,
  puterEnabled,
  puterPathNote,
  puterSurface,
} from "./puterAi";

console.log("puterAi.selftest.ts");

/* ── Off unless switched on ──────────────────────────────────────────── */

delete process.env.NEXT_PUBLIC_PUTER_ENABLED;
assert.equal(puterEnabled(), false, "absent flag = off");
process.env.NEXT_PUBLIC_PUTER_ENABLED = "";
assert.equal(puterEnabled(), false, "empty flag = off");
process.env.NEXT_PUBLIC_PUTER_ENABLED = "1";
assert.equal(puterEnabled(), false, "only the exact word turns it on");
process.env.NEXT_PUBLIC_PUTER_ENABLED = "TRUE";
assert.equal(puterEnabled(), false, "case matters — no accidental on");
process.env.NEXT_PUBLIC_PUTER_ENABLED = " true ";
assert.equal(puterEnabled(), true, "trimmed");

/* ── Every cleared surface names what runs instead ───────────────────── */

assert.ok(PUTER_SURFACES.length >= 1);
for (const s of PUTER_SURFACES) {
  assert.ok(s.fallback.trim().length > 0, `${s.id} must name its fallback`);
  assert.ok(s.maxChars > 0 && s.maxChars <= 4000, `${s.id} prompt cap`);
  assert.equal(puterSurface(s.id).id, s.id);
}
assert.throws(
  () => puterSurface("payroll" as never),
  /Unknown Puter surface/,
  "a surface nobody cleared cannot be called",
);

/* ── The DPDP fence ──────────────────────────────────────────────────── */

// Each identifier is found, whatever its spelling.
assert.deepEqual(piiKinds("Aadhaar 2345 6789 0123"), ["aadhaar_or_apaar"], "spaced 4-4-4");
assert.deepEqual(piiKinds("APAAR 234567890123"), ["aadhaar_or_apaar", "udise_or_long_id"]);
assert.ok(piiKinds("call 9876543210").includes("phone"));
assert.ok(piiKinds("call +91 9876543210").includes("phone"));
assert.ok(piiKinds("mail office@bhbinternational.school").includes("email"));
assert.ok(piiKinds("UDISE 09650104501").includes("udise_or_long_id"));
assert.ok(piiKinds("born 14/08/2015").includes("date_of_birth"));
assert.ok(piiKinds("born 14-08-2015").includes("date_of_birth"));
assert.ok(piiKinds("IFSC SBIN0001234").includes("account_number"));

// Ordinary marketing copy is not PII, and small numbers stay allowed —
// a fence that refuses "Class 10" would simply be switched off.
assert.deepEqual(piiKinds("Open house for Class 10 on Saturday, 42 seats"), []);
assert.deepEqual(piiKinds(""), []);

// Repeated calls give the same answer: the module-level /g regexes must not
// carry lastIndex between calls.
for (let i = 0; i < 3; i += 1) {
  assert.ok(piiKinds("call 9876543210").includes("phone"), `stable on pass ${i}`);
}

// The gate itself.
{
  const ok = assertPuterSafe("marketing_image", "  children planting saplings  ");
  assert.ok(ok.ok && ok.text === "children planting saplings", "trimmed and passed");
}
{
  const bad = assertPuterSafe("marketing_image", "poster for Riya, mother 9876543210");
  assert.ok(!bad.ok);
  if (bad.ok) throw new Error();
  assert.match(bad.reason, /phone number/);
  assert.match(bad.reason, /stays on the paid, India-hosted path/);
}
{
  const empty = assertPuterSafe("syllabus_ocr", "   ");
  assert.ok(!empty.ok && /Nothing to send/.test(empty.reason));
}
{
  const cap = puterSurface("syllabus_ocr").maxChars;
  const long = assertPuterSafe("syllabus_ocr", "a".repeat(cap + 1));
  assert.ok(!long.ok);
  if (long.ok) throw new Error();
  assert.match(long.reason, new RegExp(`${cap + 1} of ${cap}`));
  assert.ok(assertPuterSafe("syllabus_ocr", "a".repeat(cap)).ok, "exactly at the cap passes");
}

/* ── Poster prompts refuse text, faces and logos ─────────────────────── */

{
  const p = buildPosterPrompt({
    occasion: "Open house",
    subject: "children planting saplings",
    mood: "festive",
    style: "watercolour",
  });
  assert.match(p, /Open house — children planting saplings/);
  assert.match(p, /soft watercolour painting/);
  assert.match(p, /festive, bright, celebratory/);
  // The three non-negotiables.
  assert.match(p, /no text, letters, numbers, words or signage/i);
  assert.match(p, /No logos, crests or emblems/i);
  assert.match(p, /No close-up or recognisable faces/i);
  // Room for the headline the ERP writes.
  assert.match(p, /upper third/);
}
{
  // Empty brief still produces a usable, safe prompt rather than a blank one.
  const p = buildPosterPrompt({ occasion: "", subject: "", mood: "warm", style: "flat_vector" });
  assert.match(p, /Scene: a school day/);
  assert.match(p, /no text, letters, numbers/i);
  // An unknown mood/style falls back to the first rather than rendering
  // "undefined" into the prompt.
  const odd = buildPosterPrompt({ occasion: "x", subject: "", mood: "nope" as never, style: "nope" as never });
  assert.doesNotMatch(odd, /undefined/);
}
// The prompt itself must clear the same fence every other call clears.
assert.ok(
  assertPuterSafe(
    "marketing_image",
    buildPosterPrompt({ occasion: "Annual day", subject: "a stage with lamps", mood: "proud", style: "photo" }),
  ).ok,
  "our own prompt must not trip the fence",
);

/* ── A thin OCR read is a failure, not a result ──────────────────────── */

assert.equal(ocrFirstPassUsable(""), false);
assert.equal(ocrFirstPassUsable("Chapter 1"), false, "too short");
assert.equal(ocrFirstPassUsable("Chapter 1\nChapter 2"), false, "too few lines");
assert.equal(
  ocrFirstPassUsable("1 2 3\n4 5 6\n7 8 9\n10 11 12\n13 14 15 16 17 18"),
  false,
  "digits only — a bad scan, not a contents page",
);
assert.equal(
  ocrFirstPassUsable(
    ["1. Knowing Our Numbers", "2. Whole Numbers", "3. Playing With Numbers", "4. Basic Geometrical Ideas"].join("\n"),
  ),
  true,
);
// Devanagari counts as letters — a Hindi contents page must pass.
assert.equal(
  ocrFirstPassUsable(["१. वह चिड़िया जो", "२. बचपन", "३. नादान दोस्त", "४. चाँद से थोड़ी सी गप्पें"].join("\n")),
  true,
);

assert.match(puterPathNote("puter"), /check the lines/);
assert.match(puterPathNote("paid"), /school's own/);

console.log("OK — puterAi.selftest.ts");
