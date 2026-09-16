/**
 * Run: npx tsx src/lib/examFormulaCatalog.selftest.ts
 *
 * Pins that the formula / symbol catalogue follows the paper's subject
 * (lib/examFormulaCatalog.ts): a Maths paper gets the Maths groups first,
 * Science spans Physics / Chemistry / Biology, Hindi and Sanskrit get the
 * Devanagari sets, every subject ends with the general symbols, and search
 * matches on the formula, its label or its group.
 */
import assert from "node:assert/strict";

import { catalogFor, FORMULA_CATALOG, groupsFor, searchCatalog, subjectKeysFor } from "./examFormulaCatalog";

console.log("examFormulaCatalog.selftest.ts");

assert.deepEqual(subjectKeysFor("Mathematics"), ["maths", "general"]);
assert.deepEqual(subjectKeysFor("Science"), ["science", "physics", "chemistry", "biology", "general"]);
assert.deepEqual(subjectKeysFor("Environmental Studies / World Around Us"), ["evs", "science", "general"]);
assert.deepEqual(subjectKeysFor("Sanskrit"), ["sanskrit", "hindi", "general"]);
assert.deepEqual(subjectKeysFor("Hindi"), ["hindi", "general"]);
assert.deepEqual(subjectKeysFor("Computer"), ["computer", "general"]);
assert.deepEqual(subjectKeysFor("Social Science"), ["sst", "general"]);
assert.deepEqual(subjectKeysFor("Computer Science"), ["computer", "general"], "not a science paper either");
assert.deepEqual(subjectKeysFor("Art Education"), ["general"], "an unknown subject still gets the general symbols");

const maths = catalogFor("Mathematics");
assert.ok(maths.length > 100, `maths catalogue is substantial (${maths.length})`);
assert.equal(maths[0]!.subject, "maths", "own subject first");
assert.equal(maths[maths.length - 1]!.subject, "general", "general last");
assert.ok(maths.some((f) => f.insert.startsWith("x = [−b ±")), "quadratic formula present");
assert.ok(!maths.some((f) => f.subject === "physics"), "no physics in a maths paper");

const physics = catalogFor("Physics");
assert.ok(physics.some((f) => f.insert === "V = IR"));
const hindi = catalogFor("Hindi");
assert.ok(hindi.some((f) => f.insert === "ा" && f.group === "मात्राएँ"), "matras for Hindi");
const sanskrit = catalogFor("Sanskrit");
assert.ok(sanskrit.some((f) => f.group === "व्यञ्जनानि"));
assert.ok(sanskrit.findIndex((f) => f.subject === "sanskrit") < sanskrit.findIndex((f) => f.subject === "hindi"), "Sanskrit groups before Hindi ones");

const groups = groupsFor(maths).map((g) => g.group);
assert.deepEqual(groups.slice(0, 3), ["Symbols", "Arithmetic", "Algebra"]);

assert.ok(searchCatalog(maths, "pythag").some((f) => f.insert.includes("a² + b² = c²")), "search by label");
assert.ok(searchCatalog(physics, "ohm").some((f) => f.insert === "V = IR"));
assert.equal(searchCatalog(maths, "zzzz").length, 0);
assert.equal(searchCatalog(maths, "").length, maths.length, "empty query = everything");

const dupes = FORMULA_CATALOG.filter((f, i, all) => all.findIndex((g) => g.subject === f.subject && g.group === f.group && g.insert === f.insert) !== i);
assert.equal(dupes.length, 0, `no duplicate entries within a group: ${dupes.map((d) => d.insert).join(", ")}`);

console.log("OK — examFormulaCatalog.selftest.ts");
