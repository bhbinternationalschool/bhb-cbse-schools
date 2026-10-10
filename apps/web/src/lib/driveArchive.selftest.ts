/**
 * Self-test: where archived files are filed and what they are called.
 * Run: npx tsx apps/web/src/lib/driveArchive.selftest.ts
 */
import assert from "node:assert/strict";
import {
  driveViewUrl,
  mediaArchiveFileName,
  mediaArchiveFolder,
  receiptArchiveFileName,
  receiptArchiveFolder,
} from "@/lib/driveArchive";

assert.deepEqual(mediaArchiveFolder("site-media", new Date(2026, 8, 4)), ["Media", "Website & gallery", "2026", "09"]);
assert.deepEqual(mediaArchiveFolder("school-files", new Date(2027, 0, 15)), ["Media", "Private files", "2027", "01"]);
assert.equal(mediaArchiveFileName("gallery/annual-day/photo 3.jpg"), "photo 3.jpg");
assert.equal(mediaArchiveFileName("weird/../na?me*.png"), "na_me_.png");

assert.deepEqual(receiptArchiveFolder("2026-27", "2026-09-04"), ["Receipts", "2026-27", "2026-09"]);
assert.deepEqual(receiptArchiveFolder("", "not-a-date"), ["Receipts", "unknown-year", "unknown-month"], "a bad date must not vanish into a good-looking folder");
assert.equal(receiptArchiveFileName("R/2026-27/0123", false), "R_2026-27_0123.pdf");
assert.equal(receiptArchiveFileName("F/2026-27/7", true), "F_2026-27_7-VOID.pdf");

assert.equal(driveViewUrl("abc123"), "https://drive.google.com/file/d/abc123/view");
assert.equal(driveViewUrl(""), "", "no id, no link");

console.log("driveArchive.selftest: ok");
