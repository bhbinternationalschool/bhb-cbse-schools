/**
 * Shared pieces of the Playwright gate (data-layer step 1.1).
 *
 *  - `test`: Playwright's test with the page signed in as the office (the
 *    fixture's office member), and a `cpuThrottle` option the phone project
 *    sets to 4 (CDP Emulation.setCPUThrottlingRate).
 *  - `openAs(browser, who)`: a fresh context + page signed in as another
 *    fixture login — a second office tab, the class teacher, the
 *    timetable-only teacher.
 *  - `metric(testInfo, …)`: a measurement the scoreboard reporter writes to
 *    e2e/scoreboard.json.
 *
 * Login is the app's own signed `bhb_demo_session` cookie, minted by
 * e2e/session.ts (signSession, keyed on the stack's APP_SESSION_SECRET) and
 * refused unless this process is on the 127.0.0.1 stack.
 */
import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { demoSessionCookieName } from "@/lib/auth";
import { buildFixture, type E2eFixture } from "./fixture";
import { assertLocalStack, mintSessionCookie } from "./session";

assertLocalStack();

export const fx: E2eFixture = buildFixture();
export type Who = keyof E2eFixture["sessions"];

export const APP_URL = (() => {
  const u = process.env.E2E_APP_URL ?? "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) throw new Error(`E2E_APP_URL is "${u}", not 127.0.0.1`);
  return u;
})();

export type GateOptions = { cpuThrottle: number };

/** Put `who`'s signed session cookie on a context. */
export async function signIn(context: BrowserContext, who: Who): Promise<void> {
  await context.addCookies([
    {
      name: demoSessionCookieName(),
      value: mintSessionCookie(fx.sessions[who]),
      url: APP_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** A new browser context (desktop defaults) signed in as `who`. */
export async function openAs(browser: Browser, who: Who): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await signIn(context, who);
  const page = await context.newPage();
  return { context, page };
}

/** Record a measurement for the scoreboard (and the HTML report). */
export async function metric(testInfo: TestInfo, name: string, value: Record<string, unknown>): Promise<void> {
  await testInfo.attach(`metric:${name}`, {
    body: JSON.stringify(value),
    contentType: "application/json",
  });
}

/** A visible note on the test in the report and the scoreboard. */
export function note(testInfo: TestInfo, type: string, description: string): void {
  testInfo.annotations.push({ type, description });
}

export const test = base.extend<GateOptions>({
  cpuThrottle: [1, { option: true }],
  // The fixture callback is named `provide`, not Playwright's usual `use`:
  // the React hooks lint rule would take `use(...)` for React's use().
  context: async ({ context }, provide) => {
    await signIn(context, "office");
    await provide(context);
  },
  page: async ({ page, cpuThrottle }, provide) => {
    if (cpuThrottle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
    }
    await provide(page);
  },
});

export { expect };

/**
 * The number a "<n> <label>" element shows, e.g. the Masters overview card
 * button "15 Classes". Reads the DOM text, never the network.
 */
export function leadingNumber(text: string | null | undefined): number | null {
  const m = /^\s*(\d+)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

/** Watch a page for uncaught exceptions (React crashes land here). */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
  return errors;
}
