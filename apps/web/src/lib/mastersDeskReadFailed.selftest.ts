/**
 * Run: npx tsx src/lib/mastersDeskReadFailed.selftest.ts
 *
 * data-layer 0.5b. GET /api/school-data/masters-desk (the full-rights,
 * slices branch) answered a FAILED read with 200 and an empty bundle — zero
 * classes — which a browser took as the school's masters. The teaching
 * branch already answered 503; now the full branch does too.
 *
 * Runs the real route handler against a fake PostgREST (no database).
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();
// The mirror-secret path authenticates the call without a browser session.
process.env.MIRROR_SYNC_SECRET = "mirror-test-secret";
// The mirror's disk file is written relative to cwd: keep it out of the repo.
process.chdir(mkdtempSync(join(tmpdir(), "masters-desk-selftest-")));

const req = () =>
  new Request("https://example.test/api/school-data/masters-desk", {
    headers: { "x-mirror-secret": "mirror-test-secret" },
  });

void (async () => {
  const { GET } = await import("../app/api/school-data/masters-desk/route");

  // A healthy read: 200 with the stored classes.
  pg.tables.masters_desk_slices = [
    { tenant_id: "t", slice_key: "classes", payload: [{ id: "cls_1", name: "Class 1", sortOrder: 1, isActive: true }], updated_at: "2026-10-13T00:00:00Z" },
  ];
  pg.tables.masters_desk_sync_meta = [{ tenant_id: "t", updated_at: "2026-10-13T00:00:00Z", slice_count: 1, class_count: 1 }];
  const ok = await GET(req());
  assert.equal(ok.status, 200, "a good read is served");
  const okBody = (await ok.json()) as { ok?: boolean; classCount?: number };
  assert.equal(okBody.ok, true);

  // The slices read fails: 503 {ok:false}, never 200 with no classes.
  pg.tables.masters_desk_slices = { error: "canceling statement due to statement timeout" };
  const failed = await GET(req());
  assert.equal(failed.status, 503, "a failed masters read is a 503, not an empty 200");
  const body = (await failed.json()) as { ok?: boolean; classes?: unknown[]; error?: string };
  assert.equal(body.ok, false);
  assert.ok(body.error, "with a reason");
  assert.equal(body.classes, undefined, "and no (empty) class list a browser could adopt");

  // The sync-meta read failing is the same unknown.
  pg.tables.masters_desk_slices = [];
  pg.tables.masters_desk_sync_meta = { error: "connection reset" };
  const metaFailed = await GET(req());
  assert.equal(metaFailed.status, 503, "a failed sync-meta read is a 503 too");

  // MASTERS_READ_FROM_ROWS: a failed meta read on the row path falls to the
  // slices, which fail the same way — still 503, never a fresh revision.
  process.env.MASTERS_READ_FROM_ROWS = "true";
  const rowsFailed = await GET(req());
  assert.equal(rowsFailed.status, 503, "the row path does not turn a failed read into data");
  delete process.env.MASTERS_READ_FROM_ROWS;

  console.log("mastersDeskReadFailed selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
