/**
 * School chat — membership, blocks and the message check (pure parts).
 * npm run test:school-chat
 */
import assert from "node:assert/strict";
import {
  allGroups,
  blockVerdict,
  classGroupId,
  groupFor,
  isRepeatOffender,
  parentDmId,
  parseConversationId,
  sectionGroups,
  staffDmId,
  staffForChild,
  staffGroups,
  subjectGroupId,
  type ChatBlock,
  type ChatRoster,
} from "./schoolChat";
import { defaultRbacState, hasFeaturePermission } from "./rbac";
import { emptyMastersShell } from "./masters";
import { checkRules, heldNotice, moderateMessage, parseModerationVerdict, type Classifier } from "./schoolChatModeration";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const AY = "2026-27";
const roster: ChatRoster = {
  ay: AY,
  classes: [
    { id: "c5", name: "V", sortOrder: 5 },
    { id: "c6", name: "VI", sortOrder: 6 },
  ],
  sections: [
    { id: "s5a", classId: "c5", name: "A" },
    { id: "s5b", classId: "c5", name: "B" },
    { id: "s6a", classId: "c6", name: "A" },
  ],
  subjects: [
    { id: "eng", nameEn: "English" },
    { id: "math", nameEn: "Mathematics" },
    { id: "sci", nameEn: "Science" },
    { id: "sci_p", nameEn: "Science — Practical", parentId: "sci" },
    { id: "gk", nameEn: "GK" },
  ],
  staff: [
    { id: "ct5a", fullName: "Class Teacher 5A", classTeacherLinks: [{ classId: "c5", sectionId: "s5a", academicYearCode: AY }], subjectTeachingLinks: [{ classId: "c5", sectionId: "s5a", subjectId: "eng", academicYearCode: AY }] },
    { id: "math5", fullName: "Maths Teacher", subjectTeachingLinks: [{ classId: "c5", sectionId: null, subjectId: "math", academicYearCode: AY }] },
    { id: "sci5a", fullName: "Science Teacher", subjectTeachingLinks: [{ classId: "c5", sectionId: "s5a", subjectId: "sci_p", academicYearCode: AY }] },
    { id: "old", fullName: "Last year", classTeacherLinks: [{ classId: "c6", sectionId: "s6a", academicYearCode: "2025-26" }] },
    { id: "gone", fullName: "Left", status: "inactive", subjectTeachingLinks: [{ classId: "c6", sectionId: "s6a", subjectId: "eng", academicYearCode: AY }] },
    { id: "tt", fullName: "Timetable Only" },
    { id: "coord", fullName: "Coordinator" },
  ],
  grids: [{ academicYearCode: AY, classId: "c5", sectionId: "s5b", slots: [{ teacherId: "tt", subjectId: "gk" }] }],
  coordinators: new Map([["c5|s5a", "coord"]]),
};

