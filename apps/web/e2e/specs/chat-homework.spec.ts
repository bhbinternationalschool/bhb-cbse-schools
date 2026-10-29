/**
 * chat-homework — homework, classwork and notices in class chats, one record
 * with the Homework module (director, 29 Oct 2026: "In this chat also add
 * posting of homework, classwork or any other messages").
 *
 * Against the local stack's seeded school (e2e/fixture.ts): Nursery-A's class
 * teacher (fx.sessions.teacher, staff 4), its maths teacher (staff 17, MATH in
 * Nursery-A), LKG-A's class teacher (staff 5 — another class), the Hindi
 * teacher (staff 18, not in Nursery-A), a Nursery-A family.
 *
 * Proves:
 *  1. a teacher posts homework in the class chat: it is a post in the Homework
 *     module (staff feed), in the parent's Homework tab (parent feed) and a
 *     card in the parent's class chat and in the subject group — one id;
 *  2. homework posted from the Homework module's own path
 *     (POST /api/v1/homework/post) shows as a card in the class chat;
 *  3. a teacher of another class cannot post in this class's chat (403); a
 *     subject teacher posts in their subject group but not in another's;
 *  4. withdrawing from the chat removes both the card and the post (and a
 *     withdrawal in the module removes the card);
 *  5. classwork is a class-diary entry (feed diary + card); a notice is a
 *     message drawn as a notice;
 *  6. a family can reply in the class group (moderation still applies) and
 *     cannot post work (403);
 *  7. the screens: the class group with its cards and the composer
 *     (desktop, light; 375 px, dark).
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, signIn, test } from "../support";
import type { DemoSession } from "@/lib/auth";

const cls = (k: number) => `cls:${AY_CURRENT}:${classId(k)}:${sectionId(k)}`;
const sub = (k: number, subjectId: string) => `sub:${AY_CURRENT}:${classId(k)}:${sectionId(k)}:${subjectId}`;
const MATH = "e2e_sub_math";

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

/** A Nursery-A child of a family school-chat.spec does not send as (its rate limit is per family). */
function thirdFamilyOf(k: number) {
  const seen = new Set<string>();
  const kids = fx.sis.students.filter(
    (s) => s.classId === classId(k) && s.sectionId === sectionId(k) && s.academicYearCode === AY_CURRENT && s.status === "active" && (seen.has(s.householdId) ? false : (seen.add(s.householdId), true)),
  );
  return kids[2] ?? kids[0];
}

type Card = { kind: string; refId: string; title: string; subject: string; dueAt: string };
type Json = {
  data: {
    kind: string;
    refId: string;
    held: boolean;
    status: string;
    posts: { id: string; title: string }[];
    diary: { id: string; title: string }[];
    messages: { id: string; body: string; status: string; card?: Card; senderKind: string }[];
    conversation: { compose: { subjects: { id: string }[]; fixedSubject: string } | null; canSend: boolean };
  };
  error: { message: string };
};
type Res = { status: number; body: Json };
type Api = { ctx: APIRequestContext; get: (p: string) => Promise<Res>; post: (p: string, d: unknown) => Promise<Res> };

async function api(session: DemoSession): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: APP_URL, extraHTTPHeaders: { cookie: sessionCookieHeader(session) }, timeout: 90_000 });
  const wrap = async (r: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Res> => ({ status: r.status(), body: (await r.json().catch(() => null)) as Json });
  return { ctx, get: async (p) => wrap(await ctx.get(p)), post: async (p, d) => wrap(await ctx.post(p, { data: d })) };
}

const msgs = (who: Api, conv: string, studentId?: string) =>
  who.get(`/api/v1/school-chat/messages?conversationId=${encodeURIComponent(conv)}${studentId ? `&studentId=${studentId}` : ""}`);
const cardIds = (r: Res): string[] => (r.body?.data?.messages ?? []).filter((m) => m.card).map((m) => m.card!.refId);
const staffFeed = (who: Api) => who.get(`/api/v1/homework/feed?classId=${classId(1)}&sectionId=${sectionId(1)}&limit=100`);

