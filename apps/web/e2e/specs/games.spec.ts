/**
 * games — a teacher-launched competition, end to end (director, 15 Oct 2026).
 *
 *   1. The principal opens Learning games and launches a Class III maths quiz,
 *      III-A vs IV-A, from the web desk.
 *   2. A child in III-A and a child in IV-A play it from the parent app's
 *      routes (the app is Flutter; these are the requests it makes).
 *   3. The principal's open leaderboard fills in without a reload (polled
 *      every 5 s): III-A first, first names only, stars shown.
 *   4. The stars reach each family's Games screen.
 *
 * Every request carries `x-e2e-clock` = a Wednesday at 4 pm IST (after school,
 * before 9 pm) — honoured only on this stack (lib/learningGames.server
 * gameNow) — so the run does not depend on the runner's time of day. A 375 px
 * screenshot of the desk is attached to the report.
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { parentSession, rest, tenantId } from "../parentApi.support";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, metric, openAs, test } from "../support";

const CLOCK = "2026-10-21T16:00:00+05:30";

const childIn = (k: number) => {
  const s = fx.sis.students.find(
    (x) => x.sectionId === sectionId(k) && x.academicYearCode === AY_CURRENT && x.status === "active" && !/inactive|dupadm/.test(x.householdId),
  );
  if (!s) throw new Error(`no child in section ${k}`);
  return s;
};

async function familyApi(householdId: string): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: APP_URL,
    extraHTTPHeaders: { cookie: sessionCookieHeader(parentSession(householdId)), "x-e2e-clock": CLOCK },
  });
}

async function cleanup(): Promise<void> {
  const tid = await tenantId();
  const db = rest();
  await db.remove(`game_sessions?tenant_id=eq.${tid}`);
  await db.remove(`game_competitions?tenant_id=eq.${tid}`);
  await db.remove(`game_questions?tenant_id=eq.${tid}`);
  await db.remove(`game_settings?tenant_id=eq.${tid}`);
}

/** Plays the competition from the parent app's routes; `right` of the questions answered correctly. */
async function play(api: APIRequestContext, studentId: string, competitionId: string, right: number) {
  const start = await api.post("/api/v1/games/start", { data: { studentId, competitionId } });
  expect(start.status(), await start.text()).toBe(200);
  const { data } = (await start.json()) as { data: { sessionId: string; items: { options: string[] }[] } };
  // The right answers are only on the server; the test reads them from the stack's database.
  const rows = (await rest().select(`game_sessions?id=eq.${data.sessionId}&select=items`)) as { items: { answer: number }[] }[];
  const answers = rows[0]!.items.map((it) => it.answer);
  for (let i = 0; i < data.items.length; i++) {
    const choice = i < right ? answers[i]! : (answers[i]! + 1) % data.items[i]!.options.length;
    const a = await api.post("/api/v1/games/answer", { data: { sessionId: data.sessionId, index: i, choice } });
    expect(a.status()).toBe(200);
  }
  // A forged score rides along; the server ignores it.
  const fin = await api.post("/api/v1/games/finish", { data: { sessionId: data.sessionId, correct: 99, stars: 99 } });
  expect(fin.status()).toBe(200);
  return ((await fin.json()) as { data: { correct: number; stars: number; total: number } }).data;
}

