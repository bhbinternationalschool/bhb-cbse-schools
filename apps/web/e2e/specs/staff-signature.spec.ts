/**
 * staff-signature — POST/GET/DELETE /api/v1/staff/me/signature (director,
 * 15 Oct 2026: teachers and the principal set their signature from the
 * staff app). The server's rules, against the real route:
 *   - signed out → 401;
 *   - a staff login reads and removes only its OWN signature; naming another
 *     member of staff (form field or ?staffId=) → 403, never redirected;
 *   - the file must be a real PNG / JPG / WebP (by its bytes) of at most 1 MB.
 * The stack has no Storage (it answers 501), so a valid upload of your own
 * gets past every check and stops at the bucket: that answer says
 * "the signature was not saved", which is what proves the checks let it through.
 * Reads only — nothing on the stack changes.
 */
import type { APIRequestContext } from "@playwright/test";
import { APP_URL, expect, fx, openAs, test } from "../support";

const ROUTE = "/api/v1/staff/me/signature";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function upload(req: APIRequestContext, file: Buffer, name: string, mimeType: string, extra: Record<string, string> = {}) {
  return req.post(ROUTE, { multipart: { file: { name, mimeType, buffer: file }, ...extra } });
}

test("signed out: every verb is 401", async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: APP_URL });
  try {
    expect((await anon.get(ROUTE)).status()).toBe(401);
    expect((await upload(anon, PNG, "s.png", "image/png")).status()).toBe(401);
    expect((await anon.delete(ROUTE)).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test("a teacher reads and clears only her own; naming anyone else is 403", async ({ browser }) => {
  const { context, page } = await openAs(browser, "teacher");
  const other = fx.sessions.principal.staffId!;
  try {
    const own = await page.request.get(ROUTE);
    expect(own.status(), await own.text()).toBe(200);
    expect(((await own.json()) as { data: { signatureUrl: string } }).data.signatureUrl).toBe("");

    const prof = await page.request.get("/api/v1/staff/me/profile");
    expect(((await prof.json()) as { data: { staff: Record<string, unknown> } }).data.staff).toHaveProperty("signatureUrl", "");

    const g = await page.request.get(`${ROUTE}?staffId=${other}`);
    expect(g.status()).toBe(403);
    expect(((await g.json()) as { error: { message: string } }).error.message).toBe("You can only set your own signature");

    const p = await upload(page.request, PNG, "s.png", "image/png", { staffId: other });
    expect(p.status(), "uploading the principal's signature as a teacher").toBe(403);
    const pq = await page.request.post(`${ROUTE}?staffId=${other}`, { multipart: { file: { name: "s.png", mimeType: "image/png", buffer: PNG } } });
    expect(pq.status()).toBe(403);

    expect((await page.request.delete(`${ROUTE}?staffId=${other}`)).status()).toBe(403);
    const d = await page.request.delete(ROUTE);
    expect(d.status(), await d.text()).toBe(200);
  } finally {
    await context.close();
  }
});

test("only a real, small image: SVG, oversize and no file are 400; your own PNG passes every check", async ({ browser }) => {
  const { context, page } = await openAs(browser, "teacher");
  try {
    const svg = await upload(page.request, SVG, "sig.png", "image/png");
    expect(svg.status()).toBe(400);
    expect(((await svg.json()) as { error: { message: string } }).error.message).toMatch(/PNG, JPG or WebP/);

    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect((await upload(page.request, big, "s.png", "image/png")).status()).toBe(400);

    expect((await page.request.post(ROUTE, { multipart: { note: "x" } })).status()).toBe(400);

    const mine = await upload(page.request, PNG, "s.png", "image/png", { staffId: fx.sessions.teacher.staffId! });
    const body = (await mine.json()) as { error?: { message: string } };
    // The stack has no Storage: past auth and validation, the bucket refuses.
    expect([200, 500]).toContain(mine.status());
    if (mine.status() === 500) expect(body.error!.message).toMatch(/^The signature was not saved/);
  } finally {
    await context.close();
  }
});
