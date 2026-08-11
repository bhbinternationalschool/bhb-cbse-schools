/**
 * Run: npx tsx src/lib/moduleFilters.selftest.ts
 *
 * useModuleFilters() itself needs React + a browser (localStorage, window,
 * useEffect), so it isn't driven directly here — this exercises the pure
 * helpers it's built on: countActiveModuleFilters, filtersToParams,
 * filtersFromParams. The full restore/persist/saved-views flow is verified
 * live in the browser against the module that adopts it (Staff).
 */
import assert from "node:assert/strict";

import {
  countActiveModuleFilters,
  filtersFromParams,
  filtersToParams,
} from "./moduleFilters";

console.log("moduleFilters.selftest.ts");

type F = {
  query: string;
  department: string;
  status: string;
  matchMode: string;
};

const EMPTY: F = { query: "", department: "", status: "active", matchMode: "all" };

// --- countActiveModuleFilters: only non-default values count -------------
{
  assert.equal(countActiveModuleFilters(EMPTY, EMPTY), 0, "empty state has no active filters");

  const withQuery: F = { ...EMPTY, query: "abc" };
  assert.equal(countActiveModuleFilters(withQuery, EMPTY), 1);

  // status defaults to "active", not "", so counting must respect the
  // supplied `defaults` map rather than assuming every field's empty is "".
  const explicitDefaults = { status: "active" };
  const atDefaultStatus: F = { ...EMPTY, status: "active" };
  assert.equal(
    countActiveModuleFilters(atDefaultStatus, EMPTY, explicitDefaults),
    0,
    "value equal to its declared default must not count as active",
  );
  const changedStatus: F = { ...EMPTY, status: "inactive" };
  assert.equal(countActiveModuleFilters(changedStatus, EMPTY, explicitDefaults), 1);

  const ignored = countActiveModuleFilters(
    { ...EMPTY, matchMode: "any" },
    EMPTY,
    {},
    ["matchMode"],
  );
  assert.equal(ignored, 0, "ignoreKeys must exclude UI-only fields like matchMode");
}

// --- filtersToParams / filtersFromParams round-trip -----------------------
{
  const f: F = { query: "raj", department: "dep_1", status: "inactive", matchMode: "all" };
  const params = filtersToParams(f, { status: "active", matchMode: "all" });
  assert.equal(params.get("query"), "raj");
  assert.equal(params.get("department"), "dep_1");
  assert.equal(params.get("status"), "inactive");
  assert.equal(
    params.get("matchMode"),
    null,
    "matchMode equals its declared default (\"all\") so it's omitted",
  );

  const restored = filtersFromParams(params, EMPTY);
  assert.equal(restored.query, "raj");
  assert.equal(restored.department, "dep_1");
  assert.equal(restored.status, "inactive");
  assert.equal(
    "matchMode" in restored,
    false,
    "keys absent from the URL must not appear in the partial result",
  );
}

// --- filtersToParams: default-valued fields are omitted (short shareable
// links) -------------------------------------------------------------------
{
  const params = filtersToParams(EMPTY, { status: "active", matchMode: "all" });
  assert.equal(params.toString(), "", "an all-default filter state serializes to nothing");
}

// --- filtersFromParams: null params object returns {} ---------------------
{
  assert.deepEqual(filtersFromParams(null, EMPTY), {});
}

console.log("OK — moduleFilters.selftest.ts");
