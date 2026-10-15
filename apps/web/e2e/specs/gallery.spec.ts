/**
 * gallery — a photo goes from a phone (or the office's browser) to the right
 * families, and to no one else (15 Oct 2026).
 *
 * Production had never stored a gallery photo: the class teacher's tile was
 * there but the principal and the office had no way in on the phone (no tile,
 * so no "Held for review"); the office's web uploads were saved behind the
 * staff-only /api/file route, which a parent's phone cannot open; and the
 * parent app hides an album with no photos — so families saw nothing.
 *
 * Driven the way the apps drive it — the staff app's and parent app's JSON
 * calls under their own sessions, the file PUT straight to the signed
 * storage URL with no key (as the phone does), and the office's Gallery page
 * in a real browser:
 *
 *  1. Who gets the tile: the class teacher (Nursery-A), the principal and the
 *     office get class_gallery; a timetable-only teacher does not and is
 *     refused when she posts.
 *  2. The class teacher posts a photo to a new Nursery-A event → the AI check
 *     (stubbed on this stack: CLASS_GALLERY_AI_STUB=hold) holds it → no
 *     family sees it → the principal sees it held and approves → a Nursery-A
 *     family sees it and opens the very bytes uploaded; a family with no
 *     child in Nursery-A sees no album and is refused the file.
 *  3. The principal posts to the whole school from the app → held → approved
 *     → both families see it.
 *  4. The office uploads a photo on the web Gallery page → a row is stored →
 *     both families see it, through the gallery route (the old /api/file url
 *     answers a parent 401/403, which is why it is not handed to them).
 *  5. The principal's app view counts the approved item and nothing held.
 *  6. The parent web portal (/parent?tab=gallery) shows the same scoped
 *     albums (it used to read a desk a parent may not load and showed the
 *     browser's built-in sample album); a failed read says "Could not load
 *     the gallery", never "No albums".
 */
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { AY_CURRENT, CLASS_TEACHER, E2E_TENANT_SLUG, classId, sectionId } from "../fixture";
import { mintSessionCookie } from "../session";
import { APP_URL, expect, fx, openAs, test } from "../support";

const CT_KEY = CLASS_TEACHER - 3;
const CT_SECTION = `${classId(CT_KEY)}|${sectionId(CT_KEY)}`;

const current = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active");
const sectionsOf = (hh: string) => new Set(current.filter((s) => s.householdId === hh).map((s) => `${s.classId}|${s.sectionId}`));
const households = [...new Set(current.map((s) => s.householdId))];
const inClass = households.find((h) => sectionsOf(h).has(CT_SECTION))!;
const otherClass = households.find((h) => !sectionsOf(h).has(CT_SECTION) && sectionsOf(h).size > 0)!;

const parent = (householdId: string): DemoSession => ({
  persona: "parent",
  fullName: `Guardian of ${householdId}`,
  roleCode: "parent",
  householdId,
  tenantSlug: E2E_TENANT_SLUG,
  academicYearCode: AY_CURRENT,
});

