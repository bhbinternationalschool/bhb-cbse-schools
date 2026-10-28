/**
 * chat-logs — school chat reaches the message logs (29 Oct 2026).
 *
 * PR #737 moved the web header chat onto school chat (school_chat_* rows);
 * the staff timeline (/api/comms/staff-log, Staff → Messages) and the
 * household history (/api/comms/household-log, student profile → Messages)
 * still read the old chat blob (erp_chat_state), which nothing writes any
 * more — so neither log showed a single new chat message. They now read
 * school_chat_messages, scoped to the person (lib/schoolChatLog.server.ts).
 *
 * Against the local stack's seeded school: staff 21 and 22 (a direct chat;
 * neither is used by school-chat / chat-one, whose per-sender limit is
 * shared), the principal (a moderator — may message any family) and the
 * family of an active LKG-A child.
 *
 * Proves:
 *  1. a staff↔staff message is in both staff timelines (in / out, "You");
 *  2. a staff↔family chat is in the family's history and the staff
 *     member's timeline, both ways;
 *  3. the screens: Staff → Messages and the student profile → Messages
 *     list the messages (desktop light; 375 px dark).
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, signIn, test } from "../support";
import type { DemoSession } from "@/lib/auth";

const A = 21;
const B = 22;
const tag = `log-${Date.now().toString(36)}`;

const staffSession = (n: number): DemoSession => {
  const s = fx.staff.staff[n - 1]!;
  return { persona: "staff", fullName: s.fullName, roleCode: "teacher", staffId: s.id, tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT };
};
const child = fx.sis.students.find((s) => s.classId === classId(2) && s.sectionId === sectionId(2) && s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId)!;
const parentSession: DemoSession = {
  persona: "parent",
  fullName: "E2E Parent",
  roleCode: "parent",
  householdId: child.householdId,
  tenantSlug: fx.sessions.office.tenantSlug,
  academicYearCode: AY_CURRENT,
};

type Entry = { id: string; channel: string; direction: "in" | "out"; preview: string; by: string; at: string };
type Res = { status: number; body: { ok?: boolean; data?: { id: string }; entries?: Entry[]; error?: string | { message: string } } };

async function api(session: DemoSession): Promise<{ ctx: APIRequestContext; get: (p: string) => Promise<Res>; post: (p: string, d: unknown) => Promise<Res> }> {
  const ctx = await pwRequest.newContext({ baseURL: APP_URL, extraHTTPHeaders: { cookie: sessionCookieHeader(session) } });
  const wrap = async (r: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Res> => ({ status: r.status(), body: (await r.json().catch(() => ({}))) as Res["body"] });
  return { ctx, get: async (p) => wrap(await ctx.get(p)), post: async (p, d) => wrap(await ctx.post(p, { data: d })) };
}

async function send(who: Awaited<ReturnType<typeof api>>, conversationId: string, body: string, studentId?: string) {
  const r = await who.post("/api/v1/school-chat/send", { conversationId, body, ...(studentId ? { studentId } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

const mine = (entries: Entry[] | undefined) => (entries ?? []).filter((e) => e.channel === "app_chat" && e.preview.includes(tag));

test.describe.configure({ mode: "serial" });

test.describe("chat-logs: school chat in the staff and household message logs", () => {
  test.skip(!child, "fixture: no active LKG-A child with a family");

  test("1–2. both logs list school chat messages, scoped and directed", async () => {
    const [a, b, principal, family, office] = await Promise.all([api(staffSession(A)), api(staffSession(B)), api(fx.sessions.principal), api(parentSession), api(fx.sessions.office)]);
    try {
      const dm = await a.post("/api/v1/school-chat/direct", { with: { kind: "staff", id: staffSession(B).staffId } });
      expect(dm.status, JSON.stringify(dm.body)).toBe(200);
      await send(a, dm.body.data!.id, `Timetable swap tomorrow? ${tag}`);
      await send(b, dm.body.data!.id, `Yes, period 3 ${tag}`);

      const fdm = await principal.post("/api/v1/school-chat/direct", { with: { kind: "parent", studentId: child.id } });
      expect(fdm.status, JSON.stringify(fdm.body)).toBe(200);
      await send(principal, fdm.body.data!.id, `Please meet the class teacher on Friday ${tag}`);
      await send(family, fdm.body.data!.id, `We will come at 10 ${tag}`, child.id);

      // 1. staff timelines
      const logA = await office.get(`/api/comms/staff-log?staffId=${encodeURIComponent(staffSession(A).staffId!)}`);
      expect(logA.status, JSON.stringify(logA.body)).toBe(200);
      expect(mine(logA.body.entries).map((e) => [e.direction, e.by, e.preview])).toEqual([
        ["in", expect.any(String), `Yes, period 3 ${tag}`],
        ["out", "You", `Timetable swap tomorrow? ${tag}`],
      ]);
      const logB = await office.get(`/api/comms/staff-log?staffId=${encodeURIComponent(staffSession(B).staffId!)}`);
      expect(mine(logB.body.entries).map((e) => e.direction)).toEqual(["out", "in"]);
      const logP = await office.get(`/api/comms/staff-log?staffId=${encodeURIComponent(fx.sessions.principal.staffId!)}`);
      expect(mine(logP.body.entries).map((e) => [e.direction, e.preview])).toEqual([
        ["in", `We will come at 10 ${tag}`],
        ["out", `Please meet the class teacher on Friday ${tag}`],
      ]);

      // 2. the family's history: the chat with the principal, nothing of staff 21/22's
      const logH = await office.get(`/api/comms/household-log?householdId=${encodeURIComponent(child.householdId)}`);
      expect(logH.status, JSON.stringify(logH.body)).toBe(200);
      expect(mine(logH.body.entries).map((e) => [e.direction, e.preview])).toEqual([
        ["in", `We will come at 10 ${tag}`],
        ["out", `Please meet the class teacher on Friday ${tag}`],
      ]);
    } finally {
      await Promise.all([a, b, principal, family, office].map((x) => x.ctx.dispose()));
    }
  });

  for (const v of [
    { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, isMobile: false },
    { name: "phone375-dark", viewport: { width: 375, height: 812 }, colorScheme: "dark" as const, isMobile: true },
  ]) {
    test(`3. the screens (${v.name}): Staff → Messages and the student profile → Messages`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: APP_URL, viewport: v.viewport, colorScheme: v.colorScheme, isMobile: v.isMobile, hasTouch: v.isMobile });
      await signIn(context, "office");
      const page = await context.newPage();
      try {
        await page.goto(`/staff/${encodeURIComponent(staffSession(A).staffId!)}/edit`);
        await page.getByRole("button", { name: "Messages", exact: true }).first().click({ timeout: 30_000 });
        await expect(page.getByText(`Timetable swap tomorrow? ${tag}`)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(`Yes, period 3 ${tag}`)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`staff-messages-${v.name}.png`) });

        await page.goto("/students?tab=register");
        await page.getByPlaceholder(/Search name, adm no/).first().fill(child.fullName);
        await page.getByRole("button", { name: new RegExp(`${child.admissionNo} ·`) }).first().click({ timeout: 30_000 });
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("button", { name: "Messages", exact: true }).click();
        await expect(dialog.getByText(`We will come at 10 ${tag}`)).toBeVisible({ timeout: 20_000 });
        await expect(dialog.getByText(`Please meet the class teacher on Friday ${tag}`)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`student-messages-${v.name}.png`) });
      } finally {
        await context.close();
      }
    });
  }
});
