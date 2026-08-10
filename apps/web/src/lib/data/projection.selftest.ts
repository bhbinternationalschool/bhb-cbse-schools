/**
 * A list projection must always carry what paging depends on.
 *
 * Stage 6. `admission_desk_leads` is 919 rows and 2.37 MB, of which
 * `lead_json` is 1.82 MB (76.8%) that no list screen reads a single field of.
 * Sending it anyway is what made the admissions payload 2.37 MB, pushed the
 * browser past its storage cap, and cost the director's phone its saves on
 * 2026-08-10. Measured on production: a 100-row page falls from 267.8 KB to
 * 44.0 KB once lead_json is left behind.
 *
 * The trap this pins: keyset pagination builds its cursor from
 * (sortColumn, id). A projection that omits either produces a first page that
 * looks perfect and a `nextCursor` of "undefined" — so paging stops at row
 * 100 and the remaining 819 leads are simply invisible. Nobody notices until
 * someone scrolls, and then it reads as missing data rather than as a bug.
 *
 * So the repo forces both columns in rather than trusting each definition to
 * remember. This test pins that, and that every registered projection is
 * self-consistent.
 *
 * Run: npx tsx src/lib/data/projection.selftest.ts
 */
import assert from "node:assert/strict";
import { COLLECTIONS } from "./registry";

/** Exactly the projection built in server/repo.ts. */
function buildProjection(def: {
  list: { sortColumn: string; columns?: readonly string[] };
}): string {
  return def.list.columns?.length
    ? Array.from(new Set(["id", def.list.sortColumn, ...def.list.columns])).join(",")
    : "*";
}

// ── The forced columns ────────────────────────────────────────────────────
{
  const p = buildProjection({
    list: { sortColumn: "lead_date", columns: ["child_name", "mobile"] },
  });
  const cols = p.split(",");

  assert.ok(cols.includes("id"), "id is forced in — the cursor needs it");
  assert.ok(
    cols.includes("lead_date"),
    "the sort column is forced in, even when a definition forgets it",
  );
  assert.ok(cols.includes("child_name") && cols.includes("mobile"));
}

// ── No duplicates when a definition does list them ────────────────────────
// A repeated column is not an error to PostgREST, but it inflates every row
// of every page for no reason — which is the exact cost this stage exists
// to remove.
{
  const p = buildProjection({
    list: { sortColumn: "lead_date", columns: ["id", "lead_date", "mobile"] },
  });
  assert.equal(p.split(",").length, 3, `no duplicates, got "${p}"`);
}

// ── No projection means the whole row ─────────────────────────────────────
// Most collections are small and do not need one. Omitting must keep today's
// behaviour exactly, or adding this feature would silently change 24 reads.
{
  assert.equal(buildProjection({ list: { sortColumn: "code" } }), "*");
  assert.equal(buildProjection({ list: { sortColumn: "code", columns: [] } }), "*");
}

// ── Every registered projection is usable ─────────────────────────────────
{
  for (const def of COLLECTIONS) {
    if (!def.list.columns?.length) continue;
    const cols = buildProjection(def).split(",");
    assert.ok(cols.includes("id"), `${def.id}: projection must carry id`);
    assert.ok(
      cols.includes(def.list.sortColumn),
      `${def.id}: projection must carry its sort column ${def.list.sortColumn}`,
    );
    assert.ok(
      !cols.includes("lead_json"),
      `${def.id}: lead_json is 76.8% of the payload and no list renders it`,
    );
  }
}

// ── The admissions collection specifically ────────────────────────────────
{
  const leads = COLLECTIONS.find((c) => c.id === "admissions.leads");
  assert.ok(leads, "admissions.leads must be registered");
  assert.ok(leads!.list.columns?.length, "…with a projection, or Stage 6 is not done");
  assert.ok(
    leads!.scope.includes("academic_year_code"),
    "leads span 2025-26 and 2026-27 in production; an unscoped list mixes them",
  );
  assert.equal(
    leads!.softDelete,
    false,
    "admission_desk_leads has no deleted_at column — declaring softDelete " +
      "would filter every list on a column that does not exist",
  );
}

console.log("projection.selftest: all assertions passed");
