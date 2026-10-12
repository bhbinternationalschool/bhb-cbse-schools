/**
 * Run: npx tsx src/lib/deskProbeAncillary.selftest.ts
 *
 * data-layer 0.5f. The probe-cached desk GETs (fees-vouchers,
 * attendance-registers, sis-roster) must rebuild when ANY table their body
 * is built from changes. Their probe lists left out the fee ancillary tables
 * (day closes, plans, cheques, …), the attendance policy / exceptions /
 * nudges and the SIS tags / class upgrades: a day close on PC A did not move
 * the fingerprint, so PC B kept getting the cached body without it.
 *
 * Runs the real route handlers and the real probe cache against a fake
 * PostgREST whose desk_probe behaves like the SQL function in the NEWEST
 * migration that defines it: count + max(updated_at) per table, and an
 * exception for any table outside its allowlist (which fails the probe open —
 * the 9 Oct 2026 incident — and is caught here as "uncached").
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";

const migDir = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
const defining = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /create or replace function public\.desk_probe/i.test(readFileSync(join(migDir, f), "utf8")));
const latest = readFileSync(join(migDir, defining[defining.length - 1]), "utf8");
const allowed = new Set(
  [...latest.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
);

installServerOnlyStub();
const pg = installFakePostgrest();
process.env.MIRROR_SYNC_SECRET = "mirror-test-secret";
process.chdir(mkdtempSync(join(tmpdir(), "desk-probe-selftest-")));

let probeErrors = 0;
pg.rpc.desk_probe = (args) => {
  const parts: string[] = [];
  for (const t of args.p_tables as string[]) {
    if (!allowed.has(t)) {
      probeErrors++;
      throw new Error(`desk_probe: table ${t} not allowlisted`);
    }
    const rows = pg.tables[t];
    const list = Array.isArray(rows) ? (rows as { updated_at?: string }[]) : [];
    const max = list.map((r) => r.updated_at ?? "").sort().pop() ?? "";
    parts.push(`${t}=${list.length}|${max}`);
  }
  return parts.join(";");
};

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const tick = () => (clock += 6_000); // past the probe's 5 s memo

const req = (path: string) =>
  new Request(`https://example.test/api/school-data/${path}`, { headers: { "x-mirror-secret": "mirror-test-secret" } });

async function scenario(
  name: string,
  get: (r: Request) => Promise<Response>,
  path: string,
  change: () => void,
  seen: (body: string) => boolean,
) {
  const first = await get(req(path));
  assert.equal(first.status, 200, `${name}: first read`);
  assert.equal(first.headers.get("X-Desk-Cache"), "built", `${name}: built and cached (probe answered)`);
  tick();
  const again = await get(req(path));
  assert.equal(again.headers.get("X-Desk-Cache"), "hit", `${name}: unchanged → served from cache`);
  tick();
  change();
  const after = await get(req(path));
  assert.equal(after.headers.get("X-Desk-Cache"), "built", `${name}: the change moved the fingerprint → rebuilt`);
  assert.ok(seen(await after.text()), `${name}: the rebuilt body has the change`);
}

void (async () => {
  const fees = await import("../app/api/school-data/fees-vouchers/route");
  const att = await import("../app/api/school-data/attendance-registers/route");
  const sis = await import("../app/api/school-data/sis-roster/route");

  await scenario(
    "fees-vouchers / day close",
    fees.GET,
    "fees-vouchers",
    () => {
      pg.tables.fee_desk_day_closes = [
        {
          id: "dc_2026_10_13",
          tenant_id: "t",
          close_date: "2026-10-13",
          counter_id: "front_office",
          status: "submitted",
          session_json: { id: "dc_2026_10_13", closeDate: "2026-10-13", status: "submitted" },
          updated_at: "2026-10-13T12:00:00Z",
        },
      ];
    },
    (b) => b.includes("dc_2026_10_13"),
  );

  await scenario(
    "attendance-registers / policy",
    att.GET,
    "attendance-registers",
    () => {
      pg.tables.attendance_desk_policy = [
        {
          tenant_id: "t",
          teacher_cutoff_time: "09:45",
          lock_teachers_after_cutoff: true,
          absent_nudge_enabled: true,
          absent_nudge_max_open: 12,
          updated_at: "2026-10-13T12:00:00Z",
        },
      ];
    },
    (b) => b.includes("09:45"),
  );

  await scenario(
    "sis-roster / student tag",
    sis.GET,
    "sis-roster",
    () => {
      pg.tables.sis_student_tags = [
        { id: "tag_rte", tenant_id: "t", code: "RTE", name: "RTE quota", color: "", is_active: true, created_at: "", updated_at: "2026-10-13T12:00:00Z" },
      ];
    },
    (b) => b.includes("tag_rte"),
  );

  assert.equal(probeErrors, 0, "no route probes a table the desk_probe allowlist lacks");
  Date.now = realNow;
  console.log("deskProbeAncillary selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
