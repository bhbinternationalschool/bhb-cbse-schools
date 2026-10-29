/**
 * chat-one — one school chat in the database, everywhere (director, 29 Oct 2026):
 * "I made a new group, sent hello, and it did not reach anyone."
 *
 * The web header chat kept groups and messages in one server's memory
 * (lib/erpChatServer, .data/erp_chat.json) and each browser's localStorage;
 * on Cloud Run a message reached only people served by the same instance.
 * It is now school chat (/api/v1/school-chat), the same rows the apps read.
 *
 * Against the local stack's seeded school (e2e/fixture.ts): staff 25 (a
 * subject teacher of Nursery-A — makes the groups), staff 23 (a member; also
 * the "staff app"), staff 19 (teaches neither), Nursery-A's class teacher
 * (fx.sessions.teacher — a member, signed in for the screens), the principal
 * (a moderator), a Nursery-A family and an LKG-A family. Its own people, not
 * school-chat.spec's: the per-sender limit (10 a minute) is shared.
 *
 * Proves:
 *  0. two server processes, one database: a group made and a message sent
 *     through instance A are read through instance B (E2E_APP_URL_B — the
 *     local run starts a second `next start`; skipped when it is not set);
 *  1. a teacher makes a group on the web, says "hello", the member sees it
 *     with an unread count; reading it clears the count;
 *  2. the staff app's request (its headers, the same routes) and the web's
 *     read each other's messages;
 *  3. a non-member is refused (403) — reading and sending; a family cannot
 *     make a group;
 *  4. a group with a class section: that section's family reads it and
 *     cannot post (403); another section's family is refused; a teacher
 *     who does not teach the section cannot add it (403);
 *  5. moderation and blocks: a staff member's abusive message in a group is
 *     held (members do not see it); a muted member cannot send; lifting
 *     the mute restores them;
 *  6. the old store is gone: /api/chat answers 404;
 *  7. the screens: the header chat button with its unread badge and the
 *     drawer (desktop, light; 375 px, dark), and the parent portal's button.
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, signIn, test } from "../support";
import type { DemoSession } from "@/lib/auth";

const APP_URL_B = process.env.E2E_APP_URL_B || "";
/** Staff numbers in the fixture: 25 teaches a subject in Nursery-A (and LKG's neighbour), 23 and 19 do not. */
const MAKER = 25;
const MEMBER = 23;
const OUTSIDER = 19;

const staffSession = (n: number): DemoSession => {
  const s = fx.staff.staff[n - 1]!;
  return { persona: "staff", fullName: s.fullName, roleCode: "teacher", staffId: s.id, tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT };
};
const parentSession = (householdId: string): DemoSession => ({
  persona: "parent",
  fullName: "E2E Parent",
  roleCode: "parent",
  householdId,
  tenantSlug: fx.sessions.office.tenantSlug,
  academicYearCode: AY_CURRENT,
});

function firstChildOf(k: number) {
  return fx.sis.students.find((s) => s.classId === classId(k) && s.sectionId === sectionId(k) && s.academicYearCode === AY_CURRENT && s.status === "active");
}

type Json = {
  ok?: boolean;
  data: {
    id: string;
    title: string;
    unread: number;
    held: boolean;
    conversations: { id: string; kind: string; title: string; unread: number }[];
    messages: { id: string; body: string; status: string; senderLabel: string; mine: boolean }[];
    conversation: { canSend: boolean; readOnly: boolean; title: string };
  };
  error: { message: string };
};
type Res = { status: number; body: Json };
type Api = { ctx: APIRequestContext; get: (p: string) => Promise<Res>; post: (p: string, d: unknown) => Promise<Res> };

async function api(session: DemoSession, baseURL = APP_URL, extra: Record<string, string> = {}): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { cookie: sessionCookieHeader(session), ...extra } });
  const wrap = async (r: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Res> => ({ status: r.status(), body: (await r.json().catch(() => null)) as Json });
  return { ctx, get: async (p) => wrap(await ctx.get(p)), post: async (p, d) => wrap(await ctx.post(p, { data: d })) };
}

/** The staff app's request: the same cookie and routes, with the app's own headers (AppBuild.headers). */
const APP_HEADERS = { "X-App-Flavor": "staff", "X-App-Build": "37", "Content-Type": "application/json" };

