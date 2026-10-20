/**
 * School chat — membership, blocks and the message check (pure parts).
 * npm run test:school-chat
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allGroups,
  blockVerdict,
  classGroupId,
  groupFor,
  isRepeatOffender,
  CHAT_RATE_LIMIT,
  parentDmId,
  pushAudience,
  pushAudienceSubjects,
  rateLimitRefusal,
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
import { admitThenModerate, checkRules, heldNotice, moderateMessage, parseModerationVerdict, type Classifier } from "./schoolChatModeration";

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
await t("moderateMessage: fail closed, rules first", async () => {
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
});

// Review of PR #679, item 2: the director's rule has no staff exception.
await t("staff: the AI check runs; a word-list hit or an abusive verdict HOLDS like a family's", async () => {
  asked = 0;
  const ok = await moderateMessage("Homework: page 4", { sender: "staff", where: "g", classify: counting });
  assert.equal(asked, 1, "a staff message is checked by the model too");
  assert.equal(ok.status, "visible");
  assert.equal(ok.logAction, "passed");

  const rules = await moderateMessage("call me on 9876543210", { sender: "staff", where: "g", classify: allow });
  assert.equal(rules.status, "held", "a staff word-list hit is held before delivery, not posted-and-flagged");
  assert.equal(rules.logAction, "held_by_rules");
  const abuse = await moderateMessage("abe chutiye", { sender: "staff", where: "g", classify: allow });
  assert.equal(abuse.status, "held");

  const ai = await moderateMessage("you look funny", { sender: "staff", where: "g", classify: hold });
  assert.equal(ai.status, "held", "an abusive model verdict holds a staff message");
  assert.equal(ai.logAction, "held_by_ai");
  assert.deepEqual(ai.categories, ["bullying"]);
});

await t("staff: AI down/throws = delivered but FLAGGED for review (director to confirm); families stay fail-closed", async () => {
  for (const c of [down, throws]) {
    const s = await moderateMessage("Homework: page 4", { sender: "staff", where: "g", classify: c });
    assert.equal(s.status, "visible", "a teacher is not silenced by an AI outage");
    assert.equal(s.flagged, true, "...but the message goes to the review queue");
    assert.equal(s.logAction, "flagged_ai_unavailable");
    assert.equal(s.by, "ai_unavailable");
    for (const sender of ["student", "parent"] as const) {
      const f = await moderateMessage("Homework: page 4", { sender, where: "g", classify: c });
      assert.equal(f.status, "held", `${sender}: fail closed`);
      assert.notEqual(f.flagged, true);
    }
  }
  assert.match(heldNotice(["abuse"], "staff"), /moderator/);
});

// Review item 1: a blocked member gets no push (no sender, no preview); a muted one still does.
await t("push audience: blocks remove members from a group push; mutes do not", () => {
  const b = (over: Partial<ChatBlock>): ChatBlock => ({ id: "x", subjectKind: "household", subjectId: "hh2", mode: "block", conversationId: "", reason: "r", createdAt: "", createdByName: "", ...over });
  const conv = classGroupId(AY, "c5", "s5a");
  const kids = [
    { id: "k1", householdId: "hh1" },
    { id: "k2", householdId: "hh2" },
    { id: "k3", householdId: "hh3" },
    { id: "k4", householdId: "hh4" },
    { id: "k4b", householdId: "hh4" }, // twins
    { id: "k5", householdId: "hh5" },
  ];
  const base = { conversationId: conv, staffIds: ["ct5a", "coord"], sectionChildren: kids, householdIds: [], exceptHousehold: "hh1" };
  assert.deepEqual(pushAudience({ ...base, blocks: [] }), { staff: ["ct5a", "coord"], households: ["hh2", "hh3", "hh4", "hh5"] }, "no blocks: everyone but the sender");
  const r = pushAudience({
    ...base,
    blocks: [
      b({}), // family hh2 blocked school-wide
      b({ subjectKind: "student", subjectId: "k3", conversationId: conv }), // child k3 blocked in this group
      b({ subjectKind: "student", subjectId: "k4" }), // one twin blocked; the other is not
      b({ subjectKind: "household", subjectId: "hh5", mode: "mute" }), // muted: may read → still pushed
      b({ subjectKind: "staff", subjectId: "coord" }), // a blocked staff member
      b({ subjectKind: "household", subjectId: "hh9", conversationId: "cls:other" }),
    ],
  });
  assert.deepEqual(r.staff, ["ct5a"], "a blocked staff member is not pushed");
  assert.equal(r.households.includes("hh2"), false, "a blocked family is not pushed");
  assert.equal(r.households.includes("hh3"), false, "a child blocked in this group: their family is not pushed for it");
  assert.equal(r.households.includes("hh4"), true, "a family with another, unblocked child in the section still is");
  assert.equal(r.households.includes("hh5"), true, "mute = may read: still pushed");
  assert.equal(r.households.includes("hh1"), false, "never the sender's own family");
  // A block scoped to ANOTHER conversation does not bite here.
  assert.deepEqual(pushAudience({ ...base, blocks: [b({ conversationId: "cls:elsewhere" })] }).households, ["hh2", "hh3", "hh4", "hh5"]);
});

await t("push audience: staff↔parent chat — only the family's own block stops the push", () => {
  const conv = parentDmId("ct5a", "k1");
  const dm = { conversationId: conv, staffIds: [], sectionChildren: null, householdIds: ["hh1"], exceptHousehold: "" };
  const blk = (subjectKind: ChatBlock["subjectKind"], subjectId: string, mode: ChatBlock["mode"] = "block"): ChatBlock => ({ id: "x", subjectKind, subjectId, mode, conversationId: "", reason: "r", createdAt: "", createdByName: "" });
  assert.deepEqual(pushAudience({ ...dm, blocks: [] }).households, ["hh1"]);
  assert.deepEqual(pushAudience({ ...dm, blocks: [blk("household", "hh1")] }).households, [], "blocked family: no push");
  assert.deepEqual(pushAudience({ ...dm, blocks: [blk("household", "hh1", "mute")] }).households, ["hh1"], "muted family: pushed");
  // A family writing to a blocked teacher: the teacher is not pushed.
  assert.deepEqual(pushAudience({ conversationId: conv, staffIds: ["ct5a"], sectionChildren: null, householdIds: [], exceptHousehold: "hh1", blocks: [blk("staff", "ct5a")] }).staff, []);
  // The block read covers every subject the filter looks at.
  const subs = pushAudienceSubjects({ staffIds: ["s1"], sectionChildren: [{ id: "k1", householdId: "hh1" }], householdIds: ["hh2"] });
  assert.deepEqual(subs, [{ kind: "staff", id: "s1" }, { kind: "student", id: "k1" }, { kind: "household", id: "hh1" }, { kind: "household", id: "hh2" }]);
});

await t("push wiring: member pushes go through pushAudience, and an unreadable block list means no member push", () => {
  const src = readFileSync(join(__dirname, "schoolChatNotify.server.ts"), "utf8");
  assert.match(src, /pushAudience\(/, "the notifier filters by blocks");
  assert.match(src, /blocks unreadable — no member push[\s\S]{0,120}return;/, "fail closed on the block read");
  assert.doesNotMatch(src, /sendPushToSubjects\("parent", households,/, "no push to the raw section families");
  const server = readFileSync(join(__dirname, "schoolChat.server.ts"), "utf8");
  assert.equal((server.match(/loadBlocks: \(s\) => activeBlocksFor\(t, s\)/g) || []).length, 3, "send, warn and approve all pass the block reader");
  assert.match(server, /decision === "approve"[\s\S]{0,200}pushApproved\(/, "an approved message is pushed like a normal post");
});

// Review item 4: a per-sender rate limit, checked before the AI call.
await t("rate limit: 10 a minute, 200 a day; refused with a clear message", () => {
  assert.deepEqual(CHAT_RATE_LIMIT, { perMinute: 10, perDay: 200 });
  assert.equal(rateLimitRefusal({ minute: 0, day: 0 }), null);
  assert.equal(rateLimitRefusal({ minute: 9, day: 199 }), null);
  assert.match(rateLimitRefusal({ minute: 10, day: 10 })!, /too fast \(10 a minute at most\)/);
  assert.match(rateLimitRefusal({ minute: 0, day: 200 })!, /200 messages in the last 24 hours/);
  assert.match(rateLimitRefusal({ minute: 12, day: 250 })!, /24 hours/, "the daily limit is the one to tell");
});

await t("rate limit runs BEFORE the model: a refused send never asks the AI", async () => {
  asked = 0;
  const refuse = async () => {
    throw new Error("rate_limited");
  };
  await assert.rejects(admitThenModerate("hello", { sender: "student", where: "g", classify: counting, admit: refuse }), /rate_limited/);
  assert.equal(asked, 0, "the model was not asked");
  const order: string[] = [];
  const r = await admitThenModerate("hello", {
    sender: "staff",
    where: "g",
    admit: async () => void order.push("admit"),
    classify: async (...a) => (order.push("classify"), allow(...a)),
  });
  assert.deepEqual(order, ["admit", "classify"]);
  assert.equal(r.status, "visible");
  const server = readFileSync(join(__dirname, "schoolChat.server.ts"), "utf8");
  assert.match(server, /admitThenModerate\(body, \{[\s\S]{0,300}admit: \(\) => admitSend\(/, "sendMessage admits through the rate check");
  assert.doesNotMatch(server, /await moderateMessage\(/, "no path asks the model without the rate check");
  assert.match(server, /new ApiError\(\s*"rate_limited",[\s\S]{0,200}429/, "refused as 429");
});

// Review item 3: every action is atomic with its log row, and failures are surfaced.
await t("mute/block/lift + log are one transaction (RPC); refusal log errors are surfaced", () => {
  const server = readFileSync(join(__dirname, "schoolChat.server.ts"), "utf8");
  assert.doesNotMatch(server, /from\("school_chat_blocks"\)\s*\.(insert|update)\(/, "no direct block writes (they would not be atomic with the log)");
  const logInserts = server.match(/from\("school_chat_moderation_log"\)\.insert\(/g) || [];
  assert.equal(logInserts.length, 1, "the only direct log insert is send_refused (one row on its own)");
  assert.match(server, /const \{ error: logErr \} = await t\.sb\.from\("school_chat_moderation_log"\)\.insert\([\s\S]{0,400}if \(logErr\) dbFail\("send_refused log", logErr, true\)/, "a refusal whose log row failed is a 503, not a silent 403");
  assert.match(server, /rpc\("school_chat_set_block"[\s\S]{0,400}if \(error\) dbFail\("block", error, true\)/);
  assert.match(server, /rpc\("school_chat_lift_block"[\s\S]{0,300}if \(error\) dbFail\("lift", error, true\)/);
  assert.match(server, /rpc\("school_chat_rate_check"[\s\S]{0,500}if \(error\) dbFail\("rate check", error\)/);

  const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261020090000_school_chat.sql"), "utf8");
  const fn = (name: string) => {
    const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    assert.ok(m, `${name} exists (create or replace)`);
    return m![0];
  };
  const set = fn("school_chat_set_block");
  assert.match(set, /insert into public\.school_chat_blocks[\s\S]*insert into public\.school_chat_moderation_log/, "block + log in one function");
  const lift = fn("school_chat_lift_block");
  assert.match(lift, /update public\.school_chat_blocks[\s\S]*lifted_at is null[\s\S]*if not found then return; end if;[\s\S]*insert into public\.school_chat_moderation_log/);
  const rate = fn("school_chat_rate_check");
  assert.match(rate, /interval '1 minute'[\s\S]*interval '24 hours'[\s\S]*'send_refused'/);
  for (const sig of [
    "school_chat_set_block(uuid, text, text, text, text, text, text, text)",
    "school_chat_lift_block(uuid, uuid, text, text, text)",
    "school_chat_rate_check(uuid, text, text, text, text, text, text, text, int, int)",
  ]) {
    const esc = sig.replace(/[()[\]]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated;`), `${sig}: revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${esc} to service_role;`), `${sig}: service_role`);
  }
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
