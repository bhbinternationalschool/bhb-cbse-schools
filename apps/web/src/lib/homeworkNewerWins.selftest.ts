import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomeworkPost, HomeworkSubmission } from "./homework";

console.log("homeworkNewerWins.selftest.ts");

/**
 * Homework: an older copy (office tab, teacher's phone, or the server's
 * cached desk pushed by a staff-app post) can't undo an edit or withdrawal,
 * blank a teacher's WhatsApp remark, or reset "WhatsApp sent".
 */

type Row = Record<string, unknown> & { id: string };
const tables = new Map<string, Map<string, Row>>();
const t = (n: string) => tables.get(n) ?? tables.set(n, new Map()).get(n)!;
let failRead = false;
const sb = {
  from: (name: string) => {
    let ids: string[] = [];
    let id = "";
    let patch: Row | null = null;
    const q = {
      select: () => q,
      in: (_k: string, v: string[]) => {
        ids = v;
        return q;
      },
      order: () => q,
      range: async () =>
        failRead ? { data: null, error: { message: "timeout" } } : { data: [...t(name).values()].filter((r) => ids.includes(r.id)), error: null },
      upsert: async (rows: Row[], opts?: { ignoreDuplicates?: boolean }) => {
        for (const r of rows) if (!(opts?.ignoreDuplicates && t(name).has(r.id))) t(name).set(r.id, { ...r });
        return { error: null };
      },
      update: (p: Row) => {
        patch = p;
        return q;
      },
      eq: (k: string, v: string) => {
        if (k === "id" && patch) {
          id = v;
          t(name).set(id, { ...t(name).get(id)!, ...patch });
        }
        return q;
      },
    };
    return q;
  },
} as unknown as SupabaseClient;

const post = (id: string, over: Partial<HomeworkPost>): HomeworkPost =>
  ({
    id, academicYearCode: "2026-27", classId: "c", sectionId: "s", subjectId: "", teacherStaffId: "t1", teacherName: "T",
    date: "2026-10-10", title: "Maths", bodyEn: "Ex 1", bodyHi: "", attachments: [], dueAt: "", requiresSubmit: false,
    aiTutorHint: "", referenceAnswer: "", status: "published", createdAt: "2026-10-10T08:00:00Z", updatedAt: "2026-10-10T08:00:00Z",
    whatsappNotifiedAt: "", whatsappNotifiedCount: 0, ...over,
  }) as HomeworkPost;
const sub = (over: Partial<HomeworkSubmission>): HomeworkSubmission =>
  ({ id: "x1", postId: "p1", studentId: "st", note: "", photoUrl: "u", submittedAt: "2026-10-10T09:00:00Z", teacherAckAt: "", teacherAckBy: "", ...over }) as HomeworkSubmission;

void (async () => {
  const { writeHomeworkLists } = await import("./homeworkNormalized.server");
  const P = "homework_desk_posts";
  const S = "homework_desk_submissions";

  // Stored: p1 withdrawn at 10:00 and WhatsApp-sent to 30 families at 09:00.
  t(P).set("p1", { id: "p1", status: "withdrawn", updated_at: "2026-10-10T10:00:00.000+00:00", whatsapp_notified_at: "2026-10-10T09:00:00.000+00:00", whatsapp_notified_count: 30 });
  // Stored: p2 at 08:00, WhatsApp sent at 09:00 (a direct stamp, updated_at unchanged).
  t(P).set("p2", { id: "p2", status: "published", title: "Science", updated_at: "2026-10-10T08:00:00.000+00:00", whatsapp_notified_at: "2026-10-10T09:00:00.000+00:00", whatsapp_notified_count: 28 });
  // Stored: a submission the teacher remarked on over WhatsApp at 11:00.
  t(S).set("x1", { id: "x1", teacher_ack_at: "2026-10-10T11:00:00Z", teacher_remark: "Well done", remark_at: "2026-10-10T11:00:00Z", drive_note: "" });

  const r = await writeHomeworkLists(sb, "t", {
    posts: [
      post("p1", { status: "published" }), // stale (08:00): can't un-withdraw
      post("p2", { title: "Science — ch 4" , updatedAt: "2026-10-10T12:00:00Z" }), // a real, later edit; its copy predates the WhatsApp stamp
      post("p3", { updatedAt: "" }), // new, from an older build
    ],
    diary: [],
    submissions: [sub({}), sub({ id: "x2" })], // stale x1 with no remark; new x2
    seen: [{ id: "sn1", kind: "post", refId: "p1", studentId: "st", householdId: "", seenAt: "2026-10-10T09:30:00Z" }],
  });
  assert.ok(r.ok);
  assert.equal(t(P).get("p1")!.status, "withdrawn", "a stale copy can't un-withdraw");
  assert.equal(t(P).get("p2")!.title, "Science — ch 4", "a later edit lands");
  assert.equal(t(P).get("p2")!.whatsapp_notified_count, 28, "…but can't reset WhatsApp sent");
  assert.ok(t(P).get("p3")!.updated_at, "a new post gets a time");
  assert.equal(t(S).get("x1")!.teacher_remark, "Well done", "a stale copy can't blank the WhatsApp remark");
  assert.ok(t(S).has("x2"));
  assert.ok(t("homework_desk_seen").has("sn1"));

  // A newer acknowledgement from the desk does land; the remark stays.
  await writeHomeworkLists(sb, "t", { posts: [], diary: [], seen: [], submissions: [sub({ teacherAckAt: "2026-10-10T12:00:00Z", teacherAckBy: "Office" })] });
  assert.equal(t(S).get("x1")!.teacher_ack_by, "Office");
  assert.equal(t(S).get("x1")!.teacher_remark, "Well done");

  // A copy without updatedAt never overwrites a stored post.
  await writeHomeworkLists(sb, "t", { posts: [post("p2", { title: "old build", updatedAt: "" })], diary: [], submissions: [], seen: [] });
  assert.equal(t(P).get("p2")!.title, "Science — ch 4");

  failRead = true;
  const bad = await writeHomeworkLists(sb, "t", { posts: [post("p4", {})], diary: [], submissions: [], seen: [] });
  assert.equal(bad.ok, false, "a failed read writes nothing");
  assert.equal(t(P).has("p4"), false);

  // ── Wiring ─────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const src = read("homeworkNormalized.server.ts");
  assert.equal((src.match(/await writeHomeworkLists\(sb, tenantId, /g) ?? []).length, 2, "office and teacher saves both write through it");
  assert.ok(/updated_at: p\.updatedAt \|\| ""/.test(src) && /updated_at: d\.updatedAt \|\| ""/.test(src), "rows carry the item's own time");
  assert.ok(/touchHomeworkMeta\(sb, tenantId, now\)/.test(src));
  const hw = read("homework.ts");
  assert.ok(/status: "withdrawn", updatedAt: nowIso\(\)/.test(hw), "withdrawing moves the time");
  assert.ok((hw.match(/updatedAt: nowIso\(\),/g) ?? []).length >= 5, "create, import, edit (post + diary) move the time");

  console.log("homeworkNewerWins.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
