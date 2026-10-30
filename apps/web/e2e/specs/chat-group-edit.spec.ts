/**
 * chat-group-edit — changing a staff-made group (director, 30 Oct 2026):
 * "After making chat groups there is no option to edit the group and remove
 * or add members."
 *
 * POST /api/v1/school-chat/groups {op, conversationId, rev, …}
 * (lib/schoolChat.server manageStaffGroup) and the group's ⋮ menu on the web
 * (components/schoolChat/GroupSettings).
 *
 * Against the local stack's seeded school (e2e/fixture.ts): staff 25 (a
 * subject teacher of Nursery-A — makes the groups), staff 28, 29, 30 (members
 * to add, remove and leave; teach nothing), staff 19 (teaches neither
 * section), staff 35 (has left), the principal (a chat moderator), Nursery-A's
 * class teacher (signed in for the screens) and a Nursery-A family. Its own
 * people where it sends messages: the per-sender limit is shared with the
 * other chat specs.
 *
 * Proves:
 *  1. the maker renames, adds one person and removes one: the added person
 *     has the group and its history at once; the removed one is refused
 *     (403) reading and sending and no longer has it in their list;
 *  2. a member who is not the maker (and not a moderator) is refused (403)
 *     every change; a moderator who is not in the group can change it;
 *  3. leave works; a group keeps at least two staff (400); a maker who has
 *     left can no longer change it (moderators still can) and the members
 *     are told so (manage.creatorLeft);
 *  4. two changes made against the same version: one is saved, the other
 *     answers 409 — and so does a change sent with an old version;
 *  5. the class section: only a teacher of it (403 otherwise); setting it
 *     lets that section's families read the group, clearing it stops them;
 *  6. each change leaves a history line in the group;
 *  7. seen: the ⋮ menu, Members with Add, and Edit name (desktop, light;
 *     375 px, dark), with no sideways scroll.
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, signIn, test } from "../support";
import type { DemoSession } from "@/lib/auth";

const MAKER = 25;
const P28 = 28;
const P29 = 29;
const P30 = 30;
const OUTSIDER = 19;
const LEFT_SCHOOL = 35;

const staffSession = (n: number): DemoSession => {
  const s = fx.staff.staff[n - 1]!;
  return { persona: "staff", fullName: s.fullName, roleCode: "teacher", staffId: s.id, tenantSlug: fx.sessions.office.tenantSlug, academicYearCode: AY_CURRENT };
};
const sid = (n: number) => fx.staff.staff[n - 1]!.id;
const parentSession = (householdId: string): DemoSession => ({
  persona: "parent",
  fullName: "E2E Parent",
  roleCode: "parent",
  householdId,
  tenantSlug: fx.sessions.office.tenantSlug,
  academicYearCode: AY_CURRENT,
});

type Manage = { rev: string; members: { id: string; name: string }[]; canManage: boolean; canLeave: boolean; creatorLeft: boolean; creatorName: string; sectionLabel: string };
type Json = {
  data: {
    id: string;
    title: string;
    rev: string;
    staffIds: string[];
    left: boolean;
    conversations: { id: string; title: string }[];
    messages: { body: string; system?: boolean }[];
    conversation: { title: string; manage: Manage | null; canSend: boolean };
  };
  error: { message: string };
};
type Res = { status: number; body: Json };
type Api = { ctx: APIRequestContext; get: (p: string) => Promise<Res>; post: (p: string, d: unknown) => Promise<Res> };

async function api(session: DemoSession): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: APP_URL, extraHTTPHeaders: { cookie: sessionCookieHeader(session) } });
  const wrap = async (r: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Res> => ({ status: r.status(), body: (await r.json().catch(() => null)) as Json });
  return { ctx, get: async (p) => wrap(await ctx.get(p)), post: async (p, d) => wrap(await ctx.post(p, { data: d })) };
}

const msgs = (who: Api, conv: string, studentId?: string) =>
  who.get(`/api/v1/school-chat/messages?conversationId=${encodeURIComponent(conv)}${studentId ? `&studentId=${studentId}` : ""}`);
const listIds = async (who: Api, studentId?: string) =>
  ((await who.get(`/api/v1/school-chat/conversations${studentId ? `?studentId=${studentId}` : ""}`)).body?.data?.conversations ?? []).map((c) => c.id);
/** The version of the group this person reads now. */
async function revOf(who: Api, conv: string): Promise<string> {
  const r = await msgs(who, conv);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const m = r.body.data.conversation.manage;
  expect(m, "a staff-made group carries conversation.manage").toBeTruthy();
  return m!.rev;
}
const change = (who: Api, conversationId: string, rev: string, c: Record<string, unknown>) => who.post("/api/v1/school-chat/groups", { conversationId, rev, ...c });

