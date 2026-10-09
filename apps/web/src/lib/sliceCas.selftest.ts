import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { casWriteSlice, sliceWriteStamp } from "./sliceCas.server";

console.log("sliceCas.selftest.ts");

/**
 * The transport boarding race: the desk save and a driver's boarding tap each
 * read the slice, merged, and wrote — the second write threw away the first.
 * casWriteSlice writes only if the row is unchanged since it was read, and
 * otherwise re-reads and re-applies. This drives it against an in-memory
 * table where another writer lands between the read and the write.
 */

type Row = { tenant_id: string; slice_key: string; payload: unknown; updated_at: string };

function fakeTable(opts: { beforeWrite?: () => void } = {}) {
  const rows = new Map<string, Row>();
  const key = (t: string, k: string) => `${t}|${k}`;
  let reads = 0;
  const sb = {
    from() {
      const filters: Record<string, unknown> = {};
      let op: "select" | "update" | "insert" = "select";
      let patch: Partial<Row> = {};
      const q = {
        select() {
          return q;
        },
        update(p: Partial<Row>) {
          op = "update";
          patch = p;
          return q;
        },
        insert(r: Row) {
          const k = key(r.tenant_id, r.slice_key);
          if (rows.has(k)) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          rows.set(k, { ...r });
          return Promise.resolve({ error: null });
        },
        eq(col: string, v: unknown) {
          filters[col] = v;
          return q;
        },
        maybeSingle() {
          reads++;
          const r = rows.get(key(String(filters.tenant_id), String(filters.slice_key)));
          return Promise.resolve({ data: r ? { payload: r.payload, updated_at: r.updated_at } : null, error: null });
        },
        then(res: (v: unknown) => void) {
          // the awaited update(...).eq(...).select()
          if (op !== "update") return res({ data: [], error: null });
          opts.beforeWrite?.();
          const k = key(String(filters.tenant_id), String(filters.slice_key));
          const r = rows.get(k);
          if (!r || r.updated_at !== filters.updated_at) return res({ data: [], error: null });
          rows.set(k, { ...r, ...patch } as Row);
          return res({ data: [{ slice_key: r.slice_key }], error: null });
        },
      };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, rows, reads: () => reads };
}

const T = "transport_desk_slices";
const append = (id: string) => (stored: unknown) => [...(Array.isArray(stored) ? stored : []), { id }];

(async () => {
  // A competing write lands between the first read and the first write.
  {
    let raced = false;
    const t = fakeTable({
      beforeWrite: () => {
        if (raced) return;
        raced = true;
        const r = t.rows.get("ten|boardingEvents")!;
        t.rows.set("ten|boardingEvents", {
          ...r,
          payload: [...(r.payload as unknown[]), { id: "driver-tap" }],
          updated_at: sliceWriteStamp(),
        });
      },
    });
    t.rows.set("ten|boardingEvents", { tenant_id: "ten", slice_key: "boardingEvents", payload: [{ id: "a" }], updated_at: sliceWriteStamp() });
    const res = await casWriteSlice(t.sb, T, "ten", "boardingEvents", append("office-save"));
    assert.ok(res.ok, "the write lands");
    assert.equal(res.ok && res.attempts, 2, "it lost the first race and re-applied");
    const ids = (t.rows.get("ten|boardingEvents")!.payload as { id: string }[]).map((r) => r.id);
    assert.deepEqual(ids, ["a", "driver-tap", "office-save"], "neither write is lost");
  }

  // Nothing stored yet: inserted; a racing insert is merged into, not lost.
  {
    const t = fakeTable();
    const res = await casWriteSlice(t.sb, T, "ten", "gpsPings", append("p1"));
    assert.ok(res.ok);
    assert.deepEqual(t.rows.get("ten|gpsPings")!.payload, [{ id: "p1" }]);
  }

  // A slice that keeps changing gives up without overwriting.
  {
    const t = fakeTable({
      beforeWrite: () => {
        const r = t.rows.get("ten|routes")!;
        t.rows.set("ten|routes", { ...r, updated_at: sliceWriteStamp() });
      },
    });
    t.rows.set("ten|routes", { tenant_id: "ten", slice_key: "routes", payload: [{ id: "r1" }], updated_at: sliceWriteStamp() });
    const res = await casWriteSlice(t.sb, T, "ten", "routes", append("x"), { maxAttempts: 3 });
    assert.equal(res.ok, false, "refused after the attempts run out");
    assert.deepEqual(t.rows.get("ten|routes")!.payload, [{ id: "r1" }], "and nothing was overwritten");
  }

  // Stamps carry microseconds and differ.
  {
    const now = new Date("2026-10-09T13:00:00.123Z");
    const a = sliceWriteStamp(now);
    assert.match(a, /^2026-10-09T13:00:00\.123\d{3}Z$/);
  }

  // Both transport writers go through it.
  {
    const src = readFileSync(join(__dirname, "transportNormalized.server.ts"), "utf8");
    assert.ok(/casWriteSlice\(sb, "transport_desk_slices", tenantId, "boardingEvents"/.test(src), "the boarding tap writes conditionally");
    assert.ok(/casWriteSlice\(sb, "transport_desk_slices", tenantId, key,/.test(src), "the desk save writes conditionally");
    assert.equal(/from\("transport_desk_slices"\)\.upsert\(/.test(src), false, "no unconditional slice upsert left");
  }

  console.log("sliceCas.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
