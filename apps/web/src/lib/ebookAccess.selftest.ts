/**
 * Self-test: e-book pass keys.
 * Run: npx tsx apps/web/src/lib/ebookAccess.selftest.ts
 *
 * A shared pass key is only as private as the least careful place it is
 * stored. Two of those places are easy to reach for and both leak it:
 *
 *   - a desk slice, which syncs to every browser and sits in localStorage
 *   - a NEXT_PUBLIC_ variable, which is inlined into the JS bundle at build
 *     time and served to every visitor, signed in or not
 *
 * So the key is read from the server environment only, and this file pins the
 * behaviour around it: never guessed, never substituted, and an unconfigured
 * shelf says so instead of handing back something that looks like a password.
 */

import assert from "node:assert/strict";

import { ebookAccess, keyForBook } from "./ebookAccess.server";
import {
  bookcaseCode,
  EBOOK_SHELF_SEED,
  mergeEbookShelfSeed,
  normalizeEbook,
  upsertEbookShelf,
  type LibraryEbook,
  type LibraryState,
} from "./library";

console.log("ebookAccess.selftest.ts");

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/* ── fully configured ───────────────────────────────────────── */

withEnv(
  {
    EBOOK_SHELF_URL: "https://fliphtml5.com/bookcase/ooiny/",
    EBOOK_SHELF_KEY: "shelfpass",
    EBOOK_BOOK_KEY: "bookpass",
  },
  () => {
    const a = ebookAccess();
    assert.equal(a.configured, true);
    assert.deepEqual(a.missing, []);
    assert.equal(keyForBook("shelf", a).key, "shelfpass");
    assert.equal(keyForBook("book", a).key, "bookpass");
    // "None" means none — not the shelf key handed over as a fallback.
    assert.equal(keyForBook("none", a).key, "");
    assert.ok(/No password/.test(keyForBook("none", a).label));
  },
);

/* ── THE protection: nothing configured yields nothing ──────── */

withEnv(
  { EBOOK_SHELF_URL: undefined, EBOOK_SHELF_KEY: undefined, EBOOK_BOOK_KEY: undefined },
  () => {
    const a = ebookAccess();
    assert.equal(a.configured, false);
    assert.equal(a.shelfKey, "", "no key is invented");
    assert.deepEqual(a.missing, ["EBOOK_SHELF_URL", "EBOOK_SHELF_KEY"]);
    // The reader is sent to the office, not to a password box with a blank.
    const k = keyForBook("shelf", a);
    assert.equal(k.key, "");
    assert.ok(/ask the school office/.test(k.label));
  },
);

/* ── a missing book key never falls back to the shelf key ───── */

// They protect different things. Handing over the shelf key for a book would
// widen access past what the school set up, and would fail at the provider
// anyway — leaving the parent convinced the school gave them a wrong password.
withEnv(
  {
    EBOOK_SHELF_URL: "https://example.test/shelf",
    EBOOK_SHELF_KEY: "shelfpass",
    EBOOK_BOOK_KEY: undefined,
  },
  () => {
    const a = ebookAccess();
    assert.equal(a.configured, true, "the shelf still works without a book key");
    const k = keyForBook("book", a);
    assert.equal(k.key, "", "no substitution");
    assert.notEqual(k.key, "shelfpass");
    assert.ok(/not set/.test(k.label));
  },
);

/* ── a URL with no key is not a configured shelf ────────────── */

withEnv(
  { EBOOK_SHELF_URL: "https://example.test/shelf", EBOOK_SHELF_KEY: undefined },
  () => {
    const a = ebookAccess();
    assert.equal(a.configured, false, "a link nobody can open is not configured");
    assert.deepEqual(a.missing, ["EBOOK_SHELF_KEY"]);
  },
);

/* ── whitespace is not a key ────────────────────────────────── */

withEnv(
  { EBOOK_SHELF_URL: "  ", EBOOK_SHELF_KEY: "   " },
  () => {
    assert.equal(ebookAccess().configured, false);
  },
);

/* ── an unreadable keyKind lands on the safe side ───────────── */

// "shelf" tells the reader a password is needed. "none" tells them it is not,
// and a parent who believes that hits a password box and calls the office.
assert.equal(normalizeEbook({ keyKind: "nonsense" as never }).keyKind, "shelf");
assert.equal(normalizeEbook({}).keyKind, "shelf");
assert.equal(normalizeEbook({ keyKind: "none" }).keyKind, "none");
assert.equal(normalizeEbook({ keyKind: "book" }).keyKind, "book");

/* ── a catalogue row keeps only what it should ──────────────── */

const row = normalizeEbook({
  id: "eb1",
  title: "  Class 6 Science  ",
  classLabels: ["VI", "", "  VII "],
  url: " https://example.test/b1 ",
});
assert.equal(row.title, "Class 6 Science");
assert.deepEqual(row.classLabels, ["VI", "VII"], "blank class labels are dropped");
assert.equal(row.url, "https://example.test/b1");
assert.equal(row.isActive, true, "rows are active unless said otherwise");
// The record itself must never carry a key — it syncs to every browser.
assert.equal("passKey" in row, false);
assert.equal(JSON.stringify(row).includes("pass"), false);

