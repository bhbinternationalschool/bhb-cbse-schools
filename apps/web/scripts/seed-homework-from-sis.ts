#!/usr/bin/env npx tsx
/**
 * Seed homework_desk_* from active SIS students (one post + diary per class-section).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-homework-from-sis.ts
 */

import {
  emptyHomeworkState,
  type DiaryEntry,
  type HomeworkPost,
  type HomeworkState,
} from "../src/lib/homework";
import { DEFAULT_AY, loadMasters } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchHomeworkDeskFromDb,
  pushHomeworkDeskToDb,
} from "../src/lib/homeworkNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function groupKey(classId: string, sectionId: string) {
  return `${classId}::${sectionId}`;
}

async function main() {
  const date = todayYmd();
  const masters = loadMasters();
  const subject = (masters.subjects ?? []).find(
    (s) => s.isActive !== false && !s.parentId,
  );
  const staff = (masters.staff ?? []).find((s) => s.status === "active");
  const teacherName = staff?.fullName || "Class teacher";
  const teacherStaffId = staff?.id || "";
  const subjectId = subject?.id || "";
  const subjectName = subject?.nameEn || "Subject";

  const { bundle } = await fetchSisFromDb();
  const active = bundle.students.filter(
    (s) => s.status === "active" && s.classId && s.sectionId,
  );
  if (!active.length) {
    throw new Error("No active SIS students with class/section — seed SIS first.");
  }

  const bySection = new Map<string, typeof active>();
  for (const s of active) {
    const key = groupKey(s.classId, s.sectionId);
    const list = bySection.get(key) ?? [];
    list.push(s);
    bySection.set(key, list);
  }

  const now = new Date().toISOString();
  const posts: HomeworkPost[] = [];
  const diary: DiaryEntry[] = [];

  for (const [, students] of bySection) {
    const sample = students[0]!;
    const ay = sample.academicYearCode || DEFAULT_AY;
    posts.push({
      id: `hw_seed_${sample.classId}_${sample.sectionId}_${date}`,
      academicYearCode: ay,
      classId: sample.classId,
      sectionId: sample.sectionId,
      subjectId,
      teacherStaffId,
      teacherName,
      date,
      title: `${subjectName} — practice`,
      bodyEn: "Complete exercises from today's lesson. Show working in notebook.",
      bodyHi: "आज के पाठ से अभ्यास पूरा करें। नोटबुक में कार्य दिखाएँ।",
      attachments: [],
      dueAt: date,
      requiresSubmit: true,
      aiTutorHint: subject?.code || "",
      status: "published",
      createdAt: now,
      whatsappNotifiedAt: "",
      whatsappNotifiedCount: 0,
    });
    diary.push({
      id: `dy_seed_${sample.classId}_${sample.sectionId}_${date}`,
      academicYearCode: ay,
      classId: sample.classId,
      sectionId: sample.sectionId,
      teacherStaffId,
      teacherName,
      date,
      title: "Class diary",
      bodyEn: "Assembly reminder — bring notebook tomorrow.",
      bodyHi: "कल असेंबली के लिए कॉपी लाएँ।",
      createdAt: now,
    });
  }

  const state: HomeworkState = {
    ...emptyHomeworkState(),
    posts,
    diary,
  };

  console.log(`Seeding ${posts.length} posts + ${diary.length} diary entries`);

  const before = await fetchHomeworkDeskFromDb();
  console.log(`DB before: ${before.bundle.posts.length} posts`);

  const result = await pushHomeworkDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchHomeworkDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.posts.length} posts, ${after.bundle.diary.length} diary entries`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
