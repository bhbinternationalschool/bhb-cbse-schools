import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applySaveRevs,
  buildSaveRevs,
  captureRevBase,
  forgetRevBase,
  hasRevBase,
  rowFingerprint,
} from "./sliceRevClient";
import { mergeWithRevs } from "./sliceRevMerge";

console.log("sliceRevClient.selftest.ts");

/**
 * The browser half of per-row versions, driven end to end against the
 * server rule (sliceRevMerge): load → edit → save → the server's answer →
 * the next edit. The case that started it all is replayed: a leave request
 * approved on WhatsApp after an office tab loaded it; the tab's later edit
 * of that request is refused instead of writing "pending" back.
 */

const cfg = { slices: ["requests"] as const };
type Row = { id: string; status: string; note?: string; _rev?: number };

// The server's list, and a tiny server: merge + store, as the push does.
let server: Row[] = [
  { id: "lr1", status: "pending", _rev: 1 },
  { id: "lr2", status: "pending", _rev: 1 },
];
function save(module: string, local: Row[]) {
  const state = { requests: local };
  const revs = buildSaveRevs(module, state, cfg);
  const res = mergeWithRevs(server, local, { base: revs.requests });
  server = res.rows as Row[];
  const conflicts: Record<string, string[]> = res.conflicts.length ? { requests: res.conflicts } : {};
  const answer = { revs: { requests: res.revs }, conflicts };
  applySaveRevs(module, state, revs, answer, cfg);
  return { sent: revs.requests, answer };
}
// A browser's copy is the server's rows through a normalizer that drops _rev.
const load = (module: string): Row[] => {
  const local = server.map((r) => {
    const copy: Row = { ...r };
    delete copy._rev;
    return copy;
  });
  captureRevBase(module, { requests: server }, { requests: local }, cfg);
  return local;
};

// ── Office tab loads; a change it didn't make is not sent at all ────────────
const office = load("office");
assert.ok(hasRevBase("office"));
{
  const { sent } = save("office", office);
  assert.deepEqual(sent, {}, "nothing changed → nothing sent");
}

// ── WhatsApp approves lr1 on the server (a server writer: no base, bumps) ───
{
  const res = mergeWithRevs(server, [{ id: "lr1", status: "approved" }]);
  server = res.rows as Row[];
  assert.equal(server.find((r) => r.id === "lr1")!._rev, 2);
}

// ── The office tab (still holding "pending") edits lr2 and lr1 ─────────────
{
  const edited = office.map((r) => (r.id === "lr2" ? { ...r, note: "doctor's note" } : r));
  // lr2 changed from v1 → accepted; lr1 untouched by this edit → not sent → approval stands.
  const { sent, answer } = save("office", edited);
  assert.deepEqual(sent, { lr2: 1 });
  assert.deepEqual(answer.conflicts, {});
  assert.equal(server.find((r) => r.id === "lr1")!.status, "approved", "an untouched stale copy can't revert the approval");
  assert.equal(server.find((r) => r.id === "lr2")!.note, "doctor's note");

  // Now the stale tab edits lr1 itself — from v1, but the server is at v2.
  const stale = edited.map((r) => (r.id === "lr1" ? { ...r, status: "cancelled" } : r));
  const second = save("office", stale);
  assert.deepEqual(second.sent, { lr1: 1 });
  assert.deepEqual(second.answer.conflicts, { requests: ["lr1"] }, "refused: changed elsewhere first");
  assert.equal(server.find((r) => r.id === "lr1")!.status, "approved");

  // A further edit of lr2 by the same tab is made from the version it wrote (v2).
  const third = save("office", stale.map((r) => (r.id === "lr2" ? { ...r, note: "updated" } : r)));
  assert.deepEqual(third.sent, { lr1: 1, lr2: 2 }, "lr2 goes from the version its own save created");
  assert.equal(server.find((r) => r.id === "lr2")!.note, "updated");
}

// ── After a reload the tab knows the current versions again ─────────────────
{
  forgetRevBase("office");
  const fresh = load("office");
  const { sent, answer } = save("office", fresh.map((r) => (r.id === "lr1" ? { ...r, note: "seen" } : r)));
  assert.deepEqual(sent, { lr1: 2 });
  assert.deepEqual(answer.conflicts, {});
}

// ── New rows go as version 0; a browser that never loaded sends everything as new
{
  const tab = load("tab2");
  const { sent } = save("tab2", [...tab, { id: "lr3", status: "pending" }]);
  assert.deepEqual(sent, { lr3: 0 });
  const unloaded = buildSaveRevs("never-loaded", { requests: [{ id: "lr1", status: "x" }] }, cfg);
  assert.deepEqual(unloaded, { requests: { lr1: 0 } }, "an unloaded browser's rows are all 'new' — versioned rows are then refused");
}

// ── Fingerprints ignore key order and _rev ─────────────────────────────────
assert.equal(rowFingerprint({ a: 1, b: { c: 2, d: 3 }, _rev: 4 }), rowFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
assert.notEqual(rowFingerprint({ a: 1 }), rowFingerprint({ a: 2 }));

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const generic = read("deskSliceNormalizedClient.ts");
  assert.ok(/revs: sentRevs/.test(generic) && /applySaveRevs\(deskKey\(id\), state, sentRevs, body, revCfg\)/.test(generic));
  assert.ok(/onSaveConflicts\(deskKey\(id\), id, body\.conflicts\)/.test(generic));
  assert.ok(/captureDeskSliceRevs\(\s*opts\.moduleId,\s*server,/.test(read("createDeskSlicePersistence.ts")));
  for (const [client, persist, mod] of [
    ["trustNormalizedClient.ts", "trustPersistence.ts", "trust"],
    ["transportNormalizedClient.ts", "transportPersistence.ts", "transport"],
  ] as const) {
    const c = read(client);
    assert.ok(c.includes(`buildSaveRevs("${mod}"`) && c.includes(`applySaveRevs("${mod}"`) && c.includes(`onSaveConflicts("${mod}"`), `${mod}: sends revs, applies the answer, handles conflicts`);
    assert.ok(/server: bundle \};/.test(c), `${mod}: the load hands back the server rows even when not taken`);
    assert.ok(new RegExp(`capture${mod[0].toUpperCase()}${mod.slice(1)}Revs\\(server,`).test(read(persist)), `${mod}: a load captures versions`);
  }
  assert.ok(/addEventListener\("bhb-desk-conflict", onDeskConflict\)/.test(read("../components/shell/AppShell.tsx")), "conflicts are shown to the person");
}

console.log("sliceRevClient.selftest: all assertions passed");