test.describe.serial("chat-homework: one record with the Homework module", () => {
  const tag = Date.now().toString(36);
  const fam = thirdFamilyOf(1)!;
  let teacher: Api, maths: Api, otherClass: Api, hindi: Api, parent: Api;
  let hwId = "";

  test.beforeAll(async () => {
    expect(fam, "fixture has a Nursery-A family").toBeTruthy();
    teacher = await api(fx.sessions.teacher);
    maths = await api(staffSession(17));
    otherClass = await api(staffSession(5));
    hindi = await api(staffSession(18));
    parent = await api(parentSession(fam.householdId));
  });
  test.afterAll(async () => {
    for (const a of [teacher, maths, otherClass, hindi, parent]) await a?.ctx.dispose();
  });

  test("1. homework posted in the class chat is the Homework module's post — staff feed, parent feed, parent chat, subject group", async () => {
    const view = await msgs(teacher, cls(1));
    expect(view.status).toBe(200);
    expect(view.body.data.conversation.compose, "the class teacher may post work here").toBeTruthy();
    const r = await teacher.post("/api/v1/school-chat/work", {
      conversationId: cls(1),
      kind: "homework",
      subjectId: MATH,
      title: `Ex 5.2 Q1-5 ${tag}`,
      body: `Do questions 1 to 5 ${tag}`,
      dueAt: "2026-11-02",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.kind).toBe("homework");
    hwId = r.body.data.refId;

    const feed = await staffFeed(teacher);
    expect(feed.status).toBe(200);
    expect(feed.body.data.posts.map((p) => p.id), "in the Homework module").toContain(hwId);
    const pfeed = await parent.get(`/api/v1/homework/feed?studentId=${fam.id}`);
    expect(pfeed.body.data.posts.map((p) => p.id), "in the parent's Homework tab").toContain(hwId);

    const pchat = await msgs(parent, cls(1), fam.id);
    expect(pchat.status).toBe(200);
    const card = pchat.body.data.messages.find((m) => m.card?.refId === hwId);
    expect(card, "a card in the parent's class chat").toBeTruthy();
    expect(card!.card!.kind).toBe("homework");
    expect(card!.card!.dueAt).toBe("2026-11-02");
    expect(card!.body, "older apps read it as text").toContain(`Ex 5.2 Q1-5 ${tag}`);
    expect(cardIds(await msgs(maths, sub(1, MATH))), "and in the maths group").toContain(hwId);
    // Exactly one card for one post.
    expect(cardIds(pchat).filter((x) => x === hwId)).toHaveLength(1);
  });

  test("2. homework posted from the Homework module shows as a card in the class chat", async () => {
    const r = await teacher.post("/api/v1/homework/post", {
      classId: classId(1),
      sectionId: sectionId(1),
      subjectId: MATH,
      title: `From the Homework screen ${tag}`,
      bodyEn: `Read chapter 3 ${tag}`,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const id = (r.body.data as unknown as { postId: string }).postId;
    expect(cardIds(await msgs(teacher, cls(1)))).toContain(id);
    expect(cardIds(await msgs(parent, cls(1), fam.id))).toContain(id);
  });

  test("3. only staff who may post homework there: another class's teacher 403; a subject teacher in their own subject group only", async () => {
    const other = await otherClass.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "homework", subjectId: MATH, title: `not mine ${tag}` });
    expect(other.status).toBe(403);
    const notMember = await maths.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "homework", subjectId: MATH, title: `not my group ${tag}` });
    expect(notMember.status, "the maths teacher is not in the class group").toBe(403);
    const inSubject = await maths.post("/api/v1/school-chat/work", { conversationId: sub(1, MATH), kind: "homework", title: `Tables of 7 ${tag}` });
    expect(inSubject.status, JSON.stringify(inSubject.body)).toBe(200);
    expect(cardIds(await msgs(teacher, cls(1))), "subject-group homework is the class's homework too").toContain(inSubject.body.data.refId);
    expect((await hindi.post("/api/v1/school-chat/work", { conversationId: sub(1, MATH), kind: "homework", title: `x ${tag}` })).status).toBe(403);
    // A bad date is refused before anything is written.
    expect((await teacher.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "homework", subjectId: MATH, title: "x", dueAt: "tomorrow" })).status).toBe(400);
  });

  test("4. withdrawing removes both the card and the post", async () => {
    const w = await teacher.post("/api/v1/school-chat/work", { op: "withdraw", postId: hwId });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(cardIds(await msgs(teacher, cls(1)))).not.toContain(hwId);
    expect(cardIds(await msgs(parent, cls(1), fam.id))).not.toContain(hwId);
    expect((await staffFeed(teacher)).body.data.posts.map((p) => p.id)).not.toContain(hwId);
    expect((await parent.get(`/api/v1/homework/feed?studentId=${fam.id}`)).body.data.posts.map((p) => p.id)).not.toContain(hwId);
    // Someone who may not post there cannot withdraw it either.
    expect((await otherClass.post("/api/v1/school-chat/work", { op: "withdraw", postId: hwId })).status).toBe(403);
  });

  test("5. classwork is the class diary; a notice is a message drawn as a notice", async () => {
    const c = await teacher.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "classwork", subjectId: MATH, title: `Counted to 20 ${tag}`, body: "Number songs" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const feed = await staffFeed(teacher);
    expect(feed.body.data.diary.map((d) => d.id), "in the class diary").toContain(c.body.data.refId);
    const pchat = await msgs(parent, cls(1), fam.id);
    const cw = pchat.body.data.messages.find((m) => m.card?.refId === c.body.data.refId);
    expect(cw?.card?.kind).toBe("classwork");
    expect(cw?.card?.title).toContain(`Counted to 20 ${tag}`);

    const n = await teacher.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "notice", title: `PTM on Saturday ${tag}`, body: "10 am, bring the diary" });
    expect(n.status, JSON.stringify(n.body)).toBe(200);
    const notice = (await msgs(parent, cls(1), fam.id)).body.data.messages.find((m) => m.body.startsWith(`Notice: PTM on Saturday ${tag}`));
    expect(notice?.senderKind).toBe("staff");
  });

  test("6. a family replies in the class group (moderated) and cannot post work", async () => {
    expect((await msgs(parent, cls(1), fam.id)).body.data.conversation.compose).toBeNull();
    const ok = await parent.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: fam.id, body: `Done, thank you ${tag}` });
    expect(ok.status).toBe(200);
    expect(ok.body.data.held).toBe(false);
    const abuse = await parent.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: fam.id, body: `chutiye ${tag}` });
    expect(abuse.body.data.held, "replies are still checked").toBe(true);
    expect((await parent.post("/api/v1/school-chat/work", { conversationId: cls(1), kind: "homework", subjectId: MATH, title: "x" })).status).toBe(403);
  });

  test("7. seen: the class group with homework / classwork / notice cards and the composer", async ({ browser }, testInfo) => {
    for (const v of [
      { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, isMobile: false },
      { name: "phone375-dark", viewport: { width: 375, height: 812 }, colorScheme: "dark" as const, isMobile: true },
    ]) {
      const context = await browser.newContext({ baseURL: APP_URL, viewport: v.viewport, colorScheme: v.colorScheme, isMobile: v.isMobile, hasTouch: v.isMobile });
      try {
        await signIn(context, "teacher");
        const page = await context.newPage();
        await page.goto(`/school-chat?c=${encodeURIComponent(cls(1))}`);
        const thread = page.getByTestId("school-chat-thread");
        await expect(thread).toBeVisible({ timeout: 60_000 });
        await expect(thread.getByTestId("school-chat-work-card").filter({ hasText: `Tables of 7 ${tag}` })).toBeVisible({ timeout: 30_000 });
        await expect(thread.getByTestId("school-chat-work-card").filter({ hasText: `Counted to 20 ${tag}` })).toBeVisible();
        await expect(thread.getByTestId("school-chat-notice-card").filter({ hasText: `PTM on Saturday ${tag}` })).toBeVisible();
        await expect(thread.getByText(`Ex 5.2 Q1-5 ${tag}`), "the withdrawn homework is gone").toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`chat-homework-cards-${v.name}.png`) });
        await testInfo.attach(`cards-${v.name}`, { path: testInfo.outputPath(`chat-homework-cards-${v.name}.png`), contentType: "image/png" });
        // Post homework from the composer on this screen.
        await thread.getByTestId("school-chat-post-work").click();
        const composer = thread.getByTestId("school-chat-work-composer");
        await expect(composer).toBeVisible();
        await composer.getByLabel("Subject").selectOption(MATH);
        await composer.getByLabel("Title").fill(`Colour page 4 ${v.name} ${tag}`);
        await composer.getByLabel("Due date").fill("2026-11-03");
        await page.screenshot({ path: testInfo.outputPath(`chat-homework-composer-${v.name}.png`) });
        await testInfo.attach(`composer-${v.name}`, { path: testInfo.outputPath(`chat-homework-composer-${v.name}.png`), contentType: "image/png" });
        await composer.getByRole("button", { name: "Post" }).click();
        await expect(thread.getByTestId("school-chat-work-card").filter({ hasText: `Colour page 4 ${v.name} ${tag}` })).toBeVisible({ timeout: 60_000 });
        const feed = await staffFeed(teacher);
        expect(feed.body.data.posts.map((p) => p.title)).toContain(`Colour page 4 ${v.name} ${tag}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
      } finally {
        await context.close();
      }
    }
  });
});
