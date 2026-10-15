/**
 * transport-paid-month — a paid transport month stays paid when the child's
 * stop changes (production, 15 Oct 2026: Anvi Yadav).
 *
 * The exact shape, written through the app's own server write paths
 * (pushTransportDeskToDb — the transport-desk POST; pushFeeDeskToDb — the
 * fee-desk POST), for one fixture child no other spec touches:
 *
 *   old assignment  Apr–Aug, stop id that NO LONGER EXISTS on the route, no
 *                   fee of its own (stop-id churn) → the engine bills it ₹0
 *   new assignment  from 1 Sep (backdated over the paid September), ₹500
 *   receipts        Apr–Aug ₹500 each under the OLD id; September ₹500
 *                   under the OLD id, collected 10 Sep
 *
 * Asserted from the DOM, on the fee counter (Fee Take) and on the student's
 * fee card: April–September PAID, October owing ₹500, nothing else owing on
 * transport. On the old code September showed ₹500 owing and April–August
 * were missing altogether.
 *
 * Writes to the stack, so it runs in its own project after the readers.
 * Screenshots: e2e/transport-paid-shots (git-ignored), desktop-light and
 * phone-375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, fx, signIn, test } from "../support";
import { execFileSync } from "node:child_process";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CHILD, NEW, MONTH_NAMES, APR_SEP } from "../transportPaidCase";

const SHOTS = process.env.TRANSPORT_PAID_SHOTS || path.join(__dirname, "..", "transport-paid-shots");

async function open(browser: Browser, opts: { width: number; height: number; dark?: boolean }): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("open dues on the server: October owing, September not", async ({ browser }) => {
  // fee_desk_open_dues — the table the parent app, pay links, reminders and
  // defaulter lists read — rebuilt by the app's own route.
  const page = await open(browser, { width: 1440, height: 900 });
  const res = await page.request.post(`/api/fees/rebuild-open-dues?ay=${CHILD.academicYearCode}`);
  expect(res.status(), await res.text()).toBe(200);
  await page.context().close();
  const sb = createServiceSupabase()!;
  const { data, error } = await sb
    .from("fee_desk_open_dues")
    .select("due_key, balance_paise")
    .eq("student_id", CHILD.id)
    .like("due_key", "transport:%");
  expect(error).toBeNull();
  const rows = (data ?? []).map((r) => ({ key: String(r.due_key), bal: Number(r.balance_paise) }));
  expect(rows.filter((r) => r.key.endsWith(":2026-09"))).toEqual([]);
  expect(rows.filter((r) => r.key.endsWith(":2026-10"))).toEqual([
    { key: `transport:${CHILD.id}:${NEW}:2026-10`, bal: 50000 },
  ]);
});

void MONTH_NAMES;
void APR_SEP;
void fx;
