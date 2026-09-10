/**
 * Run: npx tsx src/lib/waAudienceSpec.selftest.ts
 *
 * The dangerous mistake on this screen is aiming, so most of these are
 * about a bad audience being REFUSED rather than defaulting to everyone.
 */
import assert from "node:assert/strict";
import {
  describeWaAudience,
  isWholeSchoolAudience,
  parseWaAudienceSpec,
} from "./waAudienceSpec";

console.log("waAudienceSpec.selftest.ts");

// --- a missing or unknown audience is refused, never defaulted ----------
{
  // Every plausible default here is a whole-school send, so there is no
  // safe fallback to pick.
  for (const bad of [null, undefined, {}, "parents", { kind: "" }, { kind: "everyone" }]) {
    const r = parseWaAudienceSpec(bad);
    assert.equal(r.ok, false, `should refuse ${JSON.stringify(bad)}`);
  }
}

// --- staff streams ------------------------------------------------------
{
  const r = parseWaAudienceSpec({ kind: "staff", stream: "teaching" });
  assert.ok(r.ok);
  assert.equal(r.spec.kind, "staff");

  assert.equal(
    parseWaAudienceSpec({ kind: "staff", stream: "faculty" }).ok,
    false,
    "an unknown stream must not silently widen to all staff",
  );

  // No stream given means all staff — stated, not inferred.
  const all = parseWaAudienceSpec({ kind: "staff" });
  assert.ok(all.ok);
  assert.equal(isWholeSchoolAudience(all.spec), true);
}

// --- narrowing takes a staff audience out of "everyone" ------------------
{
  const dept = parseWaAudienceSpec({
    kind: "staff",
    departmentIds: ["dept_1"],
  });
  assert.ok(dept.ok);
  assert.equal(isWholeSchoolAudience(dept.spec), false);

  const teaching = parseWaAudienceSpec({ kind: "staff", stream: "teaching" });
  assert.ok(teaching.ok);
  assert.equal(isWholeSchoolAudience(teaching.spec), false);
}

// --- parents: unpicked means everyone, and that is flagged --------------
{
  const all = parseWaAudienceSpec({ kind: "parents" });
  assert.ok(all.ok);
  assert.equal(isWholeSchoolAudience(all.spec), true);
  assert.equal(describeWaAudience(all.spec), "All parents");

  const oneClass = parseWaAudienceSpec({ kind: "parents", classIds: ["c1"] });
  assert.ok(oneClass.ok);
  assert.equal(isWholeSchoolAudience(oneClass.spec), false);
  assert.equal(
    describeWaAudience(oneClass.spec, { classes: { c1: "V" } }),
    "Parents of Class V",
  );

  // Empty arrays are the same as not picking — they must not read as a
  // narrowed audience and skip the whole-school confirmation.
  const empties = parseWaAudienceSpec({
    kind: "parents",
    classIds: [],
    sectionIds: [],
  });
  assert.ok(empties.ok);
  assert.equal(isWholeSchoolAudience(empties.spec), true);
}

// --- ids are deduped and trimmed ---------------------------------------
{
  const r = parseWaAudienceSpec({
    kind: "parents",
    classIds: ["c1", " c1 ", "c2", "", "  "],
  });
  assert.ok(r.ok);
  assert.deepEqual(
    r.spec.kind === "parents" ? r.spec.classIds : [],
    ["c1", "c2"],
  );
}

// --- fee stages: known values only, and at least one -------------------
{
  assert.equal(parseWaAudienceSpec({ kind: "fee_stage", stages: [] }).ok, false);
  assert.equal(
    parseWaAudienceSpec({ kind: "fee_stage", stages: ["S9"] }).ok,
    false,
  );
  const r = parseWaAudienceSpec({ kind: "fee_stage", stages: ["s2", "S3"] });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.kind === "fee_stage" ? r.spec.stages : [], [
    "S2",
    "S3",
  ]);
  // A fee stage is never "everyone", however many stages are picked.
  assert.equal(isWholeSchoolAudience(r.spec), false);
}

// --- hand-picked students ----------------------------------------------
{
  assert.equal(
    parseWaAudienceSpec({ kind: "students", studentIds: [] }).ok,
    false,
    "an empty pick must not become a broadcast",
  );
  const r = parseWaAudienceSpec({ kind: "students", studentIds: ["s1", "s1"] });
  assert.ok(r.ok);
  assert.equal(describeWaAudience(r.spec), "1 selected student");
  assert.equal(isWholeSchoolAudience(r.spec), false);
}

// --- the description always names the audience, never a bare noun -------
{
  const staff = parseWaAudienceSpec({
    kind: "staff",
    stream: "non_teaching",
    departmentIds: ["d1"],
  });
  assert.ok(staff.ok);
  const text = describeWaAudience(staff.spec, { departments: { d1: "Transport" } });
  assert.match(text, /Non-teaching staff/);
  assert.match(text, /Transport/);
  assert.notEqual(text, "staff");
}

console.log("OK — waAudienceSpec.selftest.ts");