async function main() {
await t("ids round-trip; DMs are sorted; junk is refused", () => {
  assert.deepEqual(parseConversationId(classGroupId(AY, "c5", "s5a")), { kind: "class", ay: AY, classId: "c5", sectionId: "s5a" });
  assert.deepEqual(parseConversationId(subjectGroupId(AY, "c5", "s5a", "eng")), { kind: "subject", ay: AY, classId: "c5", sectionId: "s5a", subjectId: "eng" });
  assert.equal(staffDmId("b", "a"), "dms:a:b");
  assert.equal(parseConversationId("dms:b:a"), null, "an unsorted pair is not an id this server makes");
  assert.deepEqual(parseConversationId(parentDmId("ct5a", "stu1")), { kind: "dm_parent", staffId: "ct5a", studentId: "stu1" });
  assert.equal(parseConversationId("dmx:stu1:stu2"), null, "there is no student-to-student kind");
  assert.equal(parseConversationId("cls:2026-27:c5"), null);
  assert.equal(parseConversationId("cls:2026-27:c5:s5a;drop"), null);
  assert.throws(() => staffDmId("a", "a"));
  assert.throws(() => classGroupId(AY, "c5", "s5a:x"));
});

await t("class group = class teacher + co-ordinator; subject groups only where a teacher exists", () => {
  const g = sectionGroups(roster, "c5", "s5a");
  const cls = g.find((x) => x.kind === "class")!;
  assert.deepEqual(cls.staffIds, ["coord", "ct5a"]);
  const subj = Object.fromEntries(g.filter((x) => x.kind === "subject").map((x) => [x.subjectId, x.staffIds]));
  assert.deepEqual(subj, { eng: ["ct5a"], math: ["math5"], sci: ["sci5a"] }, "a component (Science — Practical) is its head subject; a class-wide link covers every section");
  assert.equal(cls.title, "V-A · Class group");
});

await t("a section with no class teacher has no class group; timetable gives a subject group", () => {
  const g = sectionGroups(roster, "c5", "s5b");
  assert.equal(g.some((x) => x.kind === "class"), false, "teachers present, or no group");
  assert.deepEqual(g.map((x) => x.subjectId).sort(), ["gk", "math"]);
});

await t("last year's links and inactive staff give nothing", () => {
  assert.deepEqual(sectionGroups(roster, "c6", "s6a"), []);
  assert.deepEqual(staffGroups(roster, "old"), []);
  assert.deepEqual(staffGroups(roster, "gone"), []);
});

await t("a teacher is in only the groups they teach", () => {
  assert.deepEqual(staffGroups(roster, "math5").map((g) => g.id), [subjectGroupId(AY, "c5", "s5a", "math"), subjectGroupId(AY, "c5", "s5b", "math")]);
  assert.deepEqual(staffGroups(roster, "sci5a").map((g) => g.id), [subjectGroupId(AY, "c5", "s5a", "sci")]);
  assert.equal(staffGroups(roster, "ct5a").some((g) => g.subjectId === "math"), false, "class teacher is not in other subjects' groups");
  assert.equal(allGroups(roster).length, sectionGroups(roster, "c5", "s5a").length + sectionGroups(roster, "c5", "s5b").length);
});

await t("groupFor refuses other years and groups that no longer exist", () => {
  assert.ok(groupFor(roster, { kind: "subject", ay: AY, classId: "c5", sectionId: "s5a", subjectId: "eng" }));
  assert.equal(groupFor(roster, { kind: "subject", ay: AY, classId: "c5", sectionId: "s5a", subjectId: "gk" }), null);
  assert.equal(groupFor(roster, { kind: "class", ay: "2025-26", classId: "c5", sectionId: "s5a" }), null);
  assert.equal(groupFor(roster, { kind: "class", ay: AY, classId: "c6", sectionId: "s5a" }), null, "a section belongs to its class");
});

await t("a family may DM the child's teachers only", () => {
  assert.deepEqual(staffForChild(roster, "c5", "s5a"), ["coord", "ct5a", "math5", "sci5a"]);
  assert.equal(staffForChild(roster, "c5", "s5a").includes("tt"), false);
});

await t("blocks: block beats mute; school-wide applies everywhere; scoped only there", () => {
  const b = (over: Partial<ChatBlock>): ChatBlock => ({ id: "x", subjectKind: "student", subjectId: "stu1", mode: "mute", conversationId: "", reason: "r", createdAt: "", createdByName: "", ...over });
  const me = [{ kind: "student" as const, id: "stu1" }, { kind: "household" as const, id: "hh1" }];
  assert.deepEqual(blockVerdict([], me, "c1"), { canRead: true, canSend: true, by: null });
  assert.equal(blockVerdict([b({})], me, "c1").canSend, false);
  assert.equal(blockVerdict([b({})], me, "c1").canRead, true);
  assert.equal(blockVerdict([b({ mode: "block" }), b({})], me, "c1").canRead, false);
  assert.equal(blockVerdict([b({ conversationId: "c2" })], me, "c1").canSend, true, "a mute in another chat does not bite here");
  assert.equal(blockVerdict([b({ subjectKind: "household", subjectId: "hh1", mode: "block" })], me, "c1").canRead, false, "a family block covers the child's login");
  assert.equal(blockVerdict([b({ subjectId: "stu2" })], me, "c1").canSend, true);
  assert.equal(blockVerdict([b({ subjectKind: "staff" })], me, "c1").canSend, true, "kind must match too");
});

await t("repeat offender", () => {
  assert.equal(isRepeatOffender({ held: 1, removed: 2, warned: 1 }), true);
  assert.equal(isRepeatOffender({ held: 5, removed: 0, warned: 0 }), true);
  assert.equal(isRepeatOffender({ held: 4, removed: 1, warned: 1 }), false);
});

await t("rules: English, Hinglish, Devanagari, disguised spellings", () => {
  for (const [text, cat] of [
    ["you are a f*ck", ""],
    ["you fuuuuck off", "abuse"],
    ["sh1t homework", "abuse"],
    ["abe chutiye kya kar raha", "abuse"],
    ["BHENCHOD", "abuse"],
    ["तू चूतिया है", "abuse"],
    ["send nudes", "sexual"],
    ["kal school ke baad maar dunga tujhe", "threat"],
    ["मैं तुझे जान से मार दूंगा", "threat"],
    ["I want to die", "self_harm"],
    ["mujhe aatmhatya karni hai", "self_harm"],
    ["मैं मरना चाहता हूँ", "self_harm"],
  ] as const) {
    const r = checkRules(text);
    if (cat) assert.ok(r.categories.includes(cat), `${text} → ${cat} (got ${r.categories.join(",")})`);
  }
});

await t("rules: personal details", () => {
  for (const text of [
    "call me 98765 43210",
    "mera number +91-9876543210 hai",
    "९८७६५४३२१० pe whatsapp karo",
    "mail me at kid.one@gmail.com",
    "house no 12, gali 3, Testpur 226001",
    "my insta is @cool_kid_07",
  ]) {
    assert.ok(checkRules(text).categories.includes("personal_info"), text);
  }
});

await t("rules: ordinary school talk passes (no false alarms on common words)", () => {
  for (const text of [
    "Ma'am, is the maths homework page 42 or 43?",
    "class kal 8 baje hai na?",
    "Happy birthday Riya!!",
    "chhod do yaar, kal karenge",
    "bc I forgot my book",
    "Assignment due 2026-10-21, roll no 1234567",
    "The answer is 12345",
    "glass, class, assess, passed",
    "गृहकार्य कल जमा करना है",
  ]) {
    assert.deepEqual(checkRules(text).categories, [], text);
  }
});

await t("parser: strict; anything odd is null; allow+category becomes hold", () => {
  assert.deepEqual(parseModerationVerdict('{"verdict":"allow","categories":[],"reason":""}'), { verdict: "allow", categories: [], reason: "" });
  assert.deepEqual(parseModerationVerdict('{"verdict":"HOLD","categories":["bullying","made_up"],"reason":"mocking"}'), { verdict: "hold", categories: ["bullying"], reason: "mocking" });
  assert.equal(parseModerationVerdict('{"verdict":"hold"}')!.categories[0], "other");
  assert.equal(parseModerationVerdict('{"verdict":"allow","categories":["threat"]}')!.verdict, "hold");
  assert.equal(parseModerationVerdict("allow"), null);
  assert.equal(parseModerationVerdict('{"verdict":"maybe"}'), null);
  assert.equal(parseModerationVerdict("[]"), null);
  assert.equal(parseModerationVerdict(""), null);
});

}

