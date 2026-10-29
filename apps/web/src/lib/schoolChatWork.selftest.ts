/**
 * School chat work posts (homework / classwork / notice) — guards that read
 * the source: one record, one WhatsApp.
 * npm run test:school-chat-work
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardText, workForGroup, type WorkCard, type WorkItem } from "./schoolChatWork";

const src = readFileSync(join(__dirname, "schoolChatWork.server.ts"), "utf8");
let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

ok("homework goes through postHomeworkServer exactly once (its WhatsApp claim is the only send)", () => {
  assert.equal(src.match(/postHomeworkServer\(\{/g)?.length, 1);
});
ok("the chat sends no WhatsApp of its own", () => {
  assert.doesNotMatch(src, /homeworkWa\.server|sendWaWithFailover|sendHomeworkWhatsApp|classNoticeWa|waDispatch/);
});
ok("the chat never writes a copy of a homework post into school_chat_messages", () => {
  assert.doesNotMatch(src, /from\("school_chat_messages"\)\s*\.insert|school_chat_post/);
});
ok("a card never carries the reference answer", () => {
  assert.doesNotMatch(src, /referenceAnswer\s*:/);
});

const card = (kind: WorkCard["kind"], subjectId: string): WorkCard => ({
  kind, refId: `${kind}-${subjectId}`, subjectId, subject: subjectId ? "Maths" : "", title: "Ex 5.2", body: "Q1-5", bodyHi: "", dueAt: kind === "homework" ? "2026-11-02" : "",
  date: "2026-10-29", attachments: [], teacherStaffId: "t1", teacherName: "Mrs Rao",
});
const items: WorkItem[] = [
  { card: card("homework", "math"), classId: "c1", sectionId: "s1", createdAt: "2026-10-29T05:00:00Z" },
  { card: card("homework", "eng"), classId: "c1", sectionId: "s1", createdAt: "2026-10-29T04:00:00Z" },
  { card: card("classwork", ""), classId: "c1", sectionId: "s1", createdAt: "2026-10-29T03:00:00Z" },
  { card: card("homework", "math"), classId: "c1", sectionId: "s2", createdAt: "2026-10-29T02:00:00Z" },
];
ok("a class group shows every subject's homework and the classwork of its own section only", () => {
  const got = workForGroup(items, { kind: "class", classId: "c1", sectionId: "s1", subjectId: "" });
  assert.equal(got.length, 3);
});
ok("a subject group shows that subject's homework only", () => {
  const got = workForGroup(items, { kind: "subject", classId: "c1", sectionId: "s1", subjectId: "math" });
  assert.deepEqual(got.map((i) => i.card.refId), ["homework-math"]);
});
ok("the text a card stands for names the kind, the subject and the due date", () => {
  assert.equal(cardText(card("homework", "math")), "Homework · Maths: Ex 5.2 (due 2026-11-02)\nQ1-5");
  assert.equal(cardText(card("classwork", "")), "Classwork: Ex 5.2\nQ1-5");
});
console.log(`school-chat-work selftest: ${passed} passed`);
