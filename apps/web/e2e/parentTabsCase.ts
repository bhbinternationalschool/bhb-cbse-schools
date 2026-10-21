/**
 * The parent portal's tabs (/parent, 15 Oct 2026): one family's homework,
 * class diary, PTM event, notices, news and gallery, and a second family's —
 * so the spec can show a parent their own and never the other's.
 *
 * Written through the app's own server write paths (pushHomeworkDeskToDb,
 * pushPtmDeskToDb, pushSchoolCommsDeskToDb, pushGalleryDeskToDb), under tsx
 * (scripts/e2e-seed-parent-tabs.ts) for the same reason as transportPaidCase.ts.
 * Leave, complaints and chat are written by the spec itself through the
 * parent's own POST routes, which is part of what it proves.
 */
import { buildFixture, AY_CURRENT } from "./fixture";
import { assertLocalStack } from "./session";
import type { HomeworkState } from "@/lib/homework";
import type { PtmState } from "@/lib/ptm";
import type { SchoolCommsState } from "@/lib/schoolComms";

const fx = buildFixture();
const current = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId);

/** The family the spec signs in as: the first current-year child's. */
export const MINE = current[0]!;
/** Another family, in another section — the one this parent must never see. */
export const OTHER = current.find(
  (s) => s.householdId !== MINE.householdId && `${s.classId}|${s.sectionId}` !== `${MINE.classId}|${MINE.sectionId}`,
)!;
export const MY_CHILDREN = current.filter((s) => s.householdId === MINE.householdId);

export const HW_MINE = "e2e_pt_hw_mine";
export const HW_OTHER = "e2e_pt_hw_other";
export const DIARY_MINE = "e2e_pt_diary_mine";
export const PTM_EVENT = "e2e_pt_ptm_event";
export const PTM_SLOT = "e2e_pt_ptm_slot";
export const NOTICE_PARENTS = "e2e_pt_notice_parents";
export const NOTICE_STAFF = "e2e_pt_notice_staff";
export const NEWS = "e2e_pt_news";
export const ALBUM_SCHOOL = "e2e_pt_album_school";
export const ALBUM_OTHER_CLASS = "e2e_pt_album_other";

const NOW = "2026-10-15T04:30:00.000Z";
const teacher = fx.staff.staff[0]!;

