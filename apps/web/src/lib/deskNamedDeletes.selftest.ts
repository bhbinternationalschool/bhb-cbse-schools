import assert from "node:assert/strict";
import {
  confirmDeskDeletes,
  pendingDeskDeletes,
  recordDeskDeletion,
  resetDeskDeletesForTest,
} from "./deskNamedDeletes";
import { readNamedDeletes } from "./deskNamedDeletes.server";

console.log("deskNamedDeletes.selftest.ts");

// A minimal localStorage, so the tracker's persistence is exercised.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

// Recorded deletions ride the next push and survive a reload.
recordDeskDeletion("d", "t_a", ["1", "2"]);
recordDeskDeletion("d", "t_a", ["2"]);
recordDeskDeletion("d", "t_b", ["x"]);
assert.deepEqual(pendingDeskDeletes("d"), { t_a: ["1", "2"], t_b: ["x"] });
resetDeskDeletesForTest();
assert.deepEqual(pendingDeskDeletes("d"), { t_a: ["1", "2"], t_b: ["x"] }, "kept across reloads");

// A deletion recorded while a push is in flight is not lost when it lands.
const sent = pendingDeskDeletes("d");
recordDeskDeletion("d", "t_a", ["3"]);
confirmDeskDeletes("d", sent);
assert.deepEqual(pendingDeskDeletes("d"), { t_a: ["3"] }, "only confirmed ids are forgotten");
confirmDeskDeletes("d", { t_a: ["3"] });
assert.deepEqual(pendingDeskDeletes("d"), {});
assert.equal(store.size, 0, "nothing left behind once confirmed");

// Desks do not see each other's deletions.
recordDeskDeletion("other", "t_a", ["9"]);
assert.deepEqual(pendingDeskDeletes("d"), {});

// The server keeps only tables the desk owns, and only string ids.
assert.deepEqual(
  readNamedDeletes({ t_a: ["1", "", 2, "1"], t_evil: ["z"] }, ["t_a", "t_b"]),
  { t_a: ["1"] },
);
assert.deepEqual(readNamedDeletes(null, ["t_a"]), {});
assert.deepEqual(readNamedDeletes(["t_a"], ["t_a"]), {});

console.log("deskNamedDeletes.selftest: all assertions passed");
