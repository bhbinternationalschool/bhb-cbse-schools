import assert from "node:assert/strict";
import { normalizePinnacleBooks, pinnacleChapterName, pinnacleClassName } from "./pinnacleBooks";
import { propelFullBookCheck } from "./propelRobot";

/* ── class from the title, else the CDN folder (real Smart Teach entries, 12 Oct 2026) ── */

assert.equal(pinnacleClassName("Click Code Connect - 1", "311/ccc_g1"), "Class1");
assert.equal(pinnacleClassName("Click Code Connect", "177/ccc_g2"), "Class2", "untitled grade comes from the folder");
assert.equal(pinnacleClassName("Know and Grow Gr 3 (2024 Edition)", "637/kag_g3_5e"), "Class3", "2024 is a year, not a class");
assert.equal(pinnacleClassName("New Longman Vistas (NEP edition) 4", "285/newvistasgrade4"), "Class4");
assert.equal(pinnacleClassName("Know and Grow", "83/9789358930894_know_and_grow_g8"), "Class8");
assert.equal(pinnacleClassName("Tip-Tap-Toe Rhymes and Stories - LKG", "190/level_2_rhymes_stories_cb"), "LKG");
assert.equal(pinnacleClassName("Something", "999/unknown"), "", "no class is guessed");

/* ── chapter names lose their numbering; answer keys are not chapters ── */

assert.equal(pinnacleChapterName("Ch1: Computer—A Smart Machine"), "Computer—A Smart Machine");
assert.equal(pinnacleChapterName("Ch:3 Early to Bed"), "Early to Bed");
assert.equal(pinnacleChapterName("I Am a Little Teapot"), "I Am a Little Teapot");
assert.equal(pinnacleChapterName("Book Answer Key"), "");
assert.equal(pinnacleChapterName("Infographic: Computer System"), "");

/* ── the scan, cleaned ── */

const books = normalizePinnacleBooks([
  { title: "Click Code Connect - 1", path: "311/ccc_g1", chapters: ["Ch1: Computer—A Smart Machine", "Ch2: Parts of a Computer", "Ch3: Uses of a Computer", "Cyber Olympiad", "Software Space", "Book Answer Key"] },
  { title: "Click Code Connect - 1", path: "311/ccc_g1", chapters: ["Ch1: Duplicate"] },
  { title: "Tip-Tap-Toe Rhymes and Stories - Nursery", path: "191/level_1_nursery_rymes_cb", chapters: ["Ch:1 The Greedy Dog"] },
  { title: "Unknown series 3", path: "1/x", chapters: ["Ch1: A"] },
  { title: "Know and Grow Gr 2 (2024 Edition)", path: "636/kag_g2_5e", chapters: [] },
]);
assert.equal(books.length, 2, "duplicates, unknown series and empty books are dropped");
const ccc = books.find((b) => b.subject === "Computer")!;
assert.equal(ccc.className, "Class1");
assert.deepEqual(ccc.units, ["Computer—A Smart Machine", "Parts of a Computer", "Uses of a Computer"]);
assert.equal(books.find((b) => b.subject === "Rhymes and Stories")!.className, "Nursery");
// Unnumbered books keep every entry (Tip-Tap-Toe LKG lists rhymes plainly).
const [lkg] = normalizePinnacleBooks([{ title: "Tip-Tap-Toe Rhymes and Stories - LKG", path: "190/x", chapters: ["I Am a Little Teapot", "Bits of Paper"] }]);
assert.deepEqual(lkg.units, ["I Am a Little Teapot", "Bits of Paper"]);
assert.deepEqual(normalizePinnacleBooks("nope"), []);

/* ── compared with the ERP's book, both ways ── */

const erp = new Map([["Class1|Computer", ["Computer—A Smart Machine", "Parts of a Computer", "Uses of Computer", "Storage Devices"]]]);
const [check] = propelFullBookCheck([ccc], (c, s) => erp.get(`${c}|${s}`) ?? null, null);
assert.equal(check.sameStructure, true);
assert.deepEqual(check.missingInErp, ["Uses of a Computer"]);
assert.deepEqual(check.notOnPropel, ["Uses of Computer", "Storage Devices"]);

console.log("pinnacleBooks.selftest.ts\n  ok");
