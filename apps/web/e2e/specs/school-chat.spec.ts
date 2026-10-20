/**
 * school-chat — groups with teachers, hold-then-review, mute/block (director, 15 Oct 2026).
 *
 * Against the local stack's seeded school (e2e/fixture.ts): Nursery-A's class
 * teacher (staff 4) and its maths teacher (staff 17), the principal (the
 * moderator: Discipline · approve), two families with a child in Nursery-A and
 * one with a child in LKG-A. The model's part of the check is the stack's stub
 * (SCHOOL_CHAT_AI_STUB=markers: "[[ai-down]]" = the model failed); the word
 * rules run exactly as in production.
 *
 * Proves:
 *  1. a child's abusive message is HELD — invisible to classmates and to the
 *     class teacher — until a moderator approves it;
 *  2. a clean message in the maths group reaches classmates and the maths
 *     teacher only: the class teacher (not maths), another class's family
 *     and another subject's teacher are refused (403);
 *  3. a child can never open a direct chat with another child (403), nor a
 *     family with another family; a family ↔ class teacher chat works;
 *  4. a muted child's sends are refused; a blocked family cannot read;
 *     lifting it restores them;
 *  5. when the AI check fails, the message is held, not passed;
 *  5b. a teacher's abusive message is HELD like a child's (no staff
 *     exception); with the AI down a teacher's message is posted but flagged
 *     into the review queue (review of #679, item 2);
 *  4b. a sender over 10 messages a minute is refused with 429 (item 4);
 *  6. the screens: the review queue (desktop, light) and a class group on a
 *     375 px phone in dark mode.
 */
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { AY_CURRENT, classId, sectionId, staffId } from "../fixture";
import { sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, openAs, test } from "../support";
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

/** Active current-year children of section k, one per household. */
function childrenOf(k: number) {
  const seen = new Set<string>();
  return fx.sis.students.filter(
    (s) =>
      s.classId === classId(k) &&
      s.sectionId === sectionId(k) &&
      s.academicYearCode === AY_CURRENT &&
      s.status === "active" &&
      (seen.has(s.householdId) ? false : (seen.add(s.householdId), true)),
  );
}

/** The parts of the routes' answers these tests read (every route answers {ok, data} or {ok:false, error}). */
type ChatMsg = { id: string; body: string; status: string; senderLabel: string };
type ChatJson = {
  data: {
    id: string;
    held: boolean;
    notice: string | null;
    blocked: boolean;
    conversations: { id: string }[];
    messages: ChatMsg[];
    items: { id: string; body: string; checkedBy: string; categories: string[]; flaggedStaff: boolean; status: string }[];
  };
  error: { message: string };
};
type Res = { status: number; body: ChatJson };
type Api = { ctx: APIRequestContext; get: (p: string) => Promise<Res>; post: (p: string, d: unknown) => Promise<Res> };

async function api(session: DemoSession): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: APP_URL, extraHTTPHeaders: { cookie: sessionCookieHeader(session) } });
  const wrap = async (r: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Res> => ({ status: r.status(), body: (await r.json().catch(() => null)) as ChatJson });
  return {
    ctx,
    get: async (p) => wrap(await ctx.get(p)),
    post: async (p, d) => wrap(await ctx.post(p, { data: d })),
  };
}

const [a1, a2] = childrenOf(1);
const [b1] = childrenOf(2);
const msgs = (who: Api, conv: string, studentId?: string) =>
  who.get(`/api/v1/school-chat/messages?conversationId=${encodeURIComponent(conv)}${studentId ? `&studentId=${studentId}` : ""}`);
const bodies = (r: Res): string[] => (r.body?.data?.messages ?? []).map((m) => m.body);

