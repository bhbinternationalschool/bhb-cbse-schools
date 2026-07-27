/**
 * Run: npx tsx src/lib/erpChat.selftest.ts
 */
import assert from "node:assert/strict";
import {
  actorCanPost,
  classAnnouncementThreadId,
  emptyErpChatState,
  findOrCreateClassAnnouncement,
  findOrCreateStaffDm,
  findOrCreateStaffParentDm,
  mergeErpChatStates,
  normalizeErpChatState,
  staffDmThreadId,
  staffParentDmThreadId,
  unreadInThread,
  type ErpChatState,
} from "./erpChat";
import {
  canStaffChatWithParent,
  isOfficeLike,
  isTeacherOnly,
  parentActorKey,
  staffAllowedSections,
  type ChatActor,
} from "./erpChatAccess";
import type { MastersState } from "./masters";
import type { StaffRecord } from "./foundationMasters";
import type { SisState } from "./sis";

// --- merge / normalize ---
const a: ErpChatState = {
  version: 2,
  threads: [
    {
      id: "t1",
      kind: "staff_dm",
      title: "",
      participantIds: ["s1", "s2"],
      participants: [
        { actorKey: "s1", actorKind: "staff", canPost: true },
        { actorKey: "s2", actorKind: "staff", canPost: true },
      ],
      classId: "",
      sectionId: "",
      householdId: "",
      academicYearCode: "2025-26",
      createdBy: "s1",
      updatedAt: "2025-01-01T00:00:00.000Z",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ],
  messages: [
    {
      id: "m1",
      threadId: "t1",
      fromActorKey: "s1",
      fromActorKind: "staff",
      text: "hi",
      at: "2025-01-01T00:00:00.000Z",
      readBy: ["s1"],
    },
  ],
};
const b: ErpChatState = {
  version: 2,
  threads: [
    {
      ...a.threads[0]!,
      updatedAt: "2025-01-02T00:00:00.000Z",
    },
  ],
  messages: [
    {
      id: "m1",
      threadId: "t1",
      fromActorKey: "s1",
      fromActorKind: "staff",
      text: "hi",
      at: "2025-01-01T00:00:00.000Z",
      readBy: ["s1", "s2"],
    },
    {
      id: "m2",
      threadId: "t1",
      fromActorKey: "s2",
      fromActorKind: "staff",
      text: "hello",
      at: "2025-01-02T00:00:00.000Z",
      readBy: ["s2"],
    },
  ],
};
const merged = mergeErpChatStates(a, b);
assert.equal(merged.messages.length, 2);
assert.ok(merged.messages.find((m) => m.id === "m1")?.readBy.includes("s2"));
assert.equal(merged.threads[0]?.updatedAt, "2025-01-02T00:00:00.000Z");

// legacy v1 import
const legacy = normalizeErpChatState({
  version: 1,
  threads: [{ id: "x", participantIds: ["a", "b"], updatedAt: "t" }],
  messages: [
    {
      id: "lm1",
      threadId: "x",
      fromStaffId: "a",
      text: "legacy",
      at: "t",
      readBy: ["a"],
    },
  ],
});
assert.equal(legacy.version, 2);
assert.equal(legacy.threads[0]?.kind, "staff_dm");
assert.equal(legacy.messages[0]?.fromActorKey, "a");

assert.equal(staffDmThreadId("b", "a"), staffDmThreadId("a", "b"));
assert.ok(staffParentDmThreadId("s1", "h1").includes("h1"));
assert.ok(classAnnouncementThreadId("2025-26", "sec1").includes("sec1"));

// announcement read-only for parents
const ann = findOrCreateClassAnnouncement({
  section: {
    classId: "c1",
    sectionId: "sec1",
    className: "I",
    sectionName: "A",
    label: "I-A",
  },
  academicYearCode: "2025-26",
  createdBy: "teacher1",
  parentHouseholdIds: ["hh1"],
  state: emptyErpChatState(),
});
const parentKey = parentActorKey("hh1");
assert.equal(actorCanPost(ann.thread, "teacher1"), true);
assert.equal(actorCanPost(ann.thread, parentKey), false);

const dm = findOrCreateStaffDm("s1", "s2", emptyErpChatState());
assert.equal(dm.thread.participantIds.length, 2);

const sp = findOrCreateStaffParentDm({
  staffId: "s1",
  householdId: "hh1",
  academicYearCode: "2025-26",
  state: emptyErpChatState(),
});
assert.equal(sp.thread.kind, "staff_parent_dm");

const withUnread: ErpChatState = {
  ...sp.state,
  messages: [
    {
      id: "u1",
      threadId: sp.thread.id,
      fromActorKey: "s1",
      fromActorKind: "staff",
      text: "fee reminder",
      at: "2025-01-03T00:00:00.000Z",
      readBy: ["s1"],
    },
  ],
};
assert.equal(unreadInThread(sp.thread.id, parentKey, withUnread), 1);
assert.equal(unreadInThread(sp.thread.id, "s1", withUnread), 0);

assert.equal(isOfficeLike(["principal"]), true);
assert.equal(isTeacherOnly(["teacher"]), true);
assert.equal(isTeacherOnly(["teacher", "principal"]), false);

// sectionless subject link covers all sections of class
const masters = {
  classes: [{ id: "c1", name: "I", isActive: true }],
  sections: [
    { id: "secA", classId: "c1", name: "A", isActive: true },
    { id: "secB", classId: "c1", name: "B", isActive: true },
  ],
  staff: [] as StaffRecord[],
} as unknown as MastersState;

const teacher = {
  id: "t1",
  fullName: "Teacher One",
  status: "active",
  classTeacherLinks: [],
  subjectTeachingLinks: [
    {
      classId: "c1",
      sectionId: "",
      subjectId: "sub1",
      academicYearCode: "2025-26",
    },
  ],
} as unknown as StaffRecord;

const secs = staffAllowedSections(teacher, masters, "2025-26", ["teacher"]);
assert.equal(secs.length, 2);

const officeActor: ChatActor = {
  kind: "staff",
  key: "prin1",
  displayName: "Principal",
  staffId: "prin1",
  roleCodes: ["principal"],
};
const sis = {
  households: [
    { id: "hhX", guardianName: "Parent X", mobile: "9999999999" },
  ],
  students: [
    {
      id: "st1",
      householdId: "hhX",
      classId: "c1",
      sectionId: "secA",
      academicYearCode: "2025-26",
      status: "active",
      fullName: "Child X",
    },
  ],
} as unknown as SisState;

// office can see parents when section roster has whatsapp/mobile
assert.equal(
  canStaffChatWithParent(officeActor, "hhX", masters, "2025-26", sis),
  true,
);

const teacherActor: ChatActor = {
  kind: "staff",
  key: "t1",
  displayName: "Teacher One",
  staffId: "t1",
  roleCodes: ["teacher"],
};
// teacher without duty links cannot chat arbitrary parents
assert.equal(
  canStaffChatWithParent(teacherActor, "hhX", masters, "2025-26", sis),
  false,
);

console.log("erpChat.selftest: ok");
