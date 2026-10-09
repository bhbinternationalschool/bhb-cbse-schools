import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification } from "./notifications";

console.log("notificationsReadersOnlyGrow.selftest.ts");

/**
 * Notifications: a tab's older copy can't make an item unread again for
 * someone else, nor rewrite it. Items are only inserted; readers are only
 * ever added (union with what is stored). A failed read writes nothing.
 */

type Row = { id: string; title: string; read_by_json: string[] };
const table = new Map<string, Row>();
let failRead = false;
const sb = {
  from: () => {
    let ids: string[] = [];
    let id = "";
    let patch: Partial<Row> | null = null;
    const q = {
      select: () => q,
      in: (_k: string, v: string[]) => {
        ids = v;
        return q;
      },
      order: () => q,
      range: async () =>
        failRead
          ? { data: null, error: { message: "timeout" } }
          : { data: [...table.values()].filter((r) => ids.includes(r.id)), error: null },
      upsert: async (rows: Row[], opts?: { ignoreDuplicates?: boolean }) => {
        for (const r of rows) if (!(opts?.ignoreDuplicates && table.has(r.id))) table.set(r.id, { ...r });
        return { error: null };
      },
      update: (p: Partial<Row>) => {
        patch = p;
        return q;
      },
      eq: (k: string, v: string) => {
        if (k === "id") {
          id = v;
          if (patch) table.set(id, { ...table.get(id)!, ...patch });
        }
        return q;
      },
      error: null,
    };
    return q;
  },
} as unknown as SupabaseClient;

const item = (id: string, readBy: string[], title = "Leave approved"): AppNotification =>
  ({ id, title, body: "", kind: "system", href: "/home", audience: "all", sourceId: "", createdAt: "2026-10-10T08:00:00Z", readBy }) as AppNotification;

void (async () => {
  const { writeNotificationItems } = await import("./notificationsNormalized.server");
  table.set("n1", { id: "n1", title: "Leave approved", read_by_json: ["principal", "office"] });

  // A tab that loaded n1 when only the principal had read it now marks it read for "teacher".
  const r = await writeNotificationItems(sb, "t", [item("n1", ["principal", "teacher"], "EDITED?"), item("n2", [])]);
  assert.ok(r.ok);
  assert.deepEqual(table.get("n1")!.read_by_json, ["principal", "office", "teacher"], "office's read survives; teacher's is added");
  assert.equal(table.get("n1")!.title, "Leave approved", "an existing item's content is never rewritten");
  assert.ok(table.has("n2"), "new items are inserted");

  // A stale copy that adds nobody writes nothing.
  table.set("n1", { ...table.get("n1")!, read_by_json: ["principal", "office", "teacher", "bursar"] });
  await writeNotificationItems(sb, "t", [item("n1", ["principal"])]);
  assert.deepEqual(table.get("n1")!.read_by_json, ["principal", "office", "teacher", "bursar"]);

  failRead = true;
  const bad = await writeNotificationItems(sb, "t", [item("n3", [])]);
  assert.equal(bad.ok, false, "a failed read writes nothing");
  assert.equal(table.has("n3"), false);

  const src = readFileSync(join(__dirname, "notificationsNormalized.server.ts"), "utf8");
  assert.ok(/const w = await writeNotificationItems\(sb, tenantId, items\);/.test(src), "the desk save writes through it");
  assert.equal(/upsertChunks/.test(src), false, "no blanket upsert left");
  assert.ok(/touchNotificationsMeta\(sb, tenantId, now\)/.test(src), "meta recounted from the table");
  assert.ok(/fetchAllPages<Record<string, unknown>>\(\(from, to\) =>\s*sb\s*\.from\("notifications_desk_items"\)/.test(src), "the read is paged");

  console.log("notificationsReadersOnlyGrow.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