export async function seedParentTabsCase(): Promise<void> {
  assertLocalStack();
  const { pushPtmDeskToDb } = await import("@/lib/ptmNormalized.server");
  const { pushSchoolCommsDeskToDb, pushGalleryDeskToDb } = await import("@/lib/schoolCommsNormalized.server");

  const post = (id: string, s: typeof MINE, title: string) => ({
    id,
    academicYearCode: AY_CURRENT,
    classId: s.classId,
    sectionId: s.sectionId,
    subjectId: "",
    teacherStaffId: teacher.id,
    teacherName: teacher.fullName,
    date: "2026-10-14",
    title,
    bodyEn: `${title} — read chapter 3 and answer questions 1–5.`,
    bodyHi: "",
    attachments: [],
    dueAt: "2026-10-16",
    requiresSubmit: false,
    aiTutorHint: "",
    referenceAnswer: "",
    status: "published" as const,
    createdAt: NOW,
    updatedAt: NOW,
    whatsappNotifiedAt: "",
    whatsappNotifiedCount: 0,
  });
  const homework: HomeworkState = {
    version: 1,
    posts: [post(HW_MINE, MINE, "E2E homework for my class"), post(HW_OTHER, OTHER, "E2E homework for the other class")],
    diary: [
      {
        id: DIARY_MINE,
        academicYearCode: AY_CURRENT,
        classId: MINE.classId,
        sectionId: MINE.sectionId,
        teacherStaffId: teacher.id,
        teacherName: teacher.fullName,
        date: "2026-10-14",
        title: "E2E class diary",
        bodyEn: "Bring the art file tomorrow.",
        bodyHi: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    submissions: [],
    seen: [],
    settings: { examModeFreeze: false },
  };
  // Straight into the desk tables: pushHomeworkDeskToDb writes
  // `reference_answer`, a column production has but no migration in this repo
  // creates, so on a fresh database (this stack) that save fails. The rows are
  // the same ones postToRow/diaryToRow write, minus that column.
  const { getServerTenantContext } = await import("@/lib/serverTenant");
  const tctx = await getServerTenantContext();
  if (!tctx) throw new Error("no tenant");
  const { sb, tenantId } = tctx;
  const pr = await sb.from("homework_desk_posts").upsert(
    homework.posts.map((x) => ({
      id: x.id,
      tenant_id: tenantId,
      academic_year_code: x.academicYearCode,
      class_id: x.classId,
      section_id: x.sectionId,
      subject_id: x.subjectId,
      teacher_staff_id: x.teacherStaffId,
      teacher_name: x.teacherName,
      post_date: x.date,
      title: x.title,
      body_en: x.bodyEn,
      body_hi: x.bodyHi,
      attachments_json: [],
      due_at: x.dueAt,
      requires_submit: x.requiresSubmit,
      ai_tutor_hint: "",
      status: "published",
      created_at: x.createdAt,
    })),
    { onConflict: "id" },
  );
  if (pr.error) throw new Error(`homework posts: ${pr.error.message}`);
  const dr = await sb.from("homework_desk_diary").upsert(
    homework.diary.map((d) => ({
      id: d.id,
      tenant_id: tenantId,
      academic_year_code: d.academicYearCode,
      class_id: d.classId,
      section_id: d.sectionId,
      teacher_staff_id: d.teacherStaffId,
      teacher_name: d.teacherName,
      diary_date: d.date,
      title: d.title,
      body_en: d.bodyEn,
      body_hi: d.bodyHi,
      created_at: d.createdAt,
    })),
    { onConflict: "id" },
  );
  if (dr.error) throw new Error(`homework diary: ${dr.error.message}`);

  const ptm: PtmState = {
    version: 1,
    events: [
      {
        id: PTM_EVENT,
        academicYearCode: AY_CURRENT,
        name: "E2E PTM October",
        date: "2026-10-24",
        endDate: "2026-10-24",
        classIds: [],
        mode: "in_person",
        note: "",
        isActive: true,
        createdAt: NOW,
      },
    ] as PtmState["events"],
    slots: [
      {
        id: PTM_SLOT,
        eventId: PTM_EVENT,
        teacherStaffId: teacher.id,
        teacherName: teacher.fullName,
        startAt: "10:00",
        endAt: "10:10",
        capacity: 5,
        roomOrLink: "Room 4",
      },
    ],
    bookings: [],
    feedback: [],
  };
  const p = await pushPtmDeskToDb(ptm);
  if (!p.ok) throw new Error(`ptm desk: ${p.error}`);

  const notice = (id: string, audience: "parents" | "staff", title: string) => ({
    id,
    title,
    body: `${title} — details.`,
    audience,
    status: "published" as const,
    pinned: false,
    academicYearCode: AY_CURRENT,
    publishedAt: NOW,
    scheduledPublishAt: "",
    createdAt: NOW,
    createdBy: "E2E",
    updatedAt: NOW,
  });
  const comms: SchoolCommsState = {
    version: 1,
    notices: [
      notice(NOTICE_PARENTS, "parents", "E2E notice for parents"),
      notice(NOTICE_STAFF, "staff", "E2E staff-only notice"),
    ] as SchoolCommsState["notices"],
    news: [
      {
        id: NEWS,
        title: "E2E school news",
        summary: "Sports day results",
        body: "The blue house won.",
        coverUrl: "",
        status: "published",
        academicYearCode: AY_CURRENT,
        publishedAt: NOW,
        scheduledPublishAt: "",
        createdAt: NOW,
        createdBy: "E2E",
        updatedAt: NOW,
      },
    ] as SchoolCommsState["news"],
    albums: [],
    photos: [],
  };
  const c = await pushSchoolCommsDeskToDb(comms);
  if (!c.ok) throw new Error(`comms desk: ${c.error}`);

  const album = (id: string, title: string, sectionIds?: string[]) => ({
    id,
    title,
    description: "",
    coverUrl: "",
    status: "published" as const,
    academicYearCode: AY_CURRENT,
    publishedAt: NOW,
    scheduledPublishAt: "",
    createdAt: NOW,
    createdBy: "E2E",
    updatedAt: NOW,
    ...(sectionIds ? { sectionIds, classLabel: "Other class" } : {}),
  });
  const g = await pushGalleryDeskToDb({
    albums: [
      album(ALBUM_SCHOOL, "E2E school album"),
      album(ALBUM_OTHER_CLASS, "E2E other class album", [`${OTHER.classId}|${OTHER.sectionId}`]),
    ] as SchoolCommsState["albums"],
    photos: [
      { id: "e2e_pt_photo_school", albumId: ALBUM_SCHOOL, url: "/icon-192.png", caption: "School", uploadedAt: NOW, uploadedBy: "E2E", reviewStatus: "ok" },
      { id: "e2e_pt_photo_other", albumId: ALBUM_OTHER_CLASS, url: "/icon-192.png", caption: "Other", uploadedAt: NOW, uploadedBy: "E2E", reviewStatus: "ok" },
    ] as SchoolCommsState["photos"],
  });
  if (!g.ok) throw new Error(`gallery desk: ${g.error}`);
}
