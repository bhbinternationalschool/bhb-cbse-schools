import assert from "node:assert/strict";
import {
  assetsForChapter,
  assetsLine,
  isRevisionAsset,
  isWorksheetAsset,
  normalizePinnacleAssets,
  pinnacleAssetsUrl,
} from "./pinnacleAssets";

/* ── the robot's scan, cleaned (real Smart Teach cards, 12 Oct 2026) ── */

const index = normalizePinnacleAssets([
  {
    bookId: 306,
    title: "Click Code Connect - 4",
    path: "306/ccc_g4",
    chapters: [
      {
        name: "Ch1: Computer—Past and Present",
        assets: [
          { type: "Mind Map", title: "Computer - Past and Present - Mind Map" },
          { type: "Animation", title: "Early Calculating Devices" },
          { type: "Activity Based Worksheet", title: "Computer - Past and Present - Activity-Based Worksheet" },
          { type: "Animation", title: "Early Calculating Devices" },
          { type: "Unknown", title: "" },
          { type: "Unknown", title: "NEP Worksheet" },
        ],
      },
      { name: "Ch2: Computer Memory and Storage Devices", assets: [{ type: "Game", title: "Memory - An Activity" }] },
      { name: "Ch3: Managing Files", assets: [] },
      { name: "Book Answer Key", assets: [{ type: "Book Answer Key", title: "Answers" }] },
    ],
  },
  { bookId: 639, title: "Know and Grow Gr 5 (2024 Edition)", path: "639/kag_g5_5e", chapters: [{ name: "Current Affairs Updates", assets: [] }, { name: "Ch1: India’s Largest and Smallest", assets: [{ type: "Game", title: "Largest" }] }] },
  { bookId: 191, title: "Tip-Tap-Toe Rhymes and Stories - Nursery", path: "191/x", chapters: [{ name: "Ch:1 The Greedy Dog", assets: [{ type: "Animation", title: "Greedy Dog" }] }] },
  { bookId: 0, title: "Click Code Connect - 5", path: "0/x", chapters: [] },
  { bookId: 999, title: "Some other series 3", path: "999/x", chapters: [{ name: "Ch1: A", assets: [{ type: "Game", title: "A" }] }] },
]);

assert.deepEqual(index.map((b) => [b.bookId, b.grade, b.subjectKey]), [[306, 4, "computer"], [639, 5, "gk"], [191, -2, ""]]);
const ccc = index[0]!;
assert.equal(ccc.chapters.length, 2, "empty chapters and the answer key are dropped");
assert.equal(ccc.chapters[0]!.number, 1);
assert.deepEqual(
  ccc.chapters[0]!.assets.map((a) => a.type),
  ["Animation", "Mind Map", "Activity Based Worksheet", "Worksheet"],
  "duplicates and empty Unknown dropped; a titled Unknown worksheet kept; animation first",
);

/* ── lookup: by name, else by the publisher's number ── */

const byName = assetsForChapter(index, 4, "computer", "Computer—Past and Present", 1)!;
assert.equal(byName.chapter, "Computer—Past and Present");
assert.equal(byName.url, pinnacleAssetsUrl(306));
assert.equal(byName.url, "https://teacher.pinnaclelearning.in/book?bookId=306&userRole=teacher&activeTab=assets");
assert.equal(assetsForChapter(index, 4, "computer", "Computer Memory and Storage Devices", 9)!.chapter, "Computer Memory and Storage Devices", "name wins over number");
assert.equal(assetsForChapter(index, 4, "computer", "", 2)!.chapter, "Computer Memory and Storage Devices", "number when the name is unknown");
assert.equal(assetsForChapter(index, 4, "computer", "Unrelated", 7), null);
assert.equal(assetsForChapter(index, 4, "maths", "Computer—Past and Present", 1), null, "another subject's book is never used");
assert.equal(assetsForChapter(index, -2, "", "The Greedy Dog", 1), null, "no ERP subject, no lookup");

/* ── what each screen shows ── */

const assets = byName.assets;
assert.deepEqual(assets.filter(isWorksheetAsset).map((a) => a.type), ["Activity Based Worksheet", "Worksheet"]);
assert.deepEqual(assets.filter(isRevisionAsset).map((a) => a.type), ["Animation", "Mind Map"]);
assert.equal(assetsLine(assets, 2), "Animation: Early Calculating Devices · Mind Map: Computer - Past and Present - Mind Map · +2 more");
assert.deepEqual(normalizePinnacleAssets(null), []);

console.log("pinnacleAssets.selftest.ts\n  ok");
