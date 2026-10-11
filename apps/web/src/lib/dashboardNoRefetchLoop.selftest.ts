import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("dashboardNoRefetchLoop.selftest.ts");

/**
 * Screens that load data must not ask the server again on every redraw
 * (11 Oct 2026: Fee Take re-read the dues summary and store dues about once
 * a second while open; Home re-ran the several-second anomaly scan each time
 * a desk landed; Attendance pulled its desk twice).
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── Module dashboard: hydration runs once per module ───────────────────────
{
  const src = read("../components/dashboard/ModuleDashboardHost.tsx");
  const hydrate = src.indexOf('await import("@/lib/deskHydrateGuard")');
  assert.ok(hydrate > 0, "the module dashboard still hydrates its desk");
  const effectEnd = src.indexOf("}, [", hydrate);
  const deps = src.slice(effectEnd, src.indexOf("]);", effectEnd) + 1);
  assert.equal(deps, "}, [moduleId]", "the hydrating effect depends on the module only");
  assert.ok(!/mastersTick/.test(deps), "bumping mastersTick must not re-run hydration");
  assert.ok(/if \(!gone\) setMastersTick/.test(src.slice(hydrate, effectEnd)), "the tick is bumped once, and not after unmount");
}

// ── Home: the anomaly scan is not tied to the redraw tick ──────────────────
{
  const src = read("../components/dashboard/SchoolHomeDashboard.tsx");
  const at = src.indexOf("/api/v1/owner/anomalies");
  assert.ok(at > 0);
  const deps = src.slice(src.indexOf("}, [", at), src.indexOf("]);", src.indexOf("}, [", at)) + 1);
  assert.equal(deps, "}, [superAdmin, ayCode]", "anomalies are read once per visit and year");
  const server = read("ownerAnomalies.server.ts");
  assert.ok(/ANOMALY_TTL_MS = 60_000/.test(server), "the scan is shared for a minute");
  assert.ok(/anomalyCache\.delete\(key\)/.test(server), "a failed scan is not cached");
}

// ── Attendance: callers mid-load share one load ────────────────────────────
{
  const src = read("attendancePersistence.ts");
  const body = src.slice(src.indexOf("export function ensureAttendanceHydrated("), src.indexOf("async function hydrateAttendanceOnce("));
  assert.ok(/if \(!hydrating\)/.test(body) && /return hydrating;/.test(body), "concurrent hydrations share one promise");
}

console.log("dashboardNoRefetchLoop: ok");