test("a teacher launches a competition, two sections play, the leaderboard and the stars follow", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  await cleanup();
  const { context, page } = await openAs(browser, "principal");
  await context.setExtraHTTPHeaders({ "x-e2e-clock": CLOCK });
  const kidA = childIn(6); // III-A
  const kidB = childIn(7); // IV-A
  const famA = await familyApi(kidA.householdId);
  const famB = await familyApi(kidB.householdId);
  try {
    await test.step("Class III has five approved maths questions (a teacher's own)", async () => {
      const qs: [string, string[], number][] = [
        ["5 + 3 = ?", ["7", "8", "9"], 1],
        ["10 − 4 = ?", ["6", "5", "4"], 0],
        ["2 × 6 = ?", ["10", "14", "12"], 2],
        ["Half of 18?", ["9", "8"], 0],
        ["Which is the biggest?", ["99", "909", "990"], 2],
      ];
      for (const [prompt, options, answerIndex] of qs) {
        const r = await page.request.post("/api/v1/staff/games/pool", {
          data: { op: "add", classId: classId(6), subjectKey: "maths", prompt, options, answerIndex },
        });
        expect(r.status(), await r.text()).toBe(200);
      }
    });

    await test.step("the principal launches III-A vs IV-A from the desk", async () => {
      await page.goto("/games");
      await expect(page.getByRole("heading", { name: "Launch a competition" })).toBeVisible({ timeout: 60_000 });
      await page.getByLabel("Title").fill("III vs IV maths");
      await page.getByLabel("Section III-A").check();
      await page.getByLabel("Section IV-A").check();
      await expect(page.getByLabel("Subject").locator("option", { hasText: "Mathematics (5)" })).toHaveCount(1, { timeout: 30_000 });
      await page.getByLabel("Subject").selectOption("maths");
      await page.getByLabel("Number of questions").fill("5");
      await page.getByRole("button", { name: "Launch competition" }).click();
      await expect(page.getByText(/Launched “III vs IV maths”/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("games-leaderboard")).toContainText("Nobody has finished yet", { timeout: 15_000 });
    });

    let competitionId = "";
    await test.step("the competition is on both children's Games screens", async () => {
      for (const [api, kid] of [
        [famA, kidA],
        [famB, kidB],
      ] as const) {
        const s = await api.get(`/api/v1/games/status?studentId=${kid.id}`);
        expect(s.status()).toBe(200);
        const body = (await s.json()) as { data: { competitions: { id: string; title: string; phase: string; played: boolean }[] } };
        const c = body.data.competitions.find((x) => x.title === "III vs IV maths");
        expect(c?.phase).toBe("open");
        expect(c?.played).toBe(false);
        competitionId = c!.id;
      }
    });

    let launchedAt = 0;
    await test.step("A (III-A) gets 5 of 5, B (IV-A) gets 2 of 5", async () => {
      launchedAt = Date.now();
      const a = await play(famA, kidA.id, competitionId, 5);
      expect([a.correct, a.stars, a.total]).toEqual([5, 5, 5]);
      const b = await play(famB, kidB.id, competitionId, 2);
      expect([b.correct, b.stars]).toEqual([2, 2]);
    });

    let seenAfterMs = -1;
    await test.step("the open leaderboard fills in without a reload", async () => {
      const board = page.getByTestId("games-leaderboard");
      const standings = board.getByTestId("games-section-standing");
      await expect(standings).toHaveCount(2, { timeout: 15_000 });
      await expect(standings.nth(0)).toContainText("1. III-A", { timeout: 15_000 });
      await expect(standings.nth(0)).toContainText("5 right per player");
      await expect(standings.nth(1)).toContainText("2. IV-A");
      seenAfterMs = Date.now() - launchedAt;
      const players = board.getByTestId("games-player-standing");
      await expect(players).toHaveCount(2);
      const firstA = kidA.fullName.split(" ")[0]!;
      await expect(players.nth(0)).toContainText(`1. ${firstA} (III-A)`);
      await expect(players.nth(0)).toContainText("⭐ 5");
      // First names only: no surname anywhere on the board.
      const surnameA = kidA.fullName.split(" ").slice(1).join(" ");
      if (surnameA) await expect(board).not.toContainText(kidA.fullName);
    });

    await test.step("the stars reach each family's Games screen", async () => {
      const sa = (await (await famA.get(`/api/v1/games/status?studentId=${kidA.id}`)).json()) as { data: { stars: { today: number; week: number }; competitions: { id: string; played: boolean }[] } };
      expect(sa.data.stars.today).toBe(5);
      expect(sa.data.competitions.find((c) => c.id === competitionId)?.played).toBe(true);
      const sb = (await (await famB.get(`/api/v1/games/status?studentId=${kidB.id}`)).json()) as { data: { stars: { today: number } } };
      expect(sb.data.stars.today).toBe(2);
      const again = await famA.post("/api/v1/games/start", { data: { studentId: kidA.id, competitionId } });
      expect(again.status()).toBe(409);
    });

    await test.step("the desk at 375 px", async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.getByTestId("games-leaderboard").scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await testInfo.attach("games-desk-375.png", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
      expect(overflow, "no sideways scroll at 375 px").toBeLessThanOrEqual(1);
    });
    await metric(testInfo, "games-competition", { seenAfterMs });
  } finally {
    await famA.dispose();
    await famB.dispose();
    await context.close();
    await cleanup();
  }
});
