/**
 * Regression test for the sync-wipe bug class fixed across this codebase:
 * a failed/errored remote read must never be reported as ok:true, because
 * callers use ok:false specifically to avoid treating "couldn't check" as
 * "confirmed empty" (which would otherwise wipe local/cached data).
 *
 * Run: npx tsx src/lib/hydrateFailureSafety.selftest.ts
 *
 * Minimal window/localStorage stubs let the browser-path code run under
 * plain Node (no jsdom) — these modules only touch them inside functions,
 * not at module load time, so stubbing before each call is sufficient.
 */
import assert from "node:assert/strict";

// Needed so isSupabaseConfigured()/*RemoteEnabled() don't short-circuit
// before ever reaching the stubbed fetch below.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:9999";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";

type FetchStub = (input: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

function stubFetch(impl: FetchStub) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

async function expectOkFalseOnFailure(
  label: string,
  hydrate: () => Promise<{ ok: boolean }>,
) {
  // 1. Network throws
  stubFetch(async () => {
    throw new Error("network down");
  });
  const r1 = await hydrate();
  assert.equal(r1.ok, false, `${label}: network failure must yield ok:false, got ${r1.ok}`);

  // 2. Non-2xx response (what the API routes now return on a real DB/tenant failure)
  stubFetch(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: "tenant/db unavailable" }),
  }));
  const r2 = await hydrate();
  assert.equal(r2.ok, false, `${label}: 503 response must yield ok:false, got ${r2.ok}`);

  console.log(`  ok  ${label}: failure paths correctly report ok:false`);
}

async function expectOkTrueOnSuccess(
  label: string,
  hydrate: () => Promise<{ ok: boolean }>,
  successBody: unknown,
) {
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => successBody,
  }));
  const r = await hydrate();
  assert.equal(r.ok, true, `${label}: successful fetch must yield ok:true, got ${r.ok}`);
  console.log(`  ok  ${label}: success path reports ok:true`);
}

async function main() {
  console.log("hydrateFailureSafety.selftest.ts");

  {
    const { hydrateSisDeskFromDb } = await import("./sisNormalizedClient");
    await expectOkFalseOnFailure("sis", () => hydrateSisDeskFromDb());
    await expectOkTrueOnSuccess("sis", () => hydrateSisDeskFromDb(), {
      ok: true,
      households: [],
      students: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  {
    const { hydrateAdmissionsDeskFromDb } = await import("./admissionsNormalizedClient");
    await expectOkFalseOnFailure("admissions", () => hydrateAdmissionsDeskFromDb());
  }

  {
    const { hydrateFeesDeskFromDb } = await import("./feesNormalizedClient");
    await expectOkFalseOnFailure("fees", () => hydrateFeesDeskFromDb());
  }

  {
    const { hydrateLibraryDeskFromDb } = await import("./libraryNormalizedClient");
    await expectOkFalseOnFailure("library", () => hydrateLibraryDeskFromDb());
  }

  {
    const { hydrateStaffAttendanceDeskFromDb } = await import(
      "./staffAttendanceNormalizedClient"
    );
    await expectOkFalseOnFailure("staffAttendance", () =>
      hydrateStaffAttendanceDeskFromDb(),
    );
  }

  console.log("\nAll hydrate-failure-safety checks passed.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
