/**
 * Self-test: a discount records WHY, and never invents one.
 * Run: npx tsx apps/web/src/lib/concessionGround.selftest.ts
 *
 * The defect this pins is not a crash — it is a field that looked filled in.
 * Every one of the 149 live grants carries a `reason`, and 108 of them say
 * "Fee Take · Counter concession · from Tuition Fee", which records where the
 * discount was applied, not why the family qualifies. 99 of the 120 children
 * on a concession therefore have one nobody can explain, renew on the same
 * basis, or defend to the parent next door paying full.
 *
 * Two properties have to hold together, and the second is the harder one:
 *
 *  1. A new grant carries a ground.
 *  2. An old grant's missing ground stays missing. Back-filling it — from the
 *     rule's name, from the amount, from anything — would turn "nobody wrote
 *     it down" into a fact about a real family's money, which is the defect
 *     class behind this whole week.
 */

import assert from "node:assert/strict";

import {
  CONCESSION_GROUNDS,
  concessionGroundFromKind,
  concessionGroundLabel,
  normalizeConcessionGrant,
} from "./masters";

console.log("concessionGround.selftest.ts");

// 1. A rule that declares its kind declares the ground. That is the rule
//    speaking, not a guess: a `sibling` rule grants a sibling discount.
for (const g of CONCESSION_GROUNDS) {
  assert.equal(
    concessionGroundFromKind(g.id),
    g.id,
    `kind ${g.id} should map to the ground of the same name`,
  );
}
assert.equal(concessionGroundFromKind("SIBLING"), "sibling");

// 2. A kind that says nothing about eligibility yields nothing. `transport`
//    is a fee head, not a reason a family qualifies; a school-invented kind
//    is unknown by definition. Both must come back empty so the person
//    granting is asked.
assert.equal(concessionGroundFromKind("transport"), "");
assert.equal(concessionGroundFromKind("principal_ka_beta"), "");
assert.equal(concessionGroundFromKind(""), "");

// 3. The absence is stated, not papered over.
assert.equal(concessionGroundLabel(""), "Not recorded");
assert.equal(concessionGroundLabel("nonsense"), "Not recorded");
assert.equal(concessionGroundLabel("staff_ward"), "Staff ward");

// 4. THE ONE THAT MATTERS. A grant written before 2026-09-08 has no ground,
//    and normalising it must not manufacture one — not from its reason text,
//    not from its concession, not from a default. If this assertion ever
//    fails because somebody added a fallback, the 108 unexplained grants
//    silently become 108 explained ones and the school loses the only
//    evidence that it does not know.
const legacy = normalizeConcessionGrant({
  id: "cg_old",
  concessionId: "cnc_sibling_150",
  studentId: "stu_1",
  status: "approved",
  reason: "Fee Take · Counter concession · from Tuition Fee · April",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  siblingChildNo: 2,
});
assert.equal(
  legacy.ground,
  "",
  "a grant with no recorded ground must stay without one",
);

// 5. A ground that was recorded survives the round trip; a bogus one does not
//    get through, because a value outside the list is not a ground either.
assert.equal(normalizeConcessionGrant({ ...legacy, ground: "hardship" }).ground, "hardship");
// Cast on purpose: the value arrives from the database as untyped JSON, so
// the type system is not standing guard here — normalize is.
assert.equal(
  normalizeConcessionGrant({ ...legacy, ground: "vibes" } as unknown as Parameters<
    typeof normalizeConcessionGrant
  >[0]).ground,
  "",
);

console.log("  ok — grounds are recorded when known and never invented");
