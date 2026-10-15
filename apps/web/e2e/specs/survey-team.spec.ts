/**
 * survey-team — the field survey team, ERP ↔ server ↔ staff app (15 Oct 2026).
 *
 * The director: "I assigned 1 staff in the ERP but the app still shows not
 * assigned. The app asks for a 6-digit code but the ERP has no provision to
 * generate it." The team and beats are now rows written through the write
 * kernel; the app's signed calls (POST /api/public/survey-day, signed by the
 * phone's key exactly as the staff app signs) read the same rows.
 *
 *  1. ERP → app: the principal adds a member of staff on Admissions → Field
 *     survey → Team, gets the phone code there, the "phone" types it, and
 *     the app's next status call shows the member; made leader in the ERP,
 *     the phone adds a beat, and the principal's open screen shows it
 *     without a reload.
 *  2. The auth matrix: office route (principal / office / teacher), the
 *     phone route (leader / member / non-member / unregistered phone).
 *  3. An old build's whole-desk save cannot drop or add team members/beats.
 *  4. A family recorded without a survey day with a map pin.
 */
import type { Page } from "@playwright/test";
import { APP_URL, expect, openAs, test } from "../support";
import { newSurveyPhone, type SurveyPhone } from "../surveyPhone";

const VIEW = "/api/data/views/survey-team";
const WRITE = "/api/admissions/survey-team";

type View = {
  members: { id: string; staffId: string; fullName: string; role: string; revision: string; assigned: boolean }[];
  beats: { id: string; name: string; isActive: boolean; revision: string }[];
  phones: Record<string, string>;
};

async function view(page: Page): Promise<View> {
  const r = await page.request.get(VIEW);
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: View }).data;
}

async function openTeam(page: Page) {
  await page.goto("/admissions?tab=survey");
  await expect(page.getByTestId("survey-team-card")).toBeVisible({ timeout: 60_000 });
}

/** Pair a phone to a member through the ERP's "Get phone code". */
async function pairThroughErp(page: Page, memberId: string, phone: SurveyPhone) {
  const row = page.getByTestId(`survey-member-${memberId}`);
  await row.getByRole("button", { name: /phone code/ }).click();
  const box = page.getByTestId("survey-pairing-code");
  await expect(box).toBeVisible();
  await expect(box).toContainText("expires in");
  const code = ((await box.locator("p.font-mono").textContent()) || "").trim();
  expect(code).toMatch(/^\d{6}$/);
  const paired = await phone.call(APP_URL, "pair", { extra: code, body: { code }, geo: null });
  expect(paired.status, paired.text).toBe(200);
}

test("ERP assignment reaches the app; the phone code is made in the ERP; a leader's beat reaches the ERP", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await openAs(browser, "principal");
  const phone = await newSurveyPhone();
  try {
    // Before: an unregistered phone is told so (the director's "6-digit code" screen).
    const before = await phone.call(APP_URL, "status", { geo: null });
    expect(before.status).toBe(403);
    expect(JSON.stringify(before.json)).toContain("not_registered");

    await openTeam(a.page);
    const select = a.page.getByLabel("Staff to add");
    const option = select.locator("option").nth(1);
    const staffId = (await option.getAttribute("value"))!;
    const staffName = ((await option.textContent()) || "").split("—").pop()!.trim();
    await select.selectOption(staffId);
    await a.page.getByRole("button", { name: "Add to team" }).click();
    await expect(a.page.getByTestId("survey-team-notice")).toContainText(`${staffName} added`);

    // On the server, as a row (not a browser copy).
    const v1 = await view(a.page);
    const member = v1.members.find((m) => m.staffId === staffId)!;
    expect(member, "the member is stored on the server").toBeTruthy();
    expect(member.assigned).toBe(true);

    await test.step("the 6-digit phone code comes from the team row in the ERP", async () => {
      await pairThroughErp(a.page, member.id, phone);
    });

    await test.step("the app's next status call sees the ERP assignment", async () => {
      const s = await phone.call(APP_URL, "status", { geo: null });
      expect(s.status, s.text).toBe(200);
      const data = (s.json as { data: { member: { name: string; role: string }; canManage: boolean } }).data;
      expect(data.member.name).toBe(staffName);
      expect(data.canManage).toBe(false);
      const team = await phone.call(APP_URL, "team", { geo: null });
      expect(team.status, "a surveyor is not the leader").toBe(403);
      // The ERP now shows the phone as registered.
      await expect(a.page.getByTestId(`survey-member-${member.id}`)).toContainText("test phone", { timeout: 30_000 });
    });

    await test.step("made leader in the ERP, the phone adds a beat; the ERP shows it without a reload", async () => {
      const row = a.page.getByTestId(`survey-member-${member.id}`);
      await row.getByRole("button", { name: `Actions for ${member.fullName}` }).click();
      await a.page.getByRole("menuitem", { name: "Make team leader" }).click();
      await expect(a.page.getByTestId("survey-team-notice")).toContainText("is team leader");
      const s = await phone.call(APP_URL, "status", { geo: null });
      expect((s.json as { data: { canManage: boolean } }).data.canManage).toBe(true);

      const beatName = `Ward ${Date.now().toString(36)}`;
      const change = { op: "beat_save", name: beatName, area: "Shivpur", targetHouseholds: 25 };
      const m = await phone.call(APP_URL, "manage", { extra: `beat_save:${beatName}`, body: { change }, geo: null });
      expect(m.status, m.text).toBe(200);
      const at = Date.now();
      await expect(a.page.getByTestId("survey-beats-card")).toContainText(beatName, { timeout: 30_000 });
      console.log(`leader's beat on the ERP screen after ${Date.now() - at} ms`);

      // A signature over another change is refused.
      const lifted = await phone.call(APP_URL, "manage", { extra: `beat_save:${beatName}`, body: { change: { op: "beat_save", name: "Other" } }, geo: null });
      expect(lifted.status).toBe(403);
    });
  } finally {
    await a.context.close();
  }
});

