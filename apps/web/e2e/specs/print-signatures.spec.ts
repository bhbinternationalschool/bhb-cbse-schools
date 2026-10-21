/**
 * print-signatures — the signature a member of staff put on their profile
 * (PR #677) prints on the documents they sign (lib/printSignatures).
 *
 * Against the real stack, through the app's own write path: the principal,
 * the class teacher and the office member each upload a signature with
 * POST /api/v1/staff/me/signature (into the stack's school-files bucket).
 * Then, as the office on Certificates, in the print preview:
 *   - a bonafide issued by the principal and naming the class teacher
 *     carries the principal's signature on the Principal line and the class
 *     teacher's on the Class teacher line — and each image has really
 *     decoded (naturalWidth > 0), so it prints;
 *   - a bonafide issued by "E2E Principal" (nobody on the roll) carries no
 *     principal's signature: a blank line, never the current principal's;
 *   - a TC carries the class teacher, the "Checked by" office member and
 *     the principal, each on their own line;
 *   - the images are embedded data URLs (no link into the file store) and
 *     stay in place under print media.
 * And nobody else gets a signature: signed out → 401, a parent → 403 on the
 * print route and on the file itself.
 * Signatures are removed again at the end (DELETE, own record).
 *
 * Screenshots (desktop-light, print media) in e2e/print-signature-shots
 * (git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Page } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { AY_CURRENT, CLASS_TEACHER, OFFICE_STAFF, PRINCIPAL_STAFF } from "../fixture";
import { mintSessionCookie } from "../session";
import { APP_URL, expect, fx, openAs, test, type Who } from "../support";

const SHOTS = process.env.PRINT_SIGNATURE_SHOTS || path.join(__dirname, "..", "print-signature-shots");
const ROUTE = "/api/v1/staff/me/signature";

const staffAt = (n: number) => fx.staff.staff[n - 1]!;
const PRINCIPAL = staffAt(PRINCIPAL_STAFF);
const TEACHER = staffAt(CLASS_TEACHER);
const OFFICE = staffAt(OFFICE_STAFF);

/* A real, decodable PNG: dark-blue "ink" strokes on a transparent page. */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function signaturePng(seed: number): Buffer {
  const w = 240;
  const h = 80;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let x = 0; x < w; x++) {
    // A wavy stroke, different per person, 3 px thick.
    const yc = Math.round(h / 2 + Math.sin((x + seed * 17) / (9 + seed)) * (14 + seed * 3) - (x / w) * 10);
    for (let t = -1; t <= 1; t++) {
      const y = yc + t;
      if (y < 0 || y >= h) continue;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = 20;
      raw[o + 1] = 40;
      raw[o + 2] = 120;
      raw[o + 3] = 255;
    }
  }
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SIGNERS: { who: Who; staffId: string; seed: number }[] = [
  { who: "principal", staffId: PRINCIPAL.id, seed: 1 },
  { who: "teacher", staffId: TEACHER.id, seed: 2 },
  { who: "office", staffId: OFFICE.id, seed: 3 },
];

let storedUrls: Record<string, string> = {};

async function asStaff<T>(browser: import("@playwright/test").Browser, who: Who, fn: (page: Page) => Promise<T>): Promise<T> {
  const { context, page } = await openAs(browser, who);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  storedUrls = {};
  for (const s of SIGNERS) {
    await asStaff(browser, s.who, async (page) => {
      const r = await page.request.post(ROUTE, {
        multipart: { file: { name: "signature.png", mimeType: "image/png", buffer: signaturePng(s.seed) } },
      });
      expect(r.status(), `upload as ${String(s.who)}: ${await r.text()}`).toBe(200);
      storedUrls[s.staffId] = ((await r.json()) as { data: { signatureUrl: string } }).data.signatureUrl;
    });
  }
  expect(Object.values(storedUrls).every((u) => u.startsWith("/api/file/staff/"))).toBe(true);
});

test.afterAll(async ({ browser }) => {
  for (const s of SIGNERS) {
    await asStaff(browser, s.who, async (page) => {
      await page.request.delete(ROUTE);
    });
  }
});

async function openCertificate(page: Page, certNo: string, issueId: string) {
  await page.goto("/certificates");
  const row = page.getByRole("button", { name: new RegExp(certNo) }).first();
  await row.waitFor({ state: "visible", timeout: 60_000 });
  await row.click();
  const sheet = page.locator(`#certificate-${issueId}`);
  await sheet.waitFor({ state: "visible" });
  return sheet;
}

/** The signature images on the sheet, keyed by whose they are, once decoded. */
async function signaturesOn(sheet: import("@playwright/test").Locator) {
  return sheet.locator('[data-testid="print-signature"]').evaluateAll((els) =>
    els.map((el) => {
      const img = el.querySelector("img") as HTMLImageElement | null;
      const line = el.closest("div")?.parentElement?.textContent || "";
      return {
        staffId: el.getAttribute("data-signature-of") || "",
        src: img?.getAttribute("src")?.slice(0, 22) || "",
        decoded: !!img && img.complete && img.naturalWidth > 0,
        line,
      };
    }),
  );
}