test.describe.serial("school chat", () => {
  let famA1: Api, famA2: Api, famB: Api, classTeacher: Api, maths: Api, hindi: Api, principal: Api;
  const tag = Date.now().toString(36);

  test.beforeAll(async () => {
    expect(a1 && a2 && b1, "fixture has two Nursery-A families and an LKG-A family").toBeTruthy();
    expect(a1!.householdId).not.toBe(a2!.householdId);
    famA1 = await api(parentSession(a1!.householdId));
    famA2 = await api(parentSession(a2!.householdId));
    famB = await api(parentSession(b1!.householdId));
    classTeacher = await api(fx.sessions.teacher);
    maths = await api(staffSession(17)); // MATH in sections 1 and 6
    hindi = await api(staffSession(18)); // HIN in sections 2 and 7
    principal = await api(fx.sessions.principal);
  });
  test.afterAll(async () => {
    for (const a of [famA1, famA2, famB, classTeacher, maths, hindi, principal]) await a?.ctx.dispose();
  });

  test("the family sees its child's class group and subject groups; the class teacher sees the class group", async () => {
    const r = await famA1.get(`/api/v1/school-chat/conversations?studentId=${a1!.id}`);
    expect(r.status).toBe(200);
    const ids = (r.body.data.conversations as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(cls(1));
    expect(ids).toContain(sub(1, MATH));
    expect(ids.some((id) => id.includes(sectionId(2)))).toBe(false);
    const t = await classTeacher.get("/api/v1/school-chat/conversations");
    expect((t.body.data.conversations as { id: string }[]).map((c) => c.id)).toContain(cls(1));
    // A family must say which child it is acting for, and only its own.
    expect((await famA1.get("/api/v1/school-chat/conversations")).status).toBe(400);
    expect((await famA1.get(`/api/v1/school-chat/conversations?studentId=${a2!.id}`)).status).toBe(403);
  });

  test("1. an abusive message is held and invisible to classmates until approved", async () => {
    const text = `abe chutiye tu kya samajhta hai ${tag}`;
    const s = await famA1.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: a1!.id, body: text });
    expect(s.status).toBe(200);
    expect(s.body.data.held).toBe(true);
    expect(s.body.data.notice).toMatch(/waiting for review/);

    expect(bodies(await msgs(famA2, cls(1), a2!.id))).not.toContain(text);
    expect(bodies(await msgs(classTeacher, cls(1)))).not.toContain(text);
    const own = (await msgs(famA1, cls(1), a1!.id)).body.data.messages.find((m: { body: string }) => m.body === text);
    expect(own?.status).toBe("held");

    const q = await principal.get("/api/v1/school-chat/moderation/queue");
    expect(q.status).toBe(200);
    const item = (q.body.data.items as { id: string; body: string; checkedBy: string; categories: string[] }[]).find((i) => i.body === text);
    expect(item?.checkedBy).toBe("rules");
    expect(item?.categories).toContain("abuse");
    // A teacher who is not a moderator cannot see the queue or decide.
    expect((await classTeacher.get("/api/v1/school-chat/moderation/queue")).status).toBe(403);
    expect((await classTeacher.post("/api/v1/school-chat/moderation/decide", { messageId: item!.id, decision: "approve" })).status).toBe(403);

    const d = await principal.post("/api/v1/school-chat/moderation/decide", { messageId: item!.id, decision: "approve", note: "e2e: approved to prove release" });
    expect(d.status).toBe(200);
    expect(bodies(await msgs(famA2, cls(1), a2!.id))).toContain(text);
    // Decided once: a second decision is refused.
    expect((await principal.post("/api/v1/school-chat/moderation/decide", { messageId: item!.id, decision: "warn", note: "again" })).status).toBe(409);
  });

  test("2. a clean subject-group message reaches classmates and the subject teacher only", async () => {
    const text = `Ma'am, is the homework page 42? ${tag}`;
    const s = await famA1.post("/api/v1/school-chat/send", { conversationId: sub(1, MATH), studentId: a1!.id, body: text });
    expect(s.status).toBe(200);
    expect(s.body.data.held).toBe(false);
    expect(bodies(await msgs(famA2, sub(1, MATH), a2!.id))).toContain(text);
    expect(bodies(await msgs(maths, sub(1, MATH)))).toContain(text);
    const label = (await msgs(maths, sub(1, MATH))).body.data.messages.find((m: { body: string }) => m.body === text)?.senderLabel;
    expect(label).toBe(`${a1!.fullName} (Nursery-A)`);

    expect((await msgs(classTeacher, sub(1, MATH))).status).toBe(403); // not the maths teacher
    expect((await msgs(hindi, sub(1, MATH))).status).toBe(403);
    expect((await msgs(famB, sub(1, MATH), b1!.id)).status).toBe(403); // another class
    expect((await msgs(famB, cls(1), b1!.id)).status).toBe(403);
    expect((await famB.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: b1!.id, body: "hi" })).status).toBe(403);
    // The maths teacher answers in the group.
    expect((await maths.post("/api/v1/school-chat/send", { conversationId: sub(1, MATH), body: `Yes, page 42 ${tag}` })).body.data.held).toBe(false);
    expect(bodies(await msgs(famA1, sub(1, MATH), a1!.id))).toContain(`Yes, page 42 ${tag}`);
  });

  test("3. no child↔child or family↔family direct chat; family ↔ class teacher works", async () => {
    for (const w of [{ kind: "student", studentId: a2!.id }, { kind: "parent", studentId: a2!.id }, { kind: "household", id: a2!.householdId }]) {
      const r = await famA1.post("/api/v1/school-chat/direct", { studentId: a1!.id, with: w });
      expect(r.status, JSON.stringify(w)).toBe(403);
    }
    // Staff open chats with families, never with a child directly.
    expect((await classTeacher.post("/api/v1/school-chat/direct", { with: { kind: "student", studentId: a1!.id } })).status).toBe(403);
    // A family may message its child's teachers, not any teacher.
    expect((await famA1.post("/api/v1/school-chat/direct", { studentId: a1!.id, with: { kind: "staff", id: staffId(18) } })).status).toBe(403);
    const dm = await famA1.post("/api/v1/school-chat/direct", { studentId: a1!.id, with: { kind: "staff", id: staffId(4) } });
    expect(dm.status).toBe(200);
    const id = dm.body.data.id as string;
    const s = await famA1.post("/api/v1/school-chat/send", { conversationId: id, studentId: a1!.id, body: `Will Aarav's tiffin be fine? ${tag}` });
    expect(s.body.data.held).toBe(false);
    const t = await msgs(classTeacher, id);
    expect(t.status).toBe(200);
    expect(t.body.data.messages.at(-1)?.senderLabel).toBe(`Parent of ${a1!.fullName} (Nursery-A)`);
    expect((await msgs(famA2, id, a2!.id)).status).toBe(403);
    expect((await msgs(maths, id)).status).toBe(403);
  });

  test("4. a muted child cannot send; a blocked family cannot read; lifting restores", async () => {
    const m = await principal.post("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: "student", subjectId: a2!.id, mode: "mute", reason: "e2e: repeated rude messages" });
    expect(m.status).toBe(200);
    const refused = await famA2.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: a2!.id, body: `hello ${tag}` });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/muted/);
    expect((await msgs(famA2, cls(1), a2!.id)).status).toBe(200); // a mute may still read

    const b = await principal.post("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: "household", subjectId: b1!.householdId, mode: "block", reason: "e2e: block test" });
    expect(b.status).toBe(200);
    const list = await famB.get(`/api/v1/school-chat/conversations?studentId=${b1!.id}`);
    expect(list.body.data.blocked).toBe(true);
    expect(list.body.data.conversations).toHaveLength(0);
    expect((await msgs(famB, cls(2), b1!.id)).status).toBe(403);
    // A reason is required.
    expect((await principal.post("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: "staff", subjectId: staffId(18), mode: "mute", reason: "" })).status).toBe(400);

    for (const id of [m.body.data.id, b.body.data.id]) {
      expect((await principal.post("/api/v1/school-chat/moderation/blocks", { op: "lift", id, reason: "e2e: lifted" })).status).toBe(200);
    }
    expect((await famA2.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: a2!.id, body: `hello again ${tag}` })).body.data.held).toBe(false);
    expect((await msgs(famB, cls(2), b1!.id)).status).toBe(200);
    // Both are in the behaviour log.
    const sum = await principal.get("/api/v1/school-chat/moderation/summary?days=7");
    expect(sum.status).toBe(200);
  });

  test("4b. a sender over the rate limit (10 a minute) is refused with 429", async () => {
    for (let i = 1; i <= 10; i += 1) {
      const r = await famB.post("/api/v1/school-chat/send", { conversationId: cls(2), studentId: b1!.id, body: `rate ${i} ${tag}` });
      expect(r.status, `message ${i}`).toBe(200);
    }
    // The 11th is refused before the AI check (the marker would otherwise hold it: 200 + held).
    const over = await famB.post("/api/v1/school-chat/send", { conversationId: cls(2), studentId: b1!.id, body: `rate 11 [[ai-down]] ${tag}` });
    expect(over.status).toBe(429);
    expect(over.body.error.message).toMatch(/too fast \(10 a minute at most\)/);
    expect(bodies(await msgs(famB, cls(2), b1!.id))).not.toContain(`rate 11 [[ai-down]] ${tag}`);
    const q = await principal.get("/api/v1/school-chat/moderation/queue");
    expect((q.body.data.items as { body: string }[]).some((i) => i.body.includes(`rate 11`) && i.body.includes(tag))).toBe(false);
  });

  test("5b. a teacher's abusive message is held; with the AI down it is posted and flagged", async () => {
    const rude = `abe chutiye chup raho ${tag}`;
    const s = await classTeacher.post("/api/v1/school-chat/send", { conversationId: cls(1), body: rude });
    expect(s.status).toBe(200);
    expect(s.body.data.held).toBe(true);
    expect(bodies(await msgs(famA1, cls(1), a1!.id))).not.toContain(rude);
    const outage = `Notice: PTM on Saturday [[ai-down]] staff ${tag}`;
    const o = await classTeacher.post("/api/v1/school-chat/send", { conversationId: cls(1), body: outage });
    expect(o.status).toBe(200);
    expect(o.body.data.held).toBe(false);
    expect(bodies(await msgs(famA1, cls(1), a1!.id))).toContain(outage);
    const q = await principal.get("/api/v1/school-chat/moderation/queue");
    const items = q.body.data.items;
    const held = items.find((i) => i.body === rude);
    expect(held?.status).toBe("held");
    expect(held?.checkedBy).toBe("rules");
    const flagged = items.find((i) => i.body === outage);
    expect(flagged?.status).toBe("visible");
    expect(flagged?.flaggedStaff).toBe(true);
    expect(flagged?.checkedBy).toBe("ai_unavailable");
    // Clear both so the screen test's queue stays as before.
    for (const id of [held!.id, flagged!.id]) {
      expect((await principal.post("/api/v1/school-chat/moderation/decide", { messageId: id, decision: "remove", note: "e2e: staff check" })).status).toBe(200);
    }
  });

  test("5. when the AI check fails the message is held", async () => {
    const text = `see you at the gate [[ai-down]] ${tag}`;
    const s = await famA1.post("/api/v1/school-chat/send", { conversationId: cls(1), studentId: a1!.id, body: text });
    expect(s.body.data.held).toBe(true);
    expect(bodies(await msgs(famA2, cls(1), a2!.id))).not.toContain(text);
    const q = await principal.get("/api/v1/school-chat/moderation/queue");
    const item = (q.body.data.items as { id: string; body: string; checkedBy: string }[]).find((i) => i.body === text);
    expect(item?.checkedBy).toBe("ai_unavailable");
    // Left in the queue for the screen test below.
  });

  test("6. screens: the review queue (desktop, light) and a class group (375 px phone, dark)", async ({ browser }, testInfo) => {
    const p = await openAs(browser, "principal");
    try {
      await p.page.emulateMedia({ colorScheme: "light" });
      await p.page.goto("/school-chat?tab=review");
      const item = p.page.getByTestId("school-chat-queue-item").filter({ hasText: `[[ai-down]] ${tag}` });
      await expect(item).toBeVisible({ timeout: 30_000 });
      await expect(item.getByText(/the AI check failed/)).toBeVisible();
      await p.page.screenshot({ path: testInfo.outputPath("school-chat-review-desktop-light.png"), fullPage: true });
      await testInfo.attach("review-desktop-light", { path: testInfo.outputPath("school-chat-review-desktop-light.png"), contentType: "image/png" });
      // Remove it through the screen.
      await item.getByPlaceholder(/Note/).fill("e2e: removed through the queue");
      await item.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(p.page.getByText("Removed.")).toBeVisible();
      await expect(item).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await p.context.close();
    }

    const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 375, height: 812 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    try {
      const { signIn } = await import("../support");
      await signIn(context, "teacher");
      const page = await context.newPage();
      await page.goto(`/school-chat?c=${encodeURIComponent(cls(1))}`);
      const thread = page.getByTestId("school-chat-thread");
      await expect(thread).toBeVisible({ timeout: 30_000 });
      await expect(thread.getByText(`hello again ${tag}`)).toBeVisible({ timeout: 15_000 });
      await thread.getByLabel("Message").fill(`Good morning, Nursery-A ${tag}`);
      await thread.getByRole("button", { name: "Send" }).click();
      // The bubble, from the server (not the text still in the box).
      await expect(thread.locator('[data-status="visible"]', { hasText: `Good morning, Nursery-A ${tag}` })).toBeVisible({ timeout: 15_000 });
      await expect(thread.getByLabel("Message")).toHaveValue("");
      expect(bodies(await msgs(famA1, cls(1), a1!.id))).toContain(`Good morning, Nursery-A ${tag}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "no sideways scroll at 375 px").toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath("school-chat-group-phone375-dark.png"), fullPage: false });
      await testInfo.attach("group-phone375-dark", { path: testInfo.outputPath("school-chat-group-phone375-dark.png"), contentType: "image/png" });
    } finally {
      await context.close();
    }
  });
});
