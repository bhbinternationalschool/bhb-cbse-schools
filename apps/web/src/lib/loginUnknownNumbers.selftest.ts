/**
 * Run: npx tsx src/lib/loginUnknownNumbers.selftest.ts
 */
import assert from "node:assert/strict";
import {
  UNKNOWN_LOGIN_CAP,
  emptyUnknownLoginState,
  normalizeUnknownLoginState,
  recordUnknownLogin,
  setUnknownLoginDone,
} from "@/lib/loginUnknownNumbers";

let s = emptyUnknownLoginState();
s = recordUnknownLogin(s, "9876543210", "parent", "2026-10-09T10:00:00Z");
s = recordUnknownLogin(s, "9876543210", "parent", "2026-10-09T10:01:00Z");
s = recordUnknownLogin(s, "9123456789", "parent", "2026-10-09T10:02:00Z");
assert.equal(s.numbers.length, 2, "one row per number");
assert.equal(s.numbers.find((n) => n.mobile10 === "9876543210")!.attempts, 2);
assert.equal(s.numbers.find((n) => n.mobile10 === "9876543210")!.firstAt, "2026-10-09T10:00:00Z");
assert.equal(s.numbers[0].mobile10, "9123456789", "newest first");
assert.equal(recordUnknownLogin(s, "12345", "parent", "x"), s, "not a 10-digit number: ignored");

// Staff and parent tries of the same number are separate rows.
s = recordUnknownLogin(s, "9123456789", "staff", "2026-10-09T10:03:00Z");
assert.equal(s.numbers.length, 3);

// Handled, then a new try reopens it.
s = setUnknownLoginDone(s, { mobile10: "9876543210", app: "parent", done: true, by: "office", note: "added to family", now: "2026-10-09T11:00:00Z" });
const handled = s.numbers.find((n) => n.mobile10 === "9876543210")!;
assert.equal(handled.doneBy, "office");
assert.equal(handled.note, "added to family");
s = recordUnknownLogin(s, "9876543210", "parent", "2026-10-09T12:00:00Z");
assert.equal(s.numbers.find((n) => n.mobile10 === "9876543210")!.doneAt, "", "a new try after 'handled' reopens it");
assert.equal(s.numbers.find((n) => n.mobile10 === "9876543210")!.attempts, 3);

// Cap: handled rows go first.
let big = emptyUnknownLoginState();
for (let i = 0; i < UNKNOWN_LOGIN_CAP; i++) big = recordUnknownLogin(big, String(9000000000 + i), "parent", `2026-10-09T00:00:${String(i % 60).padStart(2, "0")}Z`);
big = setUnknownLoginDone(big, { mobile10: "9000000000", app: "parent", done: true, by: "o", note: "", now: "z" });
big = recordUnknownLogin(big, "8000000000", "parent", "2026-10-09T23:00:00Z");
assert.equal(big.numbers.length, UNKNOWN_LOGIN_CAP);
assert.ok(!big.numbers.some((n) => n.mobile10 === "9000000000"), "the handled row is dropped first");
assert.ok(big.numbers.some((n) => n.mobile10 === "8000000000"));

// Junk rows from storage are dropped.
assert.equal(normalizeUnknownLoginState({ numbers: [{ mobile10: "abc" }, { mobile10: "9876543210", attempts: 0 }] }).numbers[0].attempts, 1);
console.log("loginUnknownNumbers selftest: ok");
