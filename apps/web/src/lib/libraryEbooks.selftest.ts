import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bookcaseCode, EBOOK_SHELF_CATALOGUE, EBOOK_SHELF_SEED, mergeEbookShelfSeed, normalizeEbook } from "./library";

/**
 * The e-book shelves (director, 12 Oct 2026: "Propel book links are
 * different for every class"). All 20 links were opened and read by title
 * that day. They were never stored on the server — the desk save dropped
 * `ebooks` and the apps read an empty blob — so they now have their own
 * store, start from this verified catalogue, and the office's own titles and
 * classes are never overwritten.
 */

console.log("libraryEbooks.selftest.ts");

// Every seeded link is catalogued, and every class from Nursery to 8 has a shelf.
for (const url of EBOOK_SHELF_SEED) assert.ok(EBOOK_SHELF_CATALOGUE[bookcaseCode(url)], `${url} is catalogued`);
const classes = new Set(Object.values(EBOOK_SHELF_CATALOGUE).flatMap((c) => c.classLabels));
for (const c of ["Nursery", "LKG", "UKG", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8"]) {
  assert.ok(classes.has(c), `${c} has a shelf`);
}
assert.deepEqual(EBOOK_SHELF_CATALOGUE.ooiny.classLabels, ["Class 6"], "New Prime Grade 6 is Class 6's shelf");
assert.equal(EBOOK_SHELF_CATALOGUE.vrsvv.subject, "Hindi");

// An empty store starts from the catalogue.
const fresh = mergeEbookShelfSeed([]).ebooks;
assert.equal(fresh.length, EBOOK_SHELF_SEED.length);
assert.equal(fresh.find((e) => e.id === "eb_acdlv")!.title, "Propel Edition A — Nursery");

// The office's own values stand; only blanks are filled.
const office = [
  normalizeEbook({ id: "eb_ooiny", url: "https://fliphtml5.com/bookcase/ooiny/", title: "Class 6 books (office)", classLabels: [] }),
];
const merged = mergeEbookShelfSeed(office).ebooks;
const six = merged.find((e) => e.id === "eb_ooiny")!;
assert.equal(six.title, "Class 6 books (office)", "an office title is kept");
assert.deepEqual(six.classLabels, ["Class 6"], "a blank class is filled");
assert.equal(merged.length, EBOOK_SHELF_SEED.length, "no shelf twice");
console.log("  ok  verified catalogue fills blanks; office values stand; every class has a shelf");

// ── Wiring ─────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const route = read("../app/api/school-data/library-desk/route.ts");
assert.ok(/mergeLibraryEbooks\(body\.ebooks\)/.test(route), "a library save stores the shelves it sends");
assert.ok(/\.\.\.\(ebooks \? \{ ebooks \} : \{\}\)/.test(route), "the library load returns the stored shelves");
const apps = read("../app/api/v1/library/ebooks/route.ts");
assert.ok(/readLibraryEbooks\(\)/.test(apps) && !/fetchServerBlob/.test(apps), "the apps read the shelves' own store, not the empty blob");
const store = read("libraryEbooks.server.ts");
assert.ok(/byId\.set\(e\.id, e\)/.test(store) && !/\.delete\(/.test(store), "merged by id; nothing removed by absence");
const client = read("libraryNormalizedClient.ts");
assert.ok(/ebooksHash !== ebooksBase/.test(client), "shelves are sent only when changed");
console.log("  ok  wiring: stored on save, served on load and to the apps");

console.log("\nAll library e-book checks passed.");
