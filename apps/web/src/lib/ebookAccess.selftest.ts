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
import { normalizeEbook } from "./library";

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

console.log("  ok");