test("a certificate issued by the principal carries the principal's and the named class teacher's signatures", async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { context, page } = await openAs(browser, "office");
  try {
    const sheet = await openCertificate(page, "E2E-BON-1", "e2e_cert_1");
    await expect(sheet.locator(`[data-signature-of="${PRINCIPAL.id}"] img`)).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator(`[data-signature-of="${TEACHER.id}"] img`)).toBeVisible();
    await expect.poll(async () => (await signaturesOn(sheet)).every((s) => s.decoded)).toBe(true);
    const sigs = await signaturesOn(sheet);
    expect(sigs.map((s) => s.staffId).sort()).toEqual([PRINCIPAL.id, TEACHER.id].sort());
    for (const s of sigs) expect(s.src, "embedded, not a link into the file store").toBe("data:image/png;base64,");
    expect(sigs.find((s) => s.staffId === PRINCIPAL.id)!.line).toMatch(/Principal/);
    expect(sigs.find((s) => s.staffId === TEACHER.id)!.line).toMatch(/Class teacher/);
    // Print preview: what the printer gets.
    await page.emulateMedia({ media: "print" });
    await expect(sheet.locator(`[data-signature-of="${PRINCIPAL.id}"] img`)).toBeVisible();
    await sheet.screenshot({ path: path.join(SHOTS, "bonafide-signed-desktop-light-print.png") });
    await page.emulateMedia({ media: "screen" });
  } finally {
    await context.close();
  }
});

test("a certificate issued by someone else: the principal line stays blank", async ({ browser }) => {
  const { context, page } = await openAs(browser, "office");
  try {
    const sheet = await openCertificate(page, "E2E-BON-2", "e2e_cert_2");
    await expect(sheet.getByText("Principal / authorised")).toBeVisible();
    // Give the signature read time to answer, then: nothing on the sheet.
    await page.waitForResponse((r) => r.url().includes("/api/v1/print/signatures"), { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(500);
    await expect(sheet.locator('[data-testid="print-signature"]')).toHaveCount(0);
    await sheet.screenshot({ path: path.join(SHOTS, "bonafide-unsigned-desktop-light.png") });
  } finally {
    await context.close();
  }
});

test("a TC: class teacher, checked-by and principal each sign their own line", async ({ browser }) => {
  const { context, page } = await openAs(browser, "office");
  try {
    const sheet = await openCertificate(page, "E2E-TC-3", "e2e_cert_3");
    await expect(sheet.locator(`[data-signature-of="${OFFICE.id}"] img`)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await signaturesOn(sheet)).every((s) => s.decoded)).toBe(true);
    const sigs = await signaturesOn(sheet);
    expect(sigs.length).toBe(3);
    expect(sigs.find((s) => s.staffId === TEACHER.id)!.line).toMatch(/Signature of Class Teacher/);
    expect(sigs.find((s) => s.staffId === OFFICE.id)!.line).toMatch(/Checked by/);
    expect(sigs.find((s) => s.staffId === PRINCIPAL.id)!.line).toMatch(/Signature of Principal/);
    await page.emulateMedia({ media: "print" });
    await sheet.screenshot({ path: path.join(SHOTS, "tc-signed-desktop-light-print.png") });
    await page.emulateMedia({ media: "screen" });
  } finally {
    await context.close();
  }
});

test("nobody else reads a signature: signed out 401, a parent 403 (route and file)", async ({ playwright, browser }) => {
  const q = `doc=certificate&want=principal&principalName=${encodeURIComponent(PRINCIPAL.fullName)}`;
  const anon = await playwright.request.newContext({ baseURL: APP_URL });
  try {
    expect((await anon.get(`/api/v1/print/signatures?${q}`)).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  const hh = fx.sis.households.find((h) => fx.sis.students.some((s) => s.householdId === h.id && s.academicYearCode === AY_CURRENT))!;
  const parent: DemoSession = {
    persona: "parent",
    fullName: hh.guardianName,
    roleCode: "parent",
    householdId: hh.id,
    tenantSlug: fx.sessions.office.tenantSlug,
    academicYearCode: AY_CURRENT,
  };
  const context = await browser.newContext({ baseURL: APP_URL });
  await context.addCookies([{ name: demoSessionCookieName(), value: mintSessionCookie(parent), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
  try {
    const r = await context.request.get(`/api/v1/print/signatures?${q}`);
    expect(r.status(), await r.text()).toBe(403);
    const f = await context.request.get(storedUrls[PRINCIPAL.id]!);
    expect(f.status(), "the stored file itself").toBe(403);
  } finally {
    await context.close();
  }
  // The office (Certificates · view) gets it — as an embedded image.
  const ok = await asStaff(browser, "office", (page) => page.request.get(`/api/v1/print/signatures?${q}`));
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { data: { principal: { staffId: string; src: string } | null } };
  expect(body.data.principal?.staffId).toBe(PRINCIPAL.id);
  expect(body.data.principal?.src.startsWith("data:image/png;base64,")).toBe(true);
});