async function openParent(browser: Browser, householdId: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: APP_URL });
  await context.addCookies([
    { name: demoSessionCookieName(), value: mintSessionCookie(parent(householdId)), url: APP_URL, httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

type Json = Record<string, unknown>;
async function call(req: APIRequestContext, method: "GET" | "POST", path: string, body?: Json) {
  const r = method === "GET" ? await req.get(path) : await req.post(path, { data: body ?? {} });
  const text = await r.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  // v1 answers { ok, data } — the app reads data.
  const data = (json.data ?? json) as Json;
  return { status: r.status(), data, json };
}

type Album = { id: string; title: string; photos: { id: string; url: string; kind: string }[]; coverUrl: string };
async function albumsOf(req: APIRequestContext): Promise<Album[]> {
  const r = await call(req, "GET", "/api/v1/gallery/albums");
  expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
  return (r.data.albums as Album[]) ?? [];
}

/** The photo, as the phone sends it: upload-url → PUT (no key) → complete. */
async function postPhoto(req: APIRequestContext, albumId: string, bytes: Buffer, caption: string) {
  const start = await call(req, "POST", "/api/v1/staff/class-gallery/upload-url", {
    albumId,
    fileName: "IMG_0001.jpg",
    contentType: "image/jpeg",
    bytes: bytes.length,
  });
  expect(start.status, JSON.stringify(start.json)).toBe(200);
  const uploadUrl = String(start.data.uploadUrl);
  expect(uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/storage\/v1\/object\/upload\/sign\/class-gallery\//);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: new Uint8Array(bytes) });
  expect(put.status, await put.clone().text()).toBe(200);
  const done = await call(req, "POST", "/api/v1/staff/class-gallery/complete", {
    albumId,
    photoId: start.data.photoId,
    path: start.data.path,
    caption,
  });
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  return { photoId: String(start.data.photoId), status: String(done.data.status) };
}

/** Follow the media route's redirect and return the bytes a parent's phone gets. */
async function openMedia(req: APIRequestContext, url: string): Promise<{ status: number; body: Buffer }> {
  const r = await req.get(url, { maxRedirects: 0 });
  if (r.status() !== 302) return { status: r.status(), body: Buffer.alloc(0) };
  const loc = r.headers()["location"]!;
  const f = await fetch(loc);
  return { status: f.status, body: Buffer.from(await f.arrayBuffer()) };
}

test.describe.configure({ mode: "serial" });

test("the gallery reaches the right families: class teacher → AI hold → principal approves → that class only; school and web albums → everyone", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  expect(inClass, "a household with a child in Nursery-A").toBeTruthy();
  expect(otherClass, "a household with no child in Nursery-A").toBeTruthy();

  const teacher = await openAs(browser, "teacher");
  const principal = await openAs(browser, "principal");
  const office = await openAs(browser, "office");
  const ttTeacher = await openAs(browser, "timetableTeacher");
  const famA = await openParent(browser, inClass);
  const famB = await openParent(browser, otherClass);

  // A real JPEG: the page rendered and photographed.
  await teacher.page.setContent('<div style="width:64px;height:48px;background:linear-gradient(90deg,#c33,#36c)"></div>');
  const jpeg = await teacher.page.locator("div").screenshot({ type: "jpeg" });
  const event = `Sports day ${Date.now().toString(36)}`;
  const schoolEvent = `Annual day ${Date.now().toString(36)}`;
  let classAlbum = "";
  let classPhoto = "";
  let webAlbumTitle = "";

  try {
    await test.step("1. the tile: class teacher, principal and office yes; a timetable-only teacher no", async () => {
      for (const [who, ctx, want] of [
        ["class teacher", teacher.context, true],
        ["principal", principal.context, true],
        ["office", office.context, true],
        ["timetable-only teacher", ttTeacher.context, false],
      ] as const) {
        const f = await call(ctx.request, "GET", "/api/v1/staff/features");
        expect(f.status, `${who}: ${JSON.stringify(f.json).slice(0, 200)}`).toBe(200);
        expect((f.data.features as string[]).includes("class_gallery"), `${who} has class_gallery`).toBe(want);
      }
      const refused = await call(ttTeacher.context.request, "POST", "/api/v1/staff/class-gallery/event", { section: CT_SECTION, name: event });
      expect(refused.status).toBe(403);
      const notSchool = await call(teacher.context.request, "POST", "/api/v1/staff/class-gallery/event", { section: "school", name: event });
      expect(notSchool.status, "a class teacher does not post to the whole school").toBe(403);
    });

    await test.step("2a. the class teacher's gallery opens on Nursery-A; she makes an event and posts a photo — held by the AI check", async () => {
      const g = await call(teacher.context.request, "GET", "/api/v1/staff/class-gallery");
      expect(g.status).toBe(200);
      expect(g.data.section).toBe(CT_SECTION);
      expect(g.data.canReview).toBe(false);
      const ev = await call(teacher.context.request, "POST", "/api/v1/staff/class-gallery/event", { section: CT_SECTION, name: event });
      expect(ev.status, JSON.stringify(ev.json)).toBe(200);
      classAlbum = String(ev.data.id);
      const up = await postPhoto(teacher.context.request, classAlbum, jpeg, "Relay race");
      classPhoto = up.photoId;
      expect(up.status).toBe("held");
    });

    await test.step("2b. held: no family sees it yet", async () => {
      for (const fam of [famA, famB]) {
        expect((await albumsOf(fam.request)).some((a) => a.id === classAlbum)).toBe(false);
      }
      const early = await famA.request.get(`/api/v1/gallery/media/${classPhoto}`, { maxRedirects: 0 });
      expect(early.status(), "a held item's file is refused to a parent").toBe(403);
    });

    await test.step("2c. the principal sees it held and approves it", async () => {
      const g = await call(principal.context.request, "GET", "/api/v1/staff/class-gallery");
      expect(g.status).toBe(200);
      expect(g.data.canReview).toBe(true);
      expect(Number(g.data.heldCount)).toBeGreaterThanOrEqual(1);
      const sections = (g.data.classes as { section: string }[]).map((c) => c.section);
      expect(sections).toContain("school");
      expect(sections).toContain(CT_SECTION);
      const list = await call(principal.context.request, "GET", "/api/v1/staff/class-gallery/review");
      const item = (list.data.items as { id: string; status: string }[]).find((i) => i.id === classPhoto);
      expect(item?.status).toBe("held");
      const teacherReview = await call(teacher.context.request, "POST", "/api/v1/staff/class-gallery/review", { id: classPhoto, action: "approve" });
      expect(teacherReview.status, "a class teacher does not approve her own").toBe(403);
      const ok = await call(principal.context.request, "POST", "/api/v1/staff/class-gallery/review", { id: classPhoto, action: "approve" });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.data.status).toBe("ok");
    });

    await test.step("2d. the Nursery-A family sees the event and opens the very photo; the other family sees nothing and is refused", async () => {
      const a = (await albumsOf(famA.request)).find((x) => x.id === classAlbum);
      expect(a, "the Nursery-A family sees the event").toBeTruthy();
      expect(a!.photos.map((p) => p.id)).toEqual([classPhoto]);
      expect(a!.photos[0]!.url).toBe(`/api/v1/gallery/media/${classPhoto}`);
      const got = await openMedia(famA.request, a!.photos[0]!.url);
      expect(got.status).toBe(200);
      expect(got.body.equals(jpeg), "the bytes the teacher's phone uploaded").toBe(true);

      expect((await albumsOf(famB.request)).some((x) => x.id === classAlbum)).toBe(false);
      const refused = await famB.request.get(`/api/v1/gallery/media/${classPhoto}`, { maxRedirects: 0 });
      expect(refused.status()).toBe(403);
    });

    await test.step("3. the principal posts to the whole school from the app → held → approved → every family", async () => {
      const ev = await call(principal.context.request, "POST", "/api/v1/staff/class-gallery/event", { section: "school", name: schoolEvent });
      expect(ev.status, JSON.stringify(ev.json)).toBe(200);
      const album = String(ev.data.id);
      const up = await postPhoto(principal.context.request, album, jpeg, "Stage");
      expect(up.status).toBe("held");
      expect((await albumsOf(famB.request)).some((x) => x.id === album)).toBe(false);
      const ok = await call(office.context.request, "POST", "/api/v1/staff/class-gallery/review", { id: up.photoId, action: "approve" });
      expect(ok.status, `the office decides too: ${JSON.stringify(ok.json)}`).toBe(200);
      for (const fam of [famA, famB]) {
        const a = (await albumsOf(fam.request)).find((x) => x.id === album);
        expect(a?.photos.length).toBe(1);
        const got = await openMedia(fam.request, a!.photos[0]!.url);
        expect(got.status).toBe(200);
        expect(got.body.equals(jpeg)).toBe(true);
      }
    });

    await test.step("4. the office uploads on the web Gallery page → a row is stored → every family sees it", async () => {
      const page = office.page;
      const title = `Science fair ${Date.now().toString(36)}`;
      webAlbumTitle = title;
      await page.goto("/comms?tab=gallery");
      await expect(page.getByText("New album")).toBeVisible({ timeout: 30_000 });
      // The desk has loaded once the album step 3 made is listed (a form
      // filled before that is reset by the load).
      await expect(page.getByRole("button", { name: new RegExp(schoolEvent) })).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      await page.getByPlaceholder("Annual day 2026").fill(title);
      await expect(page.getByPlaceholder("Annual day 2026")).toHaveValue(title);
      await page.getByRole("button", { name: "Publish now" }).click();
      await expect(page.getByText("Album published")).toBeVisible();
      const upload = page.waitForResponse((r) => r.url().endsWith("/api/upload") && r.request().method() === "POST");
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "science fair.jpg", mimeType: "image/jpeg", buffer: jpeg });
      const up = await upload;
      expect(up.status(), await up.text()).toBe(200);
      await expect(page.getByText("Photo(s) added")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("office-web-gallery.png"), fullPage: true });

      // Stored as a row (the desk push is debounced): poll the desk as the office.
      let stored: { id: string; url: string } | undefined;
      let albumId = "";
      await expect
        .poll(
          async () => {
            const d = await call(page.request, "GET", "/api/school-data/gallery-desk");
            const album = (d.json.albums as { id: string; title: string }[] | undefined)?.find((a) => a.title === title);
            albumId = album?.id ?? "";
            stored = (d.json.photos as { id: string; albumId: string; url: string }[] | undefined)?.find((p) => p.albumId === albumId);
            return !!stored;
          },
          { timeout: 30_000, message: "the office's photo is stored as a row" },
        )
        .toBe(true);
      expect(stored!.url).toMatch(/^\/api\/file\/gallery\//);

      const old = await famA.request.get(stored!.url, { maxRedirects: 0 });
      expect([401, 403], "the staff-only url a parent used to be handed").toContain(old.status());

      for (const fam of [famA, famB]) {
        const a = (await albumsOf(fam.request)).find((x) => x.id === albumId);
        expect(a?.photos.map((p) => p.url)).toEqual([`/api/v1/gallery/media/${stored!.id}`]);
        expect(a!.coverUrl).toBe(`/api/v1/gallery/media/${stored!.id}`);
        const got = await openMedia(fam.request, a!.photos[0]!.url);
        expect(got.status).toBe(200);
        expect(got.body.equals(jpeg)).toBe(true);
      }
    });

    await test.step("5. the principal's app view: Nursery-A event counted, nothing left held", async () => {
      const g = await call(principal.context.request, "GET", `/api/v1/staff/class-gallery?section=${encodeURIComponent(CT_SECTION)}`);
      const ev = (g.data.events as { id: string; photos: number; held: number }[]).find((e) => e.id === classAlbum);
      expect(ev).toMatchObject({ photos: 1, held: 0 });
      expect(g.data.heldCount).toBe(0);
    });

    await test.step("6. the parent web portal: the family's albums from the scoped route; a failed read is not 'no albums'", async () => {
      const a = await famA.newPage();
      await a.setViewportSize({ width: 420, height: 900 });
      await a.goto("/parent?tab=gallery");
      await expect(a.getByRole("button", { name: event })).toBeVisible({ timeout: 30_000 });
      await expect(a.getByRole("button", { name: webAlbumTitle })).toBeVisible();
      await expect(a.getByRole("button", { name: schoolEvent })).toBeVisible();
      await expect(a.getByText("Annual Day & Cultural Celebrations 2026"), "never the browser's sample album").toHaveCount(0);
      // Every cover opens for this parent (each is the gallery route, redirected to a ten-minute link).
      await expect
        .poll(() => a.$$eval("button img", (els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0)), { timeout: 15_000 })
        .toBe(true);
      await a.screenshot({ path: testInfo.outputPath("parent-portal-gallery.png"), fullPage: true });
      await a.getByRole("button", { name: event }).click();
      const img = a.locator("figure img").first();
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      await a.screenshot({ path: testInfo.outputPath("parent-portal-class-event.png"), fullPage: true });

      const b = await famB.newPage();
      await b.goto("/parent?tab=gallery");
      await expect(b.getByRole("button", { name: webAlbumTitle })).toBeVisible({ timeout: 30_000 });
      await expect(b.getByRole("button", { name: event }), "another class's event").toHaveCount(0);

      await b.route("**/api/v1/gallery/albums", (r) => r.fulfill({ status: 503, body: '{"ok":false}' }));
      await b.reload();
      await expect(b.getByText("Could not load the gallery.")).toBeVisible({ timeout: 30_000 });
      await expect(b.getByText("No albums published yet.")).toHaveCount(0);
      await b.screenshot({ path: testInfo.outputPath("parent-portal-failed-read.png"), fullPage: true });
    });
  } finally {
    for (const c of [teacher.context, principal.context, office.context, ttTeacher.context, famA, famB]) await c.close();
  }
});