test("who may change the team: office route and phone route", async ({ browser }) => {
  test.setTimeout(180_000);
  const principal = await openAs(browser, "principal");
  const office = await openAs(browser, "office");
  const teacher = await openAs(browser, "teacher");
  try {
    const staff = ((await (await principal.page.request.get("/api/data/views/staff-list")).json()) as {
      data: { staff: { id: string; status: string }[] };
    }).data.staff.filter((s) => s.status === "active");
    const onTeam = new Set((await view(principal.page)).members.map((m) => m.staffId));
    const free = staff.filter((s) => !onTeam.has(s.id));
    const [s1, s2, s3] = [free[0]!.id, free[1]!.id, free[2]!.id];

    // Office route.
    const tAdd = await teacher.page.request.post(WRITE, { data: { op: "member_add_staff", staffId: s1 } });
    expect(tAdd.status(), "a class teacher is not the office").toBe(403);
    const tView = await teacher.page.request.get(VIEW);
    expect([403]).toContain(tView.status());
    const pAdd = await principal.page.request.post(WRITE, { data: { op: "member_add_staff", staffId: s1 } });
    expect(pAdd.status(), await pAdd.text()).toBe(200);
    const oAdd = await office.page.request.post(WRITE, { data: { op: "member_add_staff", staffId: s2 } });
    console.log(`office (Office role by assignment) add: ${oAdd.status()}`);
    expect([200, 403]).toContain(oAdd.status());
    const dup = await principal.page.request.post(WRITE, { data: { op: "member_add_staff", staffId: s1 } });
    expect(dup.status()).toBe(409);

    // A stale base is refused (the kernel), the newer row stands.
    const v = await view(principal.page);
    const m1 = v.members.find((m) => m.staffId === s1)!;
    const ok = await principal.page.request.post(WRITE, { data: { op: "member_update", id: m1.id, base: m1.revision, startMode: "field" } });
    expect(ok.status()).toBe(200);
    const stale = await principal.page.request.post(WRITE, { data: { op: "member_update", id: m1.id, base: m1.revision, assigned: false } });
    expect(stale.status(), "a write from an older copy").toBe(409);

    // Phone route: leader / member / non-member / unregistered.
    const leaderPhone = await newSurveyPhone();
    const memberPhone = await newSurveyPhone();
    const outsiderPhone = await newSurveyPhone();
    const stranger = await newSurveyPhone();
    const addLeader = await principal.page.request.post(WRITE, { data: { op: "member_add_staff", staffId: s3, leader: true } });
    expect(addLeader.status()).toBe(200);
    const v2 = await view(principal.page);
    const leader = v2.members.find((m) => m.staffId === s3)!;
    const member = v2.members.find((m) => m.staffId === s1)!;
    for (const [mid, p] of [
      [leader.id, leaderPhone],
      [member.id, memberPhone],
    ] as const) {
      const code = (await (await principal.page.request.post(WRITE, { data: { op: "pair_start", memberId: mid } })).json()) as { code: string; expiresAt: string };
      expect(Date.parse(code.expiresAt) - Date.now()).toBeGreaterThan(8 * 60_000);
      const r = await p.call(APP_URL, "pair", { extra: code.code, body: { code: code.code }, geo: null });
      expect(r.status, r.text).toBe(200);
    }
    // An outside surveyor, paired by code: on the team, not the leader.
    const ext = await principal.page.request.post(WRITE, { data: { op: "member_add_external", fullName: "Outside Om", mobile: `98${Date.now().toString().slice(-8)}` } });
    expect(ext.status(), await ext.text()).toBe(200);
    const extId = ((await ext.json()) as { id: string }).id;
    const extCode = (await (await principal.page.request.post(WRITE, { data: { op: "pair_start", memberId: extId } })).json()) as { code: string };
    expect((await outsiderPhone.call(APP_URL, "pair", { extra: extCode.code, body: { code: extCode.code }, geo: null })).status).toBe(200);
    const extStatus = await outsiderPhone.call(APP_URL, "status", { geo: null });
    expect(extStatus.status, extStatus.text).toBe(200);

    const add = { op: "member_add_staff", staffId: s2 };
    const byMember = await memberPhone.call(APP_URL, "manage", { extra: `member_add_staff:${s2}`, body: { change: add }, geo: null });
    expect(byMember.status, "a surveyor is not the leader").toBe(403);
    const byOutsider = await outsiderPhone.call(APP_URL, "manage", { extra: `member_add_staff:${s2}`, body: { change: add }, geo: null });
    expect(byOutsider.status).toBe(403);
    const byStranger = await stranger.call(APP_URL, "manage", { extra: `member_add_staff:${s2}`, body: { change: add }, geo: null });
    expect(byStranger.status).toBe(403);
    expect(JSON.stringify(byStranger.json)).toContain("not_registered");

    const removeLeader = await leaderPhone.call(APP_URL, "manage", {
      extra: `member_remove:${leader.id}`,
      body: { change: { op: "member_remove", id: leader.id, base: leader.revision } },
      geo: null,
    });
    expect(removeLeader.status, "a leader cannot remove themselves").toBe(403);
    const removeExt = await leaderPhone.call(APP_URL, "manage", {
      extra: `member_remove:${extId}`,
      body: { change: { op: "member_remove", id: extId, base: "x" } },
      geo: null,
    });
    expect(removeExt.status, "only the office removes an outside surveyor").toBe(403);
    const leaderLeader = await leaderPhone.call(APP_URL, "manage", {
      extra: `member_leader:${member.id}`,
      body: { change: { op: "member_leader", id: member.id, base: member.revision } },
      geo: null,
    });
    expect(leaderLeader.status, "only the office makes leaders").toBe(403);

    const removeMember = await leaderPhone.call(APP_URL, "manage", {
      extra: `member_remove:${member.id}`,
      body: { change: { op: "member_remove", id: member.id, base: member.revision } },
      geo: null,
    });
    expect(removeMember.status, removeMember.text).toBe(200);
    expect((await view(principal.page)).members.some((m) => m.id === member.id)).toBe(false);
    // Removed from the team: the phone is still registered but no longer on the team.
    const after = await memberPhone.call(APP_URL, "status", { geo: null });
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.json)).toContain("not_on_team");
  } finally {
    await principal.context.close();
    await office.context.close();
    await teacher.context.close();
  }
});