test.describe.serial("chat-group-edit: rename, members, section, leave", () => {
  const tag = Date.now().toString(36);
  const famA = fx.sis.students.find((s) => s.classId === classId(1) && s.sectionId === sectionId(1) && s.academicYearCode === AY_CURRENT && s.status === "active")!;
  let maker: Api, p28: Api, p29: Api, p30: Api, outsider: Api, principal: Api, parentA: Api;
  let groupId = "";

  test.beforeAll(async () => {
    expect(famA, "fixture has a Nursery-A child").toBeTruthy();
    [maker, p28, p29, p30, outsider, principal, parentA] = await Promise.all([
      api(staffSession(MAKER)),
      api(staffSession(P28)),
      api(staffSession(P29)),
      api(staffSession(P30)),
      api(staffSession(OUTSIDER)),
      api(fx.sessions.principal),
      api(parentSession(famA.householdId)),
    ]);
  });
  test.afterAll(async () => {
    for (const a of [maker, p28, p29, p30, outsider, principal, parentA]) await a?.ctx.dispose();
  });

  test("1. the maker renames, adds one and removes one; access follows at once", async () => {
    const g = await maker.post("/api/v1/school-chat/groups", { title: `Annual day ${tag}`, staffIds: [sid(P28), sid(P29)] });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    groupId = g.body.data.id;
    expect((await p29.post("/api/v1/school-chat/send", { conversationId: groupId, body: `history before ${tag}` })).status).toBe(200);

    const read = await msgs(maker, groupId);
    const m = read.body.data.conversation.manage!;
    expect(m.canManage, "the maker may change it").toBe(true);
    expect(m.members.map((x) => x.id).sort()).toEqual([sid(MAKER), sid(P28), sid(P29)].sort());

    const ren = await change(maker, groupId, m.rev, { op: "rename", title: `Annual day committee ${tag}` });
    expect(ren.status, JSON.stringify(ren.body)).toBe(200);
    expect(ren.body.data.title).toBe(`Annual day committee ${tag}`);
    expect((await p28.get("/api/v1/school-chat/conversations")).body.data.conversations.find((c) => c.id === groupId)?.title, "members see the new name").toBe(`Annual day committee ${tag}`);

    // Added: has it, its history, and may post — at once.
    expect(await listIds(p30), "not in it yet").not.toContain(groupId);
    expect((await msgs(p30, groupId)).status).toBe(403);
    const add = await change(maker, groupId, ren.body.data.rev, { op: "addStaff", staffIds: [sid(P30)] });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(await listIds(p30)).toContain(groupId);
    const p30read = await msgs(p30, groupId);
    expect(p30read.status).toBe(200);
    expect(p30read.body.data.messages.map((x) => x.body), "the added person sees the history").toContain(`history before ${tag}`);
    expect((await p30.post("/api/v1/school-chat/send", { conversationId: groupId, body: `hello, I am in ${tag}` })).status).toBe(200);

    // Removed: refused reading and sending, gone from the list — at once.
    expect((await msgs(p29, groupId)).status).toBe(200);
    const rem = await change(maker, groupId, add.body.data.rev, { op: "removeStaff", staffIds: [sid(P29)] });
    expect(rem.status, JSON.stringify(rem.body)).toBe(200);
    expect((await msgs(p29, groupId)).status, "removed: read refused").toBe(403);
    expect((await p29.post("/api/v1/school-chat/send", { conversationId: groupId, body: `still here? ${tag}` })).status, "removed: send refused").toBe(403);
    expect(await listIds(p29), "removed: gone from the list").not.toContain(groupId);
    expect(rem.body.data.staffIds.sort()).toEqual([sid(MAKER), sid(P28), sid(P30)].sort());
    // Someone who has left the school cannot be added.
    expect((await change(maker, groupId, rem.body.data.rev, { op: "addStaff", staffIds: [sid(LEFT_SCHOOL)] })).status).toBe(404);
  });

  test("2. a member who is not the maker is refused; a moderator outside the group may change it", async () => {
    const m = (await msgs(p28, groupId)).body.data.conversation.manage!;
    expect(m.canManage, "a plain member may not change it").toBe(false);
    expect(m.canLeave).toBe(true);
    for (const c of [
      { op: "rename", title: `hijack ${tag}` },
      { op: "addStaff", staffIds: [sid(P29)] },
      { op: "removeStaff", staffIds: [sid(MAKER)] },
      { op: "setSection", section: { classId: classId(1), sectionId: sectionId(1) } },
      { op: "clearSection" },
    ]) {
      expect((await change(p28, groupId, m.rev, c)).status, `member ${c.op}`).toBe(403);
    }
    // Not a member at all: refused too.
    expect((await change(outsider, groupId, m.rev, { op: "rename", title: `outsider ${tag}` })).status).toBe(403);
    expect((await change(outsider, groupId, m.rev, { op: "leave" })).status).toBe(400);
    // A family can change nothing.
    expect((await parentA.post("/api/v1/school-chat/groups", { op: "rename", conversationId: groupId, rev: m.rev, title: "x" })).status).toBe(403);

    // The principal (a chat moderator, not in the group).
    expect(await listIds(principal)).not.toContain(groupId);
    const pm = (await msgs(principal, groupId)).body.data.conversation.manage!;
    expect(pm.canManage, "a moderator may change any group").toBe(true);
    expect(pm.canLeave, "not in it — nothing to leave").toBe(false);
    const ren = await change(principal, groupId, pm.rev, { op: "rename", title: `Annual day (office) ${tag}` });
    expect(ren.status, JSON.stringify(ren.body)).toBe(200);
    expect((await msgs(maker, groupId)).body.data.conversation.title).toBe(`Annual day (office) ${tag}`);
  });

  test("3. leave; at least two staff; a maker who left can no longer change it", async () => {
    // Two staff: neither can leave, the last other cannot be removed.
    const pair = await maker.post("/api/v1/school-chat/groups", { title: `Pair ${tag}`, staffIds: [sid(P28)] });
    expect(pair.status).toBe(200);
    const prev = await revOf(maker, pair.body.data.id);
    const leaveTwo = await change(p28, pair.body.data.id, prev, { op: "leave" });
    expect(leaveTwo.status).toBe(400);
    expect(leaveTwo.body.error.message).toMatch(/at least two staff/i);
    expect((await change(maker, pair.body.data.id, prev, { op: "removeStaff", staffIds: [sid(P28)] })).status).toBe(400);
    expect((await change(maker, pair.body.data.id, prev, { op: "leave" })).status).toBe(400);
    expect(await listIds(p28), "still in it").toContain(pair.body.data.id);

    // Three staff: a member leaves.
    const rev1 = await revOf(p30, groupId);
    const left = await change(p30, groupId, rev1, { op: "leave" });
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect(left.body.data.left).toBe(true);
    expect((await msgs(p30, groupId)).status, "left: read refused").toBe(403);
    expect(await listIds(p30)).not.toContain(groupId);

    // Add one back, then the maker leaves: changes are the moderators' now.
    const back = await change(maker, groupId, await revOf(maker, groupId), { op: "addStaff", staffIds: [sid(P30)] });
    expect(back.status).toBe(200);
    const makerLeft = await change(maker, groupId, back.body.data.rev, { op: "leave" });
    expect(makerLeft.status, JSON.stringify(makerLeft.body)).toBe(200);
    expect((await msgs(maker, groupId)).status).toBe(403);
    const m = (await msgs(p28, groupId)).body.data.conversation.manage!;
    expect(m.creatorLeft, "members are told the maker has left").toBe(true);
    expect(m.canManage).toBe(false);
    expect((await change(maker, groupId, m.rev, { op: "addStaff", staffIds: [sid(MAKER)] })).status, "the maker cannot rejoin themselves").toBe(403);
    const mod = await change(principal, groupId, m.rev, { op: "addStaff", staffIds: [sid(P29)] });
    expect(mod.status, "a moderator still can").toBe(200);
  });

  test("4. two changes against the same version: one saved, the other 409", async () => {
    const g = await maker.post("/api/v1/school-chat/groups", { title: `Race ${tag}`, staffIds: [sid(P28), sid(P30)] });
    expect(g.status).toBe(200);
    const id = g.body.data.id;
    const rev = await revOf(maker, id);
    // At the same moment: the maker renames, the principal adds someone.
    const [a, b] = await Promise.all([
      change(maker, id, rev, { op: "rename", title: `Race (maker) ${tag}` }),
      change(principal, id, rev, { op: "addStaff", staffIds: [sid(P29)] }),
    ]);
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([200, 409]);
    const lost = a.status === 409 ? a : b;
    expect(lost.body.error.message).toMatch(/changed by someone else/i);
    // The saved one is there; the refused one is not.
    const after = (await msgs(maker, id)).body.data;
    if (a.status === 200) {
      expect(after.conversation.title).toBe(`Race (maker) ${tag}`);
      expect(after.conversation.manage!.members.map((x) => x.id)).not.toContain(sid(P29));
    } else {
      expect(after.conversation.title).toBe(`Race ${tag}`);
      expect(after.conversation.manage!.members.map((x) => x.id)).toContain(sid(P29));
    }
    // A change sent with the version from before: 409, nothing changed.
    const stale = await change(maker, id, rev, { op: "removeStaff", staffIds: [sid(P28)] });
    expect(stale.status).toBe(409);
    expect((await msgs(p28, id)).status, "still a member").toBe(200);
    // And without one: refused (400), so no client can skip the check.
    expect((await maker.post("/api/v1/school-chat/groups", { op: "rename", conversationId: id, title: "no rev" })).status).toBe(400);
  });

  test("5. the class section: only a teacher of it; its families read, then stop", async () => {
    const section = { classId: classId(1), sectionId: sectionId(1) };
    // Staff 19 made this group but does not teach Nursery-A.
    const og = await outsider.post("/api/v1/school-chat/groups", { title: `Not my class ${tag}`, staffIds: [sid(P28)] });
    expect(og.status).toBe(200);
    const orev = await revOf(outsider, og.body.data.id);
    expect((await change(outsider, og.body.data.id, orev, { op: "setSection", section })).status, "not a teacher of it").toBe(403);

    const g = await maker.post("/api/v1/school-chat/groups", { title: `Nursery-A helpers ${tag}`, staffIds: [sid(P28)] });
    const id = g.body.data.id;
    expect((await maker.post("/api/v1/school-chat/send", { conversationId: id, body: `Bring a water bottle ${tag}` })).status).toBe(200);
    expect((await msgs(parentA, id, famA.id)).status, "staff only: the family is refused").toBe(403);
    const set = await change(maker, id, await revOf(maker, id), { op: "setSection", section });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(await listIds(parentA, famA.id)).toContain(id);
    const fam = await msgs(parentA, id, famA.id);
    expect(fam.status).toBe(200);
    expect(fam.body.data.messages.map((x) => x.body)).toContain(`Bring a water bottle ${tag}`);
    expect(fam.body.data.conversation.canSend, "families read, never post").toBe(false);
    expect(fam.body.data.conversation.manage, "a family is shown no settings").toBeNull();
    // A section the maker does not teach (LKG-A): refused.
    expect((await change(maker, id, set.body.data.rev, { op: "setSection", section: { classId: classId(2), sectionId: sectionId(2) } })).status).toBe(403);
    const clear = await change(maker, id, set.body.data.rev, { op: "clearSection" });
    expect(clear.status).toBe(200);
    expect((await msgs(parentA, id, famA.id)).status, "staff only again").toBe(403);
    expect(await listIds(parentA, famA.id)).not.toContain(id);
  });

  test("6. every change leaves a history line in the group", async () => {
    const notes = (await msgs(principal, groupId)).body.data.messages.filter((m) => m.system).map((m) => m.body);
    const maker = fx.staff.staff[MAKER - 1]!.fullName;
    expect(notes).toEqual(
      expect.arrayContaining([
        `${maker} renamed the group to "Annual day committee ${tag}"`,
        `${maker} added ${fx.staff.staff[P30 - 1]!.fullName}`,
        `${maker} removed ${fx.staff.staff[P29 - 1]!.fullName}`,
        `${fx.staff.staff[P30 - 1]!.fullName} left`,
        `${maker} left`,
      ]),
    );
    expect(notes.some((n) => n.endsWith(`renamed the group to "Annual day (office) ${tag}"`))).toBe(true);
    // History lines are nobody's message: they do not count as unread.
    await msgs(p28, groupId); // read up to now
    const pm = (await msgs(principal, groupId)).body.data.conversation.manage!;
    expect((await change(principal, groupId, pm.rev, { op: "rename", title: `Annual day (final) ${tag}` })).status).toBe(200);
    const list = (await p28.get("/api/v1/school-chat/conversations")).body.data.conversations as unknown as { id: string; unread: number; lastMessage: string | null }[];
    const row = list.find((c) => c.id === groupId)!;
    expect(row.lastMessage, "the list shows the history line").toContain(`renamed the group to "Annual day (final) ${tag}"`);
    expect(row.unread, "a history line is not unread").toBe(0);
  });

  test("7. seen: the group menu, Members with Add, Edit name", async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const ct = fx.sessions.teacher;
    for (const v of [
      { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, isMobile: false },
      { name: "phone375-dark", viewport: { width: 375, height: 812 }, colorScheme: "dark" as const, isMobile: true },
    ]) {
      const mk = await api(ct);
      const g = await mk.post("/api/v1/school-chat/groups", { title: `Sports day ${v.name} ${tag}`, staffIds: [sid(P28), sid(P29)] });
      expect(g.status).toBe(200);
      await mk.ctx.dispose();
      const context = await browser.newContext({ baseURL: APP_URL, viewport: v.viewport, colorScheme: v.colorScheme, isMobile: v.isMobile, hasTouch: v.isMobile });
      try {
        await signIn(context, "teacher");
        const page = await context.newPage();
        page.on("dialog", (d) => void d.accept());
        await page.goto("/home");
        const button = page.getByTestId("header-chat-button");
        await expect(button).toBeVisible({ timeout: 60_000 });
        await button.click();
        const drawer = page.getByTestId("header-chat-drawer");
        await drawer.getByText(`Sports day ${v.name} ${tag}`).click();
        const thread = drawer.getByTestId("school-chat-thread");
        await thread.getByTestId("school-chat-group-menu").click();
        await expect(thread.getByRole("menuitem", { name: "Edit name" })).toBeVisible();
        await expect(thread.getByRole("menuitem", { name: "Leave group" })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`group-menu-${v.name}.png`) });
        await testInfo.attach(`group-menu-${v.name}`, { path: testInfo.outputPath(`group-menu-${v.name}.png`), contentType: "image/png" });

        // Members → Add staff → pick 30 → Add.
        await thread.getByRole("menuitem", { name: /Members/ }).click();
        const settings = thread.getByTestId("school-chat-group-settings");
        await expect(settings.getByTestId("school-chat-members").getByText(fx.staff.staff[P28 - 1]!.fullName)).toBeVisible();
        await settings.getByTestId("school-chat-add-member").click();
        const p30name = fx.staff.staff[P30 - 1]!.fullName;
        await settings.getByLabel("Search staff").fill(p30name);
        await settings.getByTestId("school-chat-add-members").getByText(p30name, { exact: true }).click();
        await page.screenshot({ path: testInfo.outputPath(`group-add-${v.name}.png`) });
        await testInfo.attach(`group-add-${v.name}`, { path: testInfo.outputPath(`group-add-${v.name}.png`), contentType: "image/png" });
        await settings.getByRole("button", { name: "Add 1" }).click();
        await expect(settings.getByTestId("school-chat-members").getByText(p30name)).toBeVisible({ timeout: 15_000 });
        expect(await listIds(p30)).toContain(g.body.data.id);
        let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`group-members-${v.name}.png`) });
        await testInfo.attach(`group-members-${v.name}`, { path: testInfo.outputPath(`group-members-${v.name}.png`), contentType: "image/png" });

        // Remove 29.
        await settings.getByRole("button", { name: `Remove ${fx.staff.staff[P29 - 1]!.fullName}` }).click();
        await expect(settings.getByTestId("school-chat-members").getByText(fx.staff.staff[P29 - 1]!.fullName)).toHaveCount(0, { timeout: 15_000 });
        expect((await msgs(p29, g.body.data.id)).status).toBe(403);

        // Edit name.
        await settings.getByRole("button", { name: "Name" }).click();
        await settings.getByLabel("Group name").fill(`Sports day crew ${v.name} ${tag}`);
        await page.screenshot({ path: testInfo.outputPath(`group-name-${v.name}.png`) });
        await testInfo.attach(`group-name-${v.name}`, { path: testInfo.outputPath(`group-name-${v.name}.png`), contentType: "image/png" });
        await settings.getByRole("button", { name: "Save name" }).click();
        await expect(thread.getByTestId("school-chat-thread-title")).toHaveText(`Sports day crew ${v.name} ${tag}`, { timeout: 15_000 });

        // Back to the messages: the history lines.
        await thread.getByTestId("school-chat-group-settings").getByRole("button", { name: "Done" }).click();
        await expect(thread.getByTestId("school-chat-group-note").filter({ hasText: `renamed the group to "Sports day crew ${v.name} ${tag}"` })).toBeVisible({ timeout: 15_000 });
        overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`group-history-${v.name}.png`) });
        await testInfo.attach(`group-history-${v.name}`, { path: testInfo.outputPath(`group-history-${v.name}.png`), contentType: "image/png" });

        // A group whose maker has left: a member is told only moderators can change it.
        const orphan = await maker.post("/api/v1/school-chat/groups", { title: `Maker left ${v.name} ${tag}`, staffIds: [ct.staffId!, sid(P28)] });
        expect(orphan.status).toBe(200);
        expect((await change(maker, orphan.body.data.id, await revOf(maker, orphan.body.data.id), { op: "leave" })).status).toBe(200);
        await thread.getByRole("button", { name: "Back" }).click();
        await drawer.getByText(`Maker left ${v.name} ${tag}`).click();
        await thread.getByTestId("school-chat-group-menu").click();
        await expect(thread.getByRole("menuitem", { name: "Edit name" }), "not the maker: no Edit name").toHaveCount(0);
        await thread.getByRole("menuitem", { name: /Members/ }).click();
        await expect(thread.getByTestId("school-chat-creator-left")).toContainText("only a chat moderator can change it now");
        await expect(thread.getByRole("button", { name: /^Remove / })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`group-maker-left-${v.name}.png`) });
        await testInfo.attach(`group-maker-left-${v.name}`, { path: testInfo.outputPath(`group-maker-left-${v.name}.png`), contentType: "image/png" });
      } finally {
        await context.close();
      }
    }
  });
});
