/**
 * Run: npx tsx src/lib/homeworkAttachments.selftest.ts   (npm run test:homework-attachments)
 *
 * Staff-app homework attachments (request mr_mvajhg3w33lx, "Scan page" /
 * "Upload file"), against the e2e fixture's school and a fake PostgREST:
 *
 *  - the upload (lib/homeworkAttachmentUpload.server.ts, behind
 *    POST /api/v1/staff/homework/attachment) stores a file for the class
 *    teacher's own section, in that section's homework folder of the private
 *    bucket; it refuses another section, a member of staff without the app's
 *    "Post homework" (the office), a teacher without homework.edit, a parent,
 *    and a file that is not a photo or a PDF — each BEFORE anything is stored;
 *  - the post route's check takes only files from THIS section's folder —
 *    not another section's, not another private file, not a data: URL;
 *  - a post saved with app attachments reaches readers exactly as a web one
 *    does: the same shape, through /api/v1/homework/attachment, never the
 *    staff-only /api/file reference;
 *  - the reader check: a parent with a child in the section may open it, a
 *    parent without may not;
 *  - the routes exist (the guards' effect is proven above, by behaviour).
 *
 * Every check reports on its own, so running it on the code before the
 * change shows which ones that code fails.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";
import { buildFixture, classId, sectionId, CLASS_TEACHER } from "../../e2e/fixture";
import type { ApiAuthContext } from "@/lib/api/v1/auth";

installServerOnlyStub();
const pg = installFakePostgrest();
const TENANT = "00000000-0000-4000-8000-000000000001";
pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: "2026-10-20T00:00:00.000Z" }];
pg.tables.timetable_desk_slices = [
  { tenant_id: TENANT, slice_key: "publishedGrids", payload: [], updated_at: "2026-10-20T00:00:00.000Z" },
  { tenant_id: TENANT, slice_key: "grids", payload: [], updated_at: "2026-10-20T00:00:00.000Z" },
];

const fx = buildFixture();
const masters = {
  ...fx.masters,
  staff: fx.staff.staff,
  departments: fx.staff.departments,
  designations: fx.staff.designations,
};
const ctxFor = (session: ApiAuthContext["session"], rbac = fx.rbac): ApiAuthContext => ({
  session,
  masters,
  rbac,
  rbacKnown: true,
  authKind: "session",
});

// The class teacher's own section, and one she does not teach.
const MINE = CLASS_TEACHER - 3;
const OTHER = 7;
const own = { classId: classId(MINE), sectionId: sectionId(MINE) };
const other = { classId: classId(OTHER), sectionId: sectionId(OTHER) };

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
function form(target: { classId: string; sectionId: string }, file?: File): FormData {
  const f = new FormData();
  f.append("classId", target.classId);
  f.append("sectionId", target.sectionId);
  f.append("file", file ?? new File([JPEG], "page-1.jpg", { type: "image/jpeg" }));
  f.append("label", "Page 1");
  return f;
}

const stored: string[] = [];
const store = {
  async put(path: string) {
    stored.push(path);
    return { ok: true as const };
  },
};

void (async () => {
  const quietWarn = console.warn;
  console.warn = () => {};
  const mod = await import("./homeworkAttachmentUpload.server").catch((e: Error) => {
    console.log(`(upload module missing: ${e.message.split("\n")[0]})`);
    return null;
  });
  const pure = await import("./homeworkAttachments").catch(() => null);
  const { ApiError } = await import("./api/v1/errors");
  const refused = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;

  const teacher = ctxFor(fx.sessions.teacher);
  let uploaded: { id: string; label: string; url: string } | null = null;

  await check("upload: the class teacher, own section → stored in that section's homework folder", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    const a = await mod.uploadHomeworkAttachment(teacher, form(own), store);
    assert.equal(stored.length, 1);
    assert.match(stored[0]!, new RegExp(`^homework/${own.classId}/${own.sectionId}/\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+\\.jpg$`));
    assert.equal(a.url, `/api/file/${stored[0]}`);
    assert.equal(a.kind, "image");
    assert.equal(a.label, "Page 1");
    uploaded = a;
  });

  await check("upload: another section → 403, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    await assert.rejects(mod.uploadHomeworkAttachment(teacher, form(other), store), refused(403));
    assert.equal(stored.length, 0);
  });

  await check("upload: the office (no 'Post homework' in the app) → 403, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    await assert.rejects(mod.uploadHomeworkAttachment(ctxFor(fx.sessions.office), form(own), store), refused(403));
    assert.equal(stored.length, 0);
  });

  await check("upload: a teacher without homework.edit → 403, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    const rbac = structuredClone(fx.rbac);
    for (const r of rbac.roles) {
      if (r.code === "teacher") {
        r.permissions = (r.permissions ?? []).map((p) =>
          p.module === "homework" ? { ...p, actions: p.actions.filter((x) => x === "view") } : p,
        );
      }
    }
    await assert.rejects(mod.uploadHomeworkAttachment(ctxFor(fx.sessions.teacher, rbac), form(own), store), refused(403));
    assert.equal(stored.length, 0);
  });

  await check("upload: a teacher with 'Post homework' switched off in the app → 403, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    const { defaultMobileAccess } = await import("./mobileFeatures");
    const access = defaultMobileAccess();
    const rbac = {
      ...fx.rbac,
      mobile: {
        ...access,
        roleFeatures: Object.fromEntries(
          Object.entries(access.roleFeatures).map(([k, v]) => [k, v.filter((f) => f !== "homework_post")]),
        ),
      },
    };
    await assert.rejects(
      mod.uploadHomeworkAttachment(ctxFor(fx.sessions.teacher, rbac), form(own), store),
      (e: unknown) => refused(403)(e) && /not enabled for you in the app/.test((e as Error).message),
    );
    assert.equal(stored.length, 0);
  });

  await check("upload: a parent session → 403, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    const hh = fx.sis.students.find((s) => s.classId === own.classId && s.sectionId === own.sectionId)!.householdId;
    const parent = ctxFor({ persona: "parent", fullName: "P", roleCode: "parent", householdId: hh, tenantSlug: "bhb-international", academicYearCode: "2026-27" });
    await assert.rejects(mod.uploadHomeworkAttachment(parent, form(own), store), refused(403));
    assert.equal(stored.length, 0);
  });

  await check("upload: not a photo or PDF → 400, nothing stored", async () => {
    assert.ok(mod, "upload module exists");
    stored.length = 0;
    const exe = new File([JPEG], "worksheet.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    await assert.rejects(mod.uploadHomeworkAttachment(teacher, form(own, exe), store), refused(400));
    assert.equal(stored.length, 0);
  });

  await check("post: only files from THIS section's homework folder are accepted", () => {
    assert.ok(pure && uploaded, "attachment contract + an uploaded ref");
    const ok = pure.validateHomeworkAttachmentRefs([uploaded], own.classId, own.sectionId);
    assert.ok(ok.ok, "own section's upload accepted");
    const bad = [
      [uploaded], // posted to another section
    ];
    for (const refs of bad) {
      assert.equal(pure.validateHomeworkAttachmentRefs(refs, other.classId, other.sectionId).ok, false, "another section's file");
    }
    for (const url of [
      "/api/file/staff/E001/photo-1.jpg",
      `/api/file/homework/${own.classId}/${own.sectionId}/../../staff/x.jpg`,
      "data:image/jpeg;base64,AAAA",
      "https://example.com/x.jpg",
      `/api/file/homework/${own.classId}/${own.sectionId}/x.docx`,
    ]) {
      assert.equal(pure.validateHomeworkAttachmentRefs([{ id: "a", label: "x", url }], own.classId, own.sectionId).ok, false, url);
    }
    assert.equal(
      pure.validateHomeworkAttachmentRefs(Array.from({ length: 11 }, () => uploaded), own.classId, own.sectionId).ok,
      false,
      "more than 10 files",
    );
  });

  await check("readers: an app-made post renders its files exactly as a web-made one", () => {
    assert.ok(pure && uploaded, "attachment contract + an uploaded ref");
    const app = { id: "hw_app", attachments: [uploaded] };
    const web = { id: "hw_web", attachments: [{ id: "att_1", label: "sheet.jpg", url: "data:image/jpeg;base64,/9j/4AAQ" }] };
    const a = pure.homeworkAttachmentsForReaders(app);
    const w = pure.homeworkAttachmentsForReaders(web);
    assert.deepEqual(Object.keys(a[0]!).sort(), Object.keys(w[0]!).sort(), "same shape");
    assert.equal(a[0]!.kind, "image");
    assert.equal(w[0]!.kind, "image");
    assert.equal(a[0]!.url, `/api/v1/homework/attachment?postId=hw_app&attId=${encodeURIComponent(uploaded.id)}`);
    assert.equal(w[0]!.url, "/api/v1/homework/attachment?postId=hw_web&attId=att_1");
    assert.ok(!a[0]!.url.startsWith("/api/file/"), "never the staff-only reference");
    const pdf = pure.homeworkAttachmentsForReaders({ id: "p", attachments: [{ id: "x", label: "Sheet", url: `/api/file/homework/${own.classId}/${own.sectionId}/2026-10-20-ab.pdf` }] });
    assert.equal(pdf[0]!.kind, "pdf");
    const link = pure.homeworkAttachmentsForReaders({ id: "l", attachments: [{ id: "y", label: "Link", url: "https://example.org/w.pdf" }] });
    assert.deepEqual(link[0], { id: "y", label: "Link", kind: "link", url: "https://example.org/w.pdf" });
    // The serve route reads storage only from the homework folder.
    assert.equal(pure.homeworkAttachmentSource("/api/file/staff/E001/sig.png").kind, "none");
  });

  await check("reader check: a parent with a child in the section may open it; another parent may not", async () => {
    assert.ok(mod, "upload module exists");
    const post = { ...own, academicYearCode: "2026-27" };
    const inSection = fx.sis.students.find((s) => s.classId === own.classId && s.sectionId === own.sectionId)!;
    const elsewhere = fx.sis.students.find(
      (s) => !fx.sis.students.some((t) => t.householdId === s.householdId && t.classId === own.classId && t.sectionId === own.sectionId),
    )!;
    const parent = (hh: string) =>
      ctxFor({ persona: "parent", fullName: "P", roleCode: "parent", householdId: hh, tenantSlug: "bhb-international", academicYearCode: "2026-27" });
    await mod.assertHomeworkAttachmentReader(parent(inSection.householdId), post, fx.sis.students);
    await assert.rejects(mod.assertHomeworkAttachmentReader(parent(elsewhere.householdId), post, fx.sis.students), refused(403));
    await mod.assertHomeworkAttachmentReader(teacher, post, fx.sis.students);
    await assert.rejects(mod.assertHomeworkAttachmentReader(teacher, { ...other }, fx.sis.students), refused(403));
  });

  await check("routes exist", () => {
    for (const rel of [
      "../app/api/v1/staff/homework/attachment/route.ts",
      "../app/api/v1/homework/attachment/route.ts",
    ]) {
      assert.ok(existsSync(resolve(__dirname, rel)), rel);
    }
  });

  console.warn = quietWarn;
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nhomework attachments: all checks passed");
  process.exit(0);
})();