/* ── the 20 shelves seed once and only once ─────────────────── */

// The list supplied had one URL twice; the seed keeps 20 distinct shelves.
assert.equal(EBOOK_SHELF_SEED.length, 20, "twenty distinct bookcases");
const codes = EBOOK_SHELF_SEED.map(bookcaseCode);
assert.equal(new Set(codes).size, 20, "no duplicate bookcase codes in the seed");
assert.ok(codes.every((c) => /^[a-z0-9]+$/.test(c)), "every code parses");

// A stable id from the URL, so re-importing matches rather than duplicates.
assert.equal(bookcaseCode("https://fliphtml5.com/bookcase/ooiny/"), "ooiny");
assert.equal(bookcaseCode("HTTPS://FLIPHTML5.COM/BOOKCASE/OOINY"), "ooiny", "case-insensitive");
assert.equal(bookcaseCode("not a url"), "", "junk yields no code, not a guess");

/* ── seeding an empty catalogue ─────────────────────────────── */

const first = mergeEbookShelfSeed([]);
assert.equal(first.added, 20);
assert.equal(first.ebooks.length, 20);
// Seeded shelves carry NO title — the office names them; nothing is invented.
assert.ok(first.ebooks.every((e) => e.title === ""), "no title is fabricated");
assert.ok(first.ebooks.every((e) => e.keyKind === "shelf"));
assert.ok(first.ebooks.every((e) => e.isActive));

/* ── THE protection: a second run adds nothing, and preserves names ── */

// The office has titled one shelf. Re-importing must not wipe that title or
// duplicate the shelf.
const titled: LibraryEbook[] = first.ebooks.map((e) =>
  bookcaseCode(e.url) === "ooiny"
    ? { ...e, title: "Class 6 Science", subject: "Science", classLabels: ["VI"] }
    : e,
);
const second = mergeEbookShelfSeed(titled);
assert.equal(second.added, 0, "nothing new on a re-run");
assert.equal(second.ebooks.length, 20, "no duplicate shelf");
const ooiny = second.ebooks.find((e) => bookcaseCode(e.url) === "ooiny")!;
assert.equal(ooiny.title, "Class 6 Science", "an office-set title survives re-import");
assert.deepEqual(ooiny.classLabels, ["VI"]);

/* ── a partial catalogue tops up the missing shelves only ───── */

const partial = mergeEbookShelfSeed([
  normalizeEbook({ id: "eb_ooiny", url: "https://fliphtml5.com/bookcase/ooiny/", title: "Kept" }),
]);
assert.equal(partial.added, 19, "the other nineteen are added");
assert.equal(partial.ebooks.find((e) => bookcaseCode(e.url) === "ooiny")!.title, "Kept");

/* ── labelling a shelf: the "which class/subject" answer ────── */

// The codes are opaque and nothing can read the shelf, so a teacher decides.
// upsertEbookShelf records that decision against the bookcase code, once.
const baseState = {
  version: 2,
  titles: [],
  ebooks: mergeEbookShelfSeed([]).ebooks,
  copies: [],
  issues: [],
  procurementDocs: [],
  settings: { maxBooksPerStudent: 3, maxBooksPerStaff: 5, loanDays: 14, finePaisePerDay: 100 },
} as unknown as LibraryState;

const labelled = upsertEbookShelf(baseState, {
  url: "https://fliphtml5.com/bookcase/acdlv/",
  title: "Class 6 Science",
  subject: "Science",
  classLabels: ["VI"],
});
assert.ok(!("error" in labelled), "a valid shelf link labels");
if ("error" in labelled) throw new Error("unreachable");
assert.equal(labelled.state.ebooks.length, 20, "labelling matches, never adds a duplicate");
const acdlv = labelled.state.ebooks.find((e) => bookcaseCode(e.url) === "acdlv")!;
assert.equal(acdlv.title, "Class 6 Science");
assert.deepEqual(acdlv.classLabels, ["VI"]);

// A second teacher tags only the class — the title the first set survives.
const again = upsertEbookShelf(labelled.state, {
  url: "https://fliphtml5.com/bookcase/acdlv/",
  classLabels: ["VI", "VII"],
});
if ("error" in again) throw new Error("unreachable");
const acdlv2 = again.state.ebooks.find((e) => bookcaseCode(e.url) === "acdlv")!;
assert.equal(acdlv2.title, "Class 6 Science", "a partial update keeps fields it did not touch");
assert.deepEqual(acdlv2.classLabels, ["VI", "VII"]);

// A shelf that was not in the seed is added, not rejected.
const added = upsertEbookShelf(baseState, {
  url: "https://fliphtml5.com/bookcase/newone/",
  title: "New book",
});
if ("error" in added) throw new Error("unreachable");
assert.equal(added.state.ebooks.length, 21);

// Junk is refused rather than stored as a shelf with no code.
assert.ok("error" in upsertEbookShelf(baseState, { url: "not a link" }));

console.log("  ok");