const msgs = (who: Api, conv: string, studentId?: string) =>
  who.get(`/api/v1/school-chat/messages?conversationId=${encodeURIComponent(conv)}${studentId ? `&studentId=${studentId}` : ""}`);
const bodies = (r: Res): string[] => (r.body?.data?.messages ?? []).map((m) => m.body);

test.describe.serial("chat-one: the header chat is school chat", () => {
  const tag = Date.now().toString(36);
  const ct = fx.sessions.teacher; // Nursery-A's class teacher
  const famA = firstChildOf(1)!;
  const famB = firstChildOf(2)!;
  let maker: Api, member: Api, memberApp: Api, outsider: Api, classTeacher: Api, principal: Api, parentA: Api, parentB: Api;
  let groupId = "";
  let sectionGroupId = "";

  test.beforeAll(async () => {
    expect(famA && famB, "fixture has a Nursery-A and an LKG-A child").toBeTruthy();
    maker = await api(staffSession(MAKER));
    member = await api(staffSession(MEMBER));
    memberApp = await api(staffSession(MEMBER), APP_URL, APP_HEADERS);
    outsider = await api(staffSession(OUTSIDER));
    classTeacher = await api(ct);
    principal = await api(fx.sessions.principal);
    parentA = await api(parentSession(famA.householdId));
    parentB = await api(parentSession(famB.householdId));
  });
  test.afterAll(async () => {
    for (const a of [maker, member, memberApp, outsider, classTeacher, principal, parentA, parentB]) await a?.ctx.dispose();
  });

  test("0. two server processes, one database: sent through A, read through B", async () => {
    test.skip(!APP_URL_B, "E2E_APP_URL_B not set — the local run starts a second next start for this");
    const makerB = await api(staffSession(MAKER), APP_URL_B);
    const memberB = await api(staffSession(MEMBER), APP_URL_B);
    try {
      const g = await maker.post("/api/v1/school-chat/groups", { title: `Two instances ${tag}`, staffIds: [staffSession(MEMBER).staffId] });
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      const s = await maker.post("/api/v1/school-chat/send", { conversationId: g.body.data.id, body: `hello from A ${tag}` });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      // B never served the group or the message.
      const listB = await memberB.get("/api/v1/school-chat/conversations");
      expect(listB.body.data.conversations.map((c) => c.id)).toContain(g.body.data.id);
      expect(bodies(await msgs(memberB, g.body.data.id))).toContain(`hello from A ${tag}`);
      // And back: B's answer is read through A.
      expect((await memberB.post("/api/v1/school-chat/send", { conversationId: g.body.data.id, body: `reply from B ${tag}` })).status).toBe(200);
      expect(bodies(await msgs(makerB, g.body.data.id))).toContain(`reply from B ${tag}`);
      expect(bodies(await msgs(maker, g.body.data.id))).toContain(`reply from B ${tag}`);
    } finally {
      await makerB.ctx.dispose();
      await memberB.ctx.dispose();
    }
  });

  test("1. a teacher makes a group on the web, says hello, the member sees it unread", async () => {
    const g = await maker.post("/api/v1/school-chat/groups", { title: `Staff room ${tag}`, staffIds: [staffSession(MEMBER).staffId, ct.staffId] });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    groupId = g.body.data.id;
    expect(groupId).toMatch(/^grp:[a-z0-9]+$/);
    expect((await maker.post("/api/v1/school-chat/send", { conversationId: groupId, body: `hello ${tag}` })).status).toBe(200);

    const list = await member.get("/api/v1/school-chat/conversations");
    const row = list.body.data.conversations.find((c) => c.id === groupId);
    expect(row, "the member has the group").toBeTruthy();
    expect(row!.kind).toBe("group");
    expect(row!.title).toBe(`Staff room ${tag}`);
    expect(row!.unread).toBeGreaterThanOrEqual(1);
    expect((await member.get("/api/v1/school-chat/unread")).body.data.unread).toBeGreaterThanOrEqual(1);

    const read = await msgs(member, groupId);
    expect(read.status).toBe(200);
    expect(bodies(read)).toContain(`hello ${tag}`);
    expect((await classTeacher.get("/api/v1/school-chat/conversations")).body.data.conversations.map((c) => c.id), "every member has it").toContain(groupId);
    const after = (await member.get("/api/v1/school-chat/conversations")).body.data.conversations.find((c) => c.id === groupId);
    expect(after!.unread, "reading it clears the count").toBe(0);
  });

  test("2. the staff app's request and the web read each other's messages", async () => {
    const fromApp = `from the staff app ${tag}`;
    const s = await memberApp.post("/api/v1/school-chat/send", { conversationId: groupId, body: fromApp });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(bodies(await msgs(maker, groupId))).toContain(fromApp);
    const fromWeb = `from the web ${tag}`;
    expect((await maker.post("/api/v1/school-chat/send", { conversationId: groupId, body: fromWeb })).status).toBe(200);
    expect(bodies(await msgs(memberApp, groupId))).toContain(fromWeb);
    expect((await memberApp.get("/api/v1/school-chat/conversations")).body.data.conversations.map((c) => c.id)).toContain(groupId);
  });

  test("3. a non-member cannot read or post; a family cannot make a group", async () => {
    expect((await msgs(outsider, groupId)).status).toBe(403);
    expect((await outsider.post("/api/v1/school-chat/send", { conversationId: groupId, body: `let me in ${tag}` })).status).toBe(403);
    expect((await outsider.get("/api/v1/school-chat/conversations")).body.data.conversations.map((c) => c.id)).not.toContain(groupId);
    expect((await msgs(parentA, groupId, famA.id)).status).toBe(403);
    expect((await parentA.post("/api/v1/school-chat/groups", { title: "x", staffIds: [staffSession(MEMBER).staffId] })).status).toBe(403);
    expect((await maker.post("/api/v1/school-chat/groups", { title: "alone", staffIds: [] })).status).toBe(400);
    expect((await maker.post("/api/v1/school-chat/groups", { title: "ghost", staffIds: ["no_such_staff"] })).status).toBe(404);
  });

  test("4. a group with a class section: its families read it, cannot post; others are refused", async () => {
    const section = { classId: classId(1), sectionId: sectionId(1) };
    // A teacher who does not teach Nursery-A cannot add it.
    expect((await outsider.post("/api/v1/school-chat/groups", { title: `Not mine ${tag}`, staffIds: [ct.staffId], section })).status).toBe(403);
    const g = await maker.post("/api/v1/school-chat/groups", { title: `Nursery-A notices ${tag}`, staffIds: [staffSession(MEMBER).staffId], section });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    sectionGroupId = g.body.data.id;
    expect((await maker.post("/api/v1/school-chat/send", { conversationId: sectionGroupId, body: `Sports day on Friday ${tag}` })).status).toBe(200);

    const famList = await parentA.get(`/api/v1/school-chat/conversations?studentId=${famA.id}`);
    expect(famList.body.data.conversations.map((c) => c.id)).toContain(sectionGroupId);
    const famRead = await msgs(parentA, sectionGroupId, famA.id);
    expect(famRead.status).toBe(200);
    expect(bodies(famRead)).toContain(`Sports day on Friday ${tag}`);
    expect(famRead.body.data.conversation.canSend).toBe(false);
    expect(famRead.body.data.conversation.readOnly).toBe(true);
    expect((await parentA.post("/api/v1/school-chat/send", { conversationId: sectionGroupId, studentId: famA.id, body: `ok ${tag}` })).status).toBe(403);

    expect((await parentB.get(`/api/v1/school-chat/conversations?studentId=${famB.id}`)).body.data.conversations.map((c) => c.id)).not.toContain(sectionGroupId);
    expect((await msgs(parentB, sectionGroupId, famB.id)).status).toBe(403);
  });

  test("5. moderation and blocks apply in groups", async () => {
    const abuse = `abe chutiye ${tag}`;
    const h = await member.post("/api/v1/school-chat/send", { conversationId: groupId, body: abuse });
    expect(h.status).toBe(200);
    expect(h.body.data.held, "a staff member's abusive message is held too").toBe(true);
    expect(bodies(await msgs(maker, groupId))).not.toContain(abuse);
    const queue = await principal.get("/api/v1/school-chat/moderation/queue");
    expect((queue.body.data as unknown as { items: { body: string }[] }).items.map((i) => i.body)).toContain(abuse);

    const mute = await principal.post("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: "staff", subjectId: staffSession(MEMBER).staffId, mode: "mute", conversationId: groupId, reason: `e2e mute ${tag}` });
    expect(mute.status, JSON.stringify(mute.body)).toBe(200);
    expect((await member.post("/api/v1/school-chat/send", { conversationId: groupId, body: `muted? ${tag}` })).status).toBe(403);
    expect((await msgs(member, groupId)).status, "muted = may still read").toBe(200);
    const lift = await principal.post("/api/v1/school-chat/moderation/blocks", { op: "lift", id: mute.body.data.id, reason: "e2e lift" });
    expect(lift.status).toBe(200);
    expect((await member.post("/api/v1/school-chat/send", { conversationId: groupId, body: `back again ${tag}` })).status).toBe(200);
  });

  test("5b. an owner's login with no staff row (the director's) can make a group and talk; an unlinked teacher cannot", async () => {
    const owner = await api({ persona: "staff", fullName: "E2E Director Nostaffrow", email: "director@e2e.invalid", roleCode: "principal", tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT });
    const unlinked = await api({ persona: "staff", fullName: "E2E Nobody Unlinked", email: "nobody@e2e.invalid", roleCode: "teacher", tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT });
    try {
      const g = await owner.post("/api/v1/school-chat/groups", { title: `Director's group ${tag}`, staffIds: [staffSession(MEMBER).staffId] });
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      expect((await owner.post("/api/v1/school-chat/send", { conversationId: g.body.data.id, body: `hello from the director ${tag}` })).status).toBe(200);
      const read = await msgs(member, g.body.data.id);
      expect(bodies(read)).toContain(`hello from the director ${tag}`);
      expect(read.body.data.messages.find((m) => m.body === `hello from the director ${tag}`)?.senderLabel).toContain("E2E Director Nostaffrow");
      expect((await member.post("/api/v1/school-chat/send", { conversationId: g.body.data.id, body: `reply to the director ${tag}` })).status).toBe(200);
      expect(bodies(await msgs(owner, g.body.data.id))).toContain(`reply to the director ${tag}`);
      expect((await owner.get("/api/v1/school-chat/conversations")).body.data.conversations.map((c) => c.id)).toContain(g.body.data.id);
      expect((await unlinked.get("/api/v1/school-chat/conversations")).status).toBe(403);
    } finally {
      await owner.ctx.dispose();
      await unlinked.ctx.dispose();
    }
  });

  test("6. the old in-memory chat store is gone", async () => {
    const r = await maker.ctx.get("/api/chat");
    expect(r.status()).toBe(404);
  });

  test("7. seen: the header chat button, its unread badge and the drawer; the parent portal's button", async ({ browser }, testInfo) => {
    for (const v of [
      { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, isMobile: false },
      { name: "phone375-dark", viewport: { width: 375, height: 812 }, colorScheme: "dark" as const, isMobile: true },
    ]) {
      // Something unread for the class teacher (each pass reads it).
      {
        const m = await api(staffSession(MEMBER));
        expect((await m.post("/api/v1/school-chat/send", { conversationId: groupId, body: `unread for you on ${v.name} ${tag}` })).status).toBe(200);
        await m.ctx.dispose();
      }
      const context = await browser.newContext({ baseURL: APP_URL, viewport: v.viewport, colorScheme: v.colorScheme, isMobile: v.isMobile, hasTouch: v.isMobile });
      try {
        await signIn(context, "teacher");
        const page = await context.newPage();
        await page.goto("/home");
        const button = page.getByTestId("header-chat-button");
        await expect(button).toBeVisible({ timeout: 60_000 });
        await expect(button.getByTestId("chat-unread-badge")).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: testInfo.outputPath(`header-chat-button-${v.name}.png`) });
        await testInfo.attach(`header-button-${v.name}`, { path: testInfo.outputPath(`header-chat-button-${v.name}.png`), contentType: "image/png" });
        await button.click();
        const drawer = page.getByTestId("header-chat-drawer");
        await expect(drawer).toBeVisible();
        // The whole height of the screen, not the header's strip.
        const box = await drawer.boundingBox();
        expect(box!.height, "the drawer fills the screen's height").toBeGreaterThanOrEqual(v.viewport.height * 0.9);
        await drawer.getByText(`Staff room ${tag}`).click();
        const thread = drawer.getByTestId("school-chat-thread");
        await expect(thread.getByText(`unread for you on ${v.name} ${tag}`)).toBeVisible({ timeout: 15_000 });
        await thread.getByLabel("Message").fill(`seen on ${v.name} ${tag}`);
        await thread.getByRole("button", { name: "Send" }).click();
        await expect(thread.locator('[data-status="visible"]', { hasText: `seen on ${v.name} ${tag}` })).toBeVisible({ timeout: 15_000 });
        expect(bodies(await msgs(member, groupId))).toContain(`seen on ${v.name} ${tag}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`header-chat-drawer-${v.name}.png`) });
        await testInfo.attach(`drawer-${v.name}`, { path: testInfo.outputPath(`header-chat-drawer-${v.name}.png`), contentType: "image/png" });
        // The new-group form.
        await drawer.getByRole("button", { name: "Back" }).click();
        await drawer.getByTestId("school-chat-new-group").click();
        await expect(drawer.getByTestId("school-chat-group-maker")).toBeVisible();
        await expect(drawer.getByLabel("Class section")).toBeVisible({ timeout: 15_000 });
        await page.screenshot({ path: testInfo.outputPath(`header-chat-new-group-${v.name}.png`) });
        await testInfo.attach(`new-group-${v.name}`, { path: testInfo.outputPath(`header-chat-new-group-${v.name}.png`), contentType: "image/png" });
      } finally {
        await context.close();
      }
    }

    // An owner's login with no staff row (the director's) has the button too.
    {
      const ownerSession: DemoSession = { persona: "staff", fullName: "E2E Director Nostaffrow", email: "director@e2e.invalid", roleCode: "principal", tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT };
      const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1280, height: 800 }, colorScheme: "light" });
      try {
        await context.addCookies([{ name: "bhb_demo_session", value: sessionCookieHeader(ownerSession).split("=").slice(1).join("="), url: APP_URL }]);
        const page = await context.newPage();
        await page.goto("/home");
        const button = page.getByTestId("header-chat-button");
        await expect(button).toBeVisible({ timeout: 60_000 });
        await button.click();
        await expect(page.getByTestId("header-chat-drawer").getByText(`Director's group ${tag}`)).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: testInfo.outputPath("header-chat-owner-desktop-light.png") });
        await testInfo.attach("owner-desktop-light", { path: testInfo.outputPath("header-chat-owner-desktop-light.png"), contentType: "image/png" });
      } finally {
        await context.close();
      }
    }

    // The parent portal: the section group's message is unread for the family.
    const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 375, height: 812 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    try {
      await context.addCookies([{ name: "bhb_demo_session", value: sessionCookieHeader(parentSession(famA.householdId)).split("=").slice(1).join("="), url: APP_URL }]);
      // A fresh request context: the long browser stretch above outlives the
      // server's keep-alive, and a reused socket can be reset (ECONNRESET).
      const fresh = await api(staffSession(MAKER));
      expect((await fresh.post("/api/v1/school-chat/send", { conversationId: sectionGroupId, body: `For parents ${tag}` })).status).toBe(200);
      await fresh.ctx.dispose();
      const page = await context.newPage();
      await page.goto("/parent");
      const button = page.getByTestId("parent-chat-button").first();
      await expect(button).toBeVisible({ timeout: 60_000 });
      await expect(button.getByTestId("chat-unread-badge")).toBeVisible({ timeout: 30_000 });
      await button.click();
      const drawer = page.getByTestId("parent-chat");
      await expect(drawer).toBeVisible();
      expect((await drawer.boundingBox())!.height, "the drawer fills the screen's height").toBeGreaterThanOrEqual(812 * 0.9);
      await drawer.getByText(`Nursery-A notices ${tag}`).click();
      await expect(drawer.getByTestId("school-chat-thread").getByText(`For parents ${tag}`)).toBeVisible({ timeout: 15_000 });
      await expect(drawer.getByLabel("Message")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("parent-chat-phone375-dark.png") });
      await testInfo.attach("parent-phone375-dark", { path: testInfo.outputPath("parent-chat-phone375-dark.png"), contentType: "image/png" });
    } finally {
      await context.close();
    }
  });
});
