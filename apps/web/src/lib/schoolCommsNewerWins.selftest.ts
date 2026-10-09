import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptySchoolComms } from "./schoolComms";

console.log("schoolCommsNewerWins.selftest.ts");

/**
 * School comms (notices, news, gallery): a tab's older copy can't put back a
 * notice someone edited, archived or published since — whether that was
 * another tab, the scheduled-publish cron or the WhatsApp class channel.
 * Notices, news and albums carry their own `updatedAt`; a row the database
 * holds at a later time is skipped. Photos are only ever added or deleted,
 * so they are insert-only; so are the sample rows an empty browser seeds.
 */

type Row = Record<string, unknown> & { id: string; updated_at: string };
const tables = new Map<string, Map<string, Row>>();
const t = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
let failRead = false;
const sb = {
  from: (name: string) => {
    let ids: string[] = [];
    const q = {
      select: () => q,
      eq: () => q,
      in: (_k: string, v: string[]) => {
        ids = v;
        return q;
      },
      order: () => q,
      range: async () =>
        failRead
          ? { data: null, error: { message: "timeout" } }
          : { data: [...t(name).values()].filter((r) => ids.includes(r.id)), error: null },
      upsert: async (rows: Row[], opts?: { ignoreDuplicates?: boolean }) => {
        for (const r of rows) if (!(opts?.ignoreDuplicates && t(name).has(r.id))) t(name).set(r.id, { ...r });
        return { error: null };
      },
    };
    return q;
  },
} as unknown as SupabaseClient;

void (async () => {
  const { writeCommsRows } = await import("./schoolCommsNormalized.server");
  const N = "school_comms_desk_notices";

  // Stored: n1 archived at 10:05 (after the tab loaded it at 10:00), n2 old.
  t(N).set("n1", { id: "n1", title: "Holiday", status: "archived", updated_at: "2026-10-10T10:05:00.000+00:00" });
  t(N).set("n2", { id: "n2", title: "PTM", status: "draft", updated_at: "2026-10-09T09:00:00.000+00:00" });

  // The tab saves: its stale n1 (10:00, still published), its edit of n2 (10:10), a new n3.
  const r = await writeCommsRows(sb, "t", N, [
    { id: "n1", title: "Holiday", status: "published", updated_at: "2026-10-10T10:00:00.000Z" },
    { id: "n2", title: "PTM on Saturday", status: "draft", updated_at: "2026-10-10T10:10:00.000Z" },
    { id: "n3", title: "New", status: "draft", updated_at: "2026-10-10T10:10:00.000Z" },
  ]);
  assert.deepEqual(r, { ok: true, kept: 1 });
  assert.equal(t(N).get("n1")!.status, "archived", "the stale copy can't un-archive it");
  assert.equal(t(N).get("n2")!.title, "PTM on Saturday", "a real, newer edit is written");
  assert.ok(t(N).has("n3"));

  // An empty browser's sample notice never overwrites the stored one with that id.
  const seed = emptySchoolComms().notices[0]!;
  t(N).set(seed.id, { id: seed.id, title: "Sports Day moved to Monday", body: "edited", updated_at: "2026-10-01T00:00:00.000+00:00" });
  await writeCommsRows(sb, "t", N, [
    { id: seed.id, title: seed.title, body: seed.body, updated_at: new Date().toISOString() },
  ]);
  assert.equal(t(N).get(seed.id)!.title, "Sports Day moved to Monday", "an untouched seed is insert-only");

  // Photos: insert-only.
  const P = "school_comms_desk_photos";
  t(P).set("p1", { id: "p1", album_id: "a1", url: "u1", updated_at: "x" });
  await writeCommsRows(sb, "t", P, [
    { id: "p1", album_id: "a-old", url: "u1", updated_at: "y" },
    { id: "p2", album_id: "a1", url: "u2", updated_at: "y" },
  ]);
  assert.equal(t(P).get("p1")!.album_id, "a1");
  assert.ok(t(P).has("p2"));

  // A failed read writes nothing.
  failRead = true;
  const bad = await writeCommsRows(sb, "t", N, [{ id: "n2", title: "lost?", updated_at: "2026-10-11T00:00:00.000Z" }]);
  assert.equal(bad.ok, false);
  assert.equal(t(N).get("n2")!.title, "PTM on Saturday");

  // ── Wiring ─────────────────────────────────────────────────────────────
  const src = readFileSync(join(__dirname, "schoolCommsNormalized.server.ts"), "utf8");
  assert.equal((src.match(/await writeCommsRows\(sb, tenantId, /g) ?? []).length, 3, "comms, gallery and news all write through it");
  assert.equal(/upsertChunks\(sb, table, rows\)|upsertChunks\(sb, "school_comms_desk_news"/.test(src), false, "no blanket upsert left");
  assert.equal((src.match(/touchCommsMeta\(sb, tenantId, now\)/g) ?? []).length, 3, "every save recounts the meta");
  assert.equal(/\.select\("\*"\)\.eq\("tenant_id", tenantId\),/.test(src), false, "every read is paged");

  console.log("schoolCommsNewerWins.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