const allow: Classifier = async () => ({ ok: true, verdict: { verdict: "allow", categories: [], reason: "" }, engine: "test" });
const hold: Classifier = async () => ({ ok: true, verdict: { verdict: "hold", categories: ["bullying"], reason: "x" } });
const down: Classifier = async () => ({ ok: false, error: "Set OPENAI_API_KEY or GEMINI_API_KEY on the server" });
const throws: Classifier = async () => {
  throw new Error("network");
};
let asked = 0;
const counting: Classifier = async (...a) => {
  asked += 1;
  return allow(...a);
};

async function main2() {
await t("moderateMessage: fail closed, rules first, staff never held", async () => {
  assert.equal((await moderateMessage("see you tomorrow", { sender: "student", where: "g", classify: allow })).status, "visible");
  const h = await moderateMessage("you look funny", { sender: "student", where: "g", classify: hold });
  assert.equal(h.status, "held");
  assert.equal(h.logAction, "held_by_ai");
  for (const c of [down, throws]) {
    const r = await moderateMessage("see you tomorrow", { sender: "parent", where: "g", classify: c });
    assert.equal(r.status, "held", "AI failure must hold");
    assert.equal(r.logAction, "held_ai_unavailable");
  }
  asked = 0;
  const rules = await moderateMessage("abe chutiye", { sender: "student", where: "g", classify: counting });
  assert.equal(rules.status, "held");
  assert.equal(rules.logAction, "held_by_rules");
  assert.equal(asked, 0, "a rules hit does not ask the model");
  const staff = await moderateMessage("call me on 9876543210", { sender: "staff", where: "g", classify: down });
  assert.equal(staff.status, "visible");
  assert.equal(staff.flagged, true);
  assert.equal((await moderateMessage("Homework: page 4", { sender: "staff", where: "g", classify: down })).logAction, "passed");
});

await t("moderation is a real function: principal / owner / admin by default, not teacher or office", () => {
  const rbac = defaultRbacState();
  const masters = emptyMastersShell();
  const as = (roleCode: string) => ({ persona: "staff" as const, fullName: "X", roleCode, staffId: "", tenantSlug: "t", academicYearCode: AY });
  for (const r of ["owner", "principal", "admin"]) assert.equal(hasFeaturePermission(as(r), masters, "discipline.chat_moderate", "approve", rbac), true, r);
  for (const r of ["teacher", "office", "accounts"]) assert.equal(hasFeaturePermission(as(r), masters, "discipline.chat_moderate", "approve", rbac), false, r);
  const withGrant = { ...rbac, roles: rbac.roles.map((x) => (x.code === "teacher" ? { ...x, featureGrants: [...(x.featureGrants ?? []), { feature: "discipline.chat_moderate", actions: ["view" as const, "approve" as const] }] } : x)) };
  assert.equal(hasFeaturePermission(as("teacher"), masters, "discipline.chat_moderate", "approve", withGrant), true, "assignable in Masters → Roles");
});

await t("held notice: self-harm gets a helpline", () => {
  assert.match(heldNotice(["self_harm"]), /14416/);
  assert.doesNotMatch(heldNotice(["abuse"]), /14416/);
});

console.log(`school-chat selftest: ${passed} passed`);
}

main()
  .then(main2)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