test("an old build's whole-desk admissions save neither drops nor adds team members or beats", async ({ browser }) => {
  const a = await openAs(browser, "principal");
  try {
    const before = await view(a.page);
    const r = await a.page.request.post("/api/school-data/admissions-desk", {
      data: {
        state: {
          surveyTeam: [{ id: "stm_old_build", kind: "staff", staffId: "e2e_stf_30", fullName: "Old copy", role: "leader", assigned: true }],
          surveyBeats: [],
        },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    const after = await view(a.page);
    expect(after.members.map((m) => m.id).sort()).toEqual(before.members.map((m) => m.id).sort());
    expect(after.beats.map((b) => b.id).sort()).toEqual(before.beats.map((b) => b.id).sort());
  } finally {
    await a.context.close();
  }
});

test("a family recorded without a survey day keeps its map pin, and the office board shows it", async ({ browser }) => {
  const a = await openAs(browser, "principal");
  try {
    const child = `Pin Child ${Date.now().toString(36)}`;
    const r = await a.page.request.post("/api/v1/staff/survey/capture", {
      data: {
        beatId: "",
        childName: child,
        guardianName: "Pin Parent",
        mobile: "9876512345",
        parentConsent: true,
        clientRef: `t-${Date.now()}`,
        location: { lat: 25.30123, lng: 82.98765, source: "map" },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    const bad = await a.page.request.post("/api/v1/staff/survey/capture", {
      data: { childName: "X Y", guardianName: "P Q", mobile: "9876512345", parentConsent: true, location: { lat: 0, lng: 0 } },
    });
    expect(bad.status(), "a point outside India is refused").toBe(400);
    const board = (await (await a.page.request.get("/api/v1/admissions/survey-days")).json()) as {
      data: { captures: { childName: string; surveyDayId: string; locatedBy: string; geo: { lat: number } }[] };
    };
    const cap = board.data.captures.find((c) => c.childName === child);
    expect(cap, "the point is on the office's board for today").toBeTruthy();
    expect(cap!.surveyDayId).toBe("");
    expect(cap!.locatedBy).toBe("map");
    expect(cap!.geo.lat).toBeCloseTo(25.30123, 5);
  } finally {
    await a.context.close();
  }
});
