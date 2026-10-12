/**
 * Self-test: the Accounts "Today collection" tile (13 Oct 2026).
 * Run: npx tsx src/lib/accountsTodayTile.selftest.ts
 *
 * It summed the Receipts & Payments receipts, which count a voided receipt as
 * money in (its reversal goes to the payments side): ₹20,610 on a day that
 * took ₹15,610. It also read "today" in UTC, so from 00:00 to 05:30 IST it
 * showed yesterday. It now uses the month chart's rule (ledger_monthly_cash:
 * reversals and what they reverse are left out) for one IST day.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "accountsServerKpis.ts"), "utf8");
assert.ok(/dayMoneyInPaise\(today\)/.test(src), "today's tile reads one day of money in from monthly-cash");
assert.ok(!/action: "receipts-payments"/.test(src), "never the R&P receipts total, which keeps voided receipts");
assert.ok(/timeZone: "Asia\/Kolkata"/.test(src), "today is the school's (IST) day");
assert.ok(/return res\?\.ok \? .* : null;/.test(src), "a failed read shows nothing, never ₹0");

const dash = readFileSync(join(__dirname, "moduleDashboards.ts"), "utf8");
assert.ok(/const IST_DAY = new Intl\.DateTimeFormat\("en-CA", \{ timeZone: "Asia\/Kolkata" \}\)/.test(dash), "dashboards' today is IST");
assert.ok(!/function todayIso\(\) \{\n  return new Date\(\)\.toISOString\(\)/.test(dash));

console.log("accountsTodayTile.selftest.ts\n  ok");
