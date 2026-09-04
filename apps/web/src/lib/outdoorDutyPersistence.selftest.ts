/**
 * Outdoor duty desk persistence.
 *
 * Until 2026-09-04 outdoor duty sessions lived only in each browser's
 * localStorage: the attendance mark a session produces reached the server,
 * the session itself never did. This covers the slice that fixes that, and
 * the three ways it could go wrong — pruning history, resurrecting a
 * synthetic staff id, or leaving someone shown as "out" after they have
 * checked back in elsewhere.
 *
 * Run: npx tsx src/lib/outdoorDutyPersistence.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OutdoorDutySession } from "./staffAttendance";
import {
  outdoorDutyRowToSession,
  outdoorDutySessionToRow,
  partitionSessionsByRealStaff,
} from "./staffAttendanceOutdoorDutyMap";
import { mergeDbOutdoorDutyIntoStaffAttendanceState } from "./staffAttendanceNormalizedMerge";

console.log("outdoorDutyPersistence.selftest.ts");

const TENANT = "6558f3c4-6d12-4636-bf53-17423b0eaad3";

const session = (p: Partial<OutdoorDutySession>): OutdoorDutySession => ({
  id: "od_1",
  staffId: "stf_1",
  purpose: "bank",
  destination: "SBI branch, Cantt",
  note: "",
  startedAt: "2026-09-04T04:30:00.000Z",
  startGeo: { lat: 25.4354328, lng: 82.9439863, accuracyM: 12, at: "2026-09-04T04:30:00.000Z" },
  endedAt: null,
  endGeo: null,
  status: "active",
  createdBy: "VISHNU OM TRIPATHI",
  ...p,
});

// ── Row round-trip keeps every field the panel shows ───────────────────
{
  const ended = session({
    id: "od_2",
    status: "ended",
    endedAt: "2026-09-04T07:10:00.000Z",
    endGeo: { lat: 25.44, lng: 82.95, accuracyM: 8, at: "2026-09-04T07:10:00.000Z" },
    note: "cheque deposit",
  });
  const back = outdoorDutyRowToSession(outdoorDutySessionToRow(TENANT, ended));
  assert.deepEqual(back, ended, "ended session survives the row round-trip");

  const row = outdoorDutySessionToRow(TENANT, session({}));
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.status, "active");
  assert.equal(row.ended_at, null, "an active session has no end time");
  assert.equal(row.end_geo, null, "an active session has no end location");
  assert.deepEqual(outdoorDutyRowToSession(row), session({}));
}

// ── A half-closed client row must not fail the whole batch ─────────────
// The table's check constraint ties status='ended' to a non-null ended_at.
{
  const halfClosed = session({ status: "ended", endedAt: null });
  const row = outdoorDutySessionToRow(TENANT, halfClosed);
  assert.equal(row.status, "ended");
  assert.equal(
    row.ended_at,
    halfClosed.startedAt,
    "ended_at is synthesised from startedAt rather than left null",
  );
}

// ── Synthetic staff ids are dropped at the push boundary ───────────────
{
  const real = new Set(["stf_1", "stf_2"]);
  const { kept, dropped } = partitionSessionsByRealStaff(
    [
      session({ id: "od_ok", staffId: "stf_1" }),
      session({ id: "od_bad", staffId: "sess_director_bhbinternationa" }),
      session({ id: "od_empty", staffId: "" }),
    ],
    real,
  );
  assert.deepEqual(kept.map((s) => s.id), ["od_ok"]);
  assert.deepEqual(dropped.map((s) => s.id), ["od_bad", "od_empty"]);
}

// ── The push never deletes ─────────────────────────────────────────────
// deleteStale refuses a wholly empty payload but still prunes on a partial
// one, and outdoor duty is open-ended history a cache-dropped phone holds
// none of. Asserted against the source so the invariant cannot be quietly
// undone by a later edit.
{
  const src = readFileSync(
    path.join(__dirname, "staffAttendanceOutdoorDuty.server.ts"),
    "utf8",
  );
  // Comments are where the invariant is explained, so strip them first and
  // assert against the code alone.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /\.delete\s*\(/.test(code),
    false,
    "the outdoor duty push must not delete",
  );
  assert.equal(
    /deleteStale/.test(code),
    false,
    "and must not reach for deleteStale",
  );
  assert.match(src, /deleteStale/, "the reason it does not is written down");
}

// ── Merge: a local session absent from the DB survives ─────────────────
{
  const local = { outdoorDuty: [session({ id: "od_local" })] };
  const merged = mergeDbOutdoorDutyIntoStaffAttendanceState(
    local,
    [session({ id: "od_remote", startedAt: "2026-09-03T04:30:00.000Z" })],
    { preferDb: true },
  );
  assert.deepEqual(
    merged.outdoorDuty.map((s) => s.id).sort(),
    ["od_local", "od_remote"],
    "a pending push is not a deletion",
  );
  assert.equal(
    merged.outdoorDuty[0]!.id,
    "od_local",
    "newest first",
  );
}

// ── Merge: a DB-ended session overrides a locally-active copy ──────────
// Even without preferDb — a tab left open elsewhere must not keep showing
// someone as out of campus after they checked back in.
{
  const local = { outdoorDuty: [session({ id: "od_1", status: "active" })] };
  const remoteEnded = session({
    id: "od_1",
    status: "ended",
    endedAt: "2026-09-04T07:10:00.000Z",
  });
  for (const preferDb of [true, false]) {
    const merged = mergeDbOutdoorDutyIntoStaffAttendanceState(
      local,
      [remoteEnded],
      { preferDb },
    );
    assert.equal(merged.outdoorDuty.length, 1);
    assert.equal(
      merged.outdoorDuty[0]!.status,
      "ended",
      `closure wins with preferDb=${preferDb}`,
    );
  }
}

// ── Merge: a stale DB "active" does not reopen a locally-ended session ─
{
  const local = {
    outdoorDuty: [
      session({ id: "od_1", status: "ended", endedAt: "2026-09-04T07:10:00.000Z" }),
    ],
  };
  const merged = mergeDbOutdoorDutyIntoStaffAttendanceState(
    local,
    [session({ id: "od_1", status: "active" })],
    { preferDb: true },
  );
  assert.equal(
    merged.outdoorDuty[0]!.status,
    "ended",
    "closure is one-way — a stale remote row cannot reopen it",
  );
}

// ── Merge: an empty DB result changes nothing ──────────────────────────
{
  const local = { outdoorDuty: [session({ id: "od_local" })] };
  assert.equal(
    mergeDbOutdoorDutyIntoStaffAttendanceState(local, [], { preferDb: true }),
    local,
    "nothing from the DB is not an instruction to drop what we hold",
  );
}

console.log("All outdoor-duty persistence checks passed.");
