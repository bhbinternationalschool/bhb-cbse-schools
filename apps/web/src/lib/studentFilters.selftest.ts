/**
 * Student roster filter state — persistence, URL round-trip, completeness.
 *
 * Run: npx tsx src/lib/studentFilters.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent } from "./sis";
import {
  BUILT_IN_VIEWS,
  EMPTY_FILTERS,
  countActiveFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  isMissing,
} from "./studentFilters";

console.log("studentFilters.selftest.ts");

// --- Active-filter count ---------------------------------------------
{
  assert.equal(
    countActiveFilters(EMPTY_FILTERS),
    0,
    "the default state must report zero active filters",
  );

  // statusFilter defaults to "active", not "", so it must not be counted.
  assert.equal(
    countActiveFilters({ ...EMPTY_FILTERS, statusFilter: "active" }),
    0,
    "the default status must not count as a filter",
  );
  assert.equal(
    countActiveFilters({ ...EMPTY_FILTERS, statusFilter: "inactive" }),
    1,
    "a non-default status is an active filter",
  );

  // Sort and match mode are presentation, not filtering.
  assert.equal(
    countActiveFilters({ ...EMPTY_FILTERS, sortBy: "name", sortOrder: "desc", matchMode: "any" }),
    0,
    "sort and match mode must not inflate the filter count",
  );

  assert.equal(
    countActiveFilters({ ...EMPTY_FILTERS, classFilter: "cls_1", missingFilter: "apaar" }),
    2,
  );
  console.log("  ok  active-filter count ignores defaults and presentation state");
}

// --- URL round-trip ---------------------------------------------------
{
  const filters = {
    ...EMPTY_FILTERS,
    classFilter: "cls_9",
    sectionFilter: "sec_b",
    missingFilter: "apaar" as const,
    query: "singh",
    statusFilter: "inactive",
    sortBy: "name",
  };
  const params = filtersToSearchParams(filters);
  const back = filtersFromSearchParams(params);

  for (const k of ["classFilter", "sectionFilter", "missingFilter", "query", "statusFilter", "sortBy"] as const) {
    assert.equal(back[k], filters[k], `${k} must survive the URL round-trip`);
  }

  // Defaults are omitted so shared links stay short.
  assert.equal(params.get("matchMode"), null, "default matchMode must not be serialised");
  assert.equal(params.get("genderFilter"), null, "unset filters must not be serialised");
  console.log("  ok  filters round-trip through the URL, defaults omitted");
}

// --- Missing-field detection -----------------------------------------
{
  const complete = normalizeStudent({
    id: "s1",
    fullName: "Aadvik Singh",
    pen: "PEN123456",
    apaarId: "123456789012",
    aadhaarLast4: "1234",
    dob: "2015-04-01",
    photoUrl: "https://example.test/p.jpg",
    householdId: "hh_1",
    fatherMobile: "9876543210",
    sectionId: "sec_a",
  });
  for (const f of ["pen", "apaar", "aadhaar", "dob", "photo", "household", "guardianMobile", "section"] as const) {
    assert.equal(isMissing(complete, f), false, `${f} should not be reported missing`);
  }

  const bare = normalizeStudent({ id: "s2", fullName: "New Student" });
  for (const f of ["pen", "apaar", "aadhaar", "dob", "photo", "household", "guardianMobile", "section"] as const) {
    assert.equal(isMissing(bare, f), true, `${f} should be reported missing`);
  }
  console.log("  ok  missing-field detection is correct both ways");
}

// --- Whitespace is not a value ---------------------------------------
{
  const s = normalizeStudent({ id: "s3", fullName: "X", pen: "   ", apaarId: "" });
  assert.equal(isMissing(s, "pen"), true, "whitespace-only PEN counts as missing");
  assert.equal(isMissing(s, "apaar"), true);
  console.log("  ok  whitespace-only values count as missing");
}

// --- Aadhaar: either form satisfies it --------------------------------
{
  const last4Only = normalizeStudent({ id: "s4", fullName: "X", aadhaarLast4: "9876" });
  assert.equal(isMissing(last4Only, "aadhaar"), false, "last-4 alone satisfies Aadhaar");

  const fullOnly = normalizeStudent({ id: "s5", fullName: "X", aadhaarNumber: "111122223333" });
  assert.equal(isMissing(fullOnly, "aadhaar"), false, "a full number alone satisfies Aadhaar");
  console.log("  ok  Aadhaar satisfied by either last-4 or full number");
}

// --- Built-in views are coherent --------------------------------------
{
  assert.ok(BUILT_IN_VIEWS.length >= 5, "expected a set of built-in views");
  for (const v of BUILT_IN_VIEWS) {
    assert.ok(v.builtIn, `${v.id} must be flagged built-in so it cannot be deleted`);
    assert.ok(v.name.trim().length > 0, `${v.id} needs a name`);
    assert.ok(
      countActiveFilters(v.filters) > 0,
      `${v.id} must actually filter something`,
    );
  }
  const apaar = BUILT_IN_VIEWS.find((v) => v.id === "builtin_missing_apaar");
  assert.equal(apaar?.filters.missingFilter, "apaar");
  console.log("  ok  every built-in view is named, protected and filters something");
}

console.log("\nAll student filter checks passed.");
