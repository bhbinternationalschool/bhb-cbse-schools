/**
 * Playwright — the behavioural gate (data-layer step 1.1).
 *
 *   bash scripts/e2e-stack.sh up && bash scripts/e2e-stack.sh build && bash scripts/e2e-stack.sh app
 *   cd apps/web && node ../../scripts/e2e/with-env.mjs .env.e2e -- npx playwright test
 *
 * Runs against the local stack that is ALREADY UP (scripts/e2e-stack.sh). This
 * config starts nothing, seeds nothing and builds nothing: there is no
 * webServer and no globalSetup, so nothing here can reach production. It
 * refuses to load unless the app URL and the Supabase URL are both
 * http://127.0.0.1:<port> and E2E=1 — i.e. unless apps/web/.env.e2e was loaded
 * through scripts/e2e/with-env.mjs (which also refuses to run beside an
 * .env.local).
 *
 * The suite expects a FRESHLY seeded stack (`up`): counts are asserted against
 * the fixture (e2e/fixture.ts), and the propagation project — which runs last —
 * writes to it (a subject, a section name, a staff record). A second run on the
 * same stack needs `down && up` first.
 *
 * Results: e2e/report (HTML) and e2e/scoreboard.json (e2e/scoreboard-reporter.ts):
 * every test is pass / expected-fail (test.fail with the reason) / FAIL /
 * UNEXPECTED-PASS / fixme. The run is green when every test is pass, expected-fail
 * or fixme; an expected failure that starts passing turns the run red, so the
 * fix must remove its test.fail().
 */
import { defineConfig, devices } from "@playwright/test";
import type { GateOptions } from "./e2e/support";

const LOCAL = /^http:\/\/127\.0\.0\.1:\d+$/;
const APP_URL = process.env.E2E_APP_URL ?? "";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!LOCAL.test(APP_URL)) {
  throw new Error(`playwright.config: E2E_APP_URL is "${APP_URL}", not http://127.0.0.1:<port> — load .env.e2e via scripts/e2e/with-env.mjs`);
}
if (!LOCAL.test(API_URL)) {
  throw new Error(`playwright.config: NEXT_PUBLIC_SUPABASE_URL is "${API_URL}", not the 127.0.0.1 e2e stack — refusing`);
}
if (process.env.E2E !== "1") {
  throw new Error("playwright.config: E2E=1 is not set — load apps/web/.env.e2e via scripts/e2e/with-env.mjs");
}

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig<GateOptions>({
  testDir: "./e2e/specs",
  outputDir: "./e2e/test-results",
  // One app, one database, one browser at a time: timings and byte counts are
  // only comparable without neighbours, and the propagation specs write.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/report", open: "never" }],
    ["./e2e/scoreboard-reporter.ts"],
  ],
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /(propagation|transport-paid-month|dues-screens-transport|dues-transport-desk|parent-web-dues|payroll|staff-month-register|notifications|student-upgrade|school-chat|masters-overlay|masters-element-writes|parent-web-tabs|fuel-per-bus-range|certificates-dues-gate|staff-editor-save|print-signatures|staff-sensitive-screens|staff-locked-validation|staff-editor-writes|staff-followups|fee-writes)\.spec\.ts/,
      use: { ...desktop },
    },
    {
      // A phone: 375 px wide, touch, and the CPU slowed 4× through CDP
      // (Emulation.setCPUThrottlingRate, see e2e/support.ts).
      name: "phone-375-cpu4x",
      testMatch: /counts\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, cpuThrottle: 4 },
    },
    {
      // Writes a transport desk and receipts (the 15 Oct paid-month case) and
      // a bus with fuel fills (21 Oct, fuel-per-bus-range), so it runs after
      // everything that reads the stack.
      name: "money-writes",
      testMatch: /(transport-paid-month|dues-screens-transport|dues-transport-desk|parent-web-dues|parent-web-tabs|fuel-per-bus-range)\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Writes a month of staff registers and a leave (15 Oct 2026, the staff
      // month register), so it runs after everything that reads the stack.
      name: "staff-register",
      testMatch: /staff-month-register\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Raises a staff request and takes ₹1 at the counter (20 Oct 2026, the
      // notification service), so it runs after everything that reads the stack.
      name: "notify-writes",
      testMatch: /notifications\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Writes chat messages, a mute and a block (lifted again), so it runs
      // after everything that reads the stack (16 Oct 2026, school chat).
      name: "chat-writes",
      testMatch: /school-chat\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Gives a member the Accounts role for the run (removed afterwards) and
      // writes a bank number back as found (2.2b), so it runs after everything
      // that reads the stack.
      name: "staff-sensitive",
      testMatch: /(staff-sensitive-screens|staff-locked-validation|staff-editor-writes|staff-followups)\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Puts signatures on three staff records (and takes them off again —
      // 21 Oct 2026, staff signatures on printed documents), so it runs
      // after everything that reads the stack.
      name: "signature-writes",
      testMatch: /print-signatures\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Writes to the stack, so it runs after everything that reads it.
      name: "propagation",
      testMatch: /(propagation|student-upgrade|masters-overlay|masters-element-writes|staff-editor-save)\.spec\.ts/,
      dependencies: ["desktop", "phone-375-cpu4x"],
      use: { ...desktop },
    },
    {
      // Writes salary setup and the statutory setup (put back afterwards), so
      // it runs last (listed last, after propagation). Not a dependent of
      // money-writes: a failure there would skip it.
      name: "payroll-writes",
      testMatch: /payroll\.spec\.ts/,
      dependencies: ["propagation"],
      use: { ...desktop },
    },
    {
      // Seeds a tuition fee structure, which switches on the school's built-in
      // 2026-27 structures for EVERY class (ensureFeeSetup) — every child then
      // owes. So it runs after every other project (21 Oct 2026, the TC /
      // no-dues gate) and takes its structure out again afterwards.
      name: "cert-gate",
      testMatch: /certificates-dues-gate\.spec\.ts/,
      dependencies: ["money-writes", "staff-register", "notify-writes", "chat-writes", "payroll-writes"],
      use: { ...desktop },
    },
    {
      // Seeds its own fee structure and writes concession grants, receipts,
      // an RTE child and a fee-setup clone (data-layer 2.2e) — a structure
      // switches on the built-in structures for every class, so it runs
      // after every other project and takes everything out again.
      name: "fee-writes",
      testMatch: /fee-writes\.spec\.ts/,
      dependencies: ["cert-gate"],
      use: { ...desktop },
    },
  ],
});
