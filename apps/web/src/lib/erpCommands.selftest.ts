/**
 * Run: npx tsx src/lib/erpCommands.selftest.ts
 *
 * Pure half of the ERP command desk: section and date extraction in the
 * forms staff actually type, the regex fast path, the model-JSON contract,
 * confirm-token rules, the hourly cap and the reply formatters. The server
 * half (RBAC, data, audit, WhatsApp) is exercised live via the webhook.
 */
import assert from "node:assert/strict";

import {
  ERP_COMMANDS,
  buildErpCommandSystemPrompt,
  classKey,
  confirmButtonIds,
  confirmIsFresh,
  extractSectionRefs,
  formatAbsentListReply,
  formatHelpReply,
  formatSectionProblem,
  looksLikeCommand,
  noteCommandUse,
  parseCommandsSwitch,
  parseConfirmReply,
  parseErpCommandLlmJson,
  parseErpCommandLocal,
  resolveCommandDate,
  resolveSectionRef,
  waMarkersToAssistantText,
  formatCommandDigest,
  formatCommandDigestOneLine,
  summarizeCommandAudit,
  parseStudentFeesQuery,
  matchStudents,
  formatStudentFeesReply,
  formatStudentMatchesAsk,
  formatAttendanceSummaryReply,
  formatClassDefaultersReply,
  formatCollectionReply,
  formatFreeTeachersReply,
  formatPendingLeavesReply,
  parseFreeTeachersQuery,
  periodAtTime,
  resolveClassOrSectionRef,
  type CommandAuditRow,
  type PendingErpConfirm,
  type StudentLike,
} from "./erpCommands";

console.log("erpCommands.selftest.ts");

// ─── classKey: Masters names in every style this school might use ──────
{
  assert.equal(classKey("VIII"), "8");
  assert.equal(classKey("viii"), "8");
  assert.equal(classKey("Class 8"), "8");
  assert.equal(classKey("8th"), "8");
  assert.equal(classKey("Grade 08"), "8");
  assert.equal(classKey("X"), "10");
  assert.equal(classKey("XII"), "12");
  assert.equal(classKey("LKG"), "lkg");
  assert.equal(classKey("Nursery"), "nursery");
  assert.equal(classKey("Pre-Nursery"), "prenursery");
  assert.equal(classKey("KG 1"), "lkg");
  assert.equal(classKey("Class 5 A"), "5", "class name that carries a section still keys on the class");
  assert.equal(classKey("Staff Room"), null);
}

// ─── extractSectionRefs: the ways staff write a section ────────────────
{
  const one = (t: string) => {
    const r = extractSectionRefs(t);
    assert.equal(r.length, 1, `${t} → ${JSON.stringify(r)}`);
    return `${r[0]!.classKey}${r[0]!.sectionName}`;
  };
  assert.equal(one("5A me aaj kaun absent hai"), "5A");
  assert.equal(one("5 a attendance"), "5A");
  assert.equal(one("5-A absent list"), "5A");
  assert.equal(one("class 5 section A absent"), "5A");
  assert.equal(one("class 5 A hazri"), "5A");
  assert.equal(one("5th A ke absentees"), "5A");
  assert.equal(one("VIII B absent"), "8B");
  assert.equal(one("viii-b me kaun nahi aaya"), "8B");
  assert.equal(one("LKG A attendance"), "lkgA");
  assert.equal(one("ukg-b absent"), "ukgB");
  assert.equal(one("kaksha 10 B"), "10B");
  assert.equal(one("class 3 attendance today"), "3", "class without a section letter is still a reference");
  assert.deepEqual(extractSectionRefs("hello sir"), []);
  assert.deepEqual(extractSectionRefs("meeting at 3 pm"), [], "a time is not a class");
  // "10A" must not be read as class 1 + junk or as class 0.
  assert.equal(one("10A absent"), "10A");
  // Two sections in one message keep their order.
  const two = extractSectionRefs("compare 5A and 5B attendance");
  assert.deepEqual(
    two.map((r) => `${r.classKey}${r.sectionName}`),
    ["5A", "5B"],
  );
}

// ─── resolveSectionRef against Masters-shaped data ─────────────────────
const masters = {
  classes: [
    { id: "c5", name: "V", sortOrder: 5, isActive: true },
    { id: "c8", name: "Class 8", sortOrder: 8, isActive: true },
    { id: "c9", name: "IX", sortOrder: 9, isActive: true },
    { id: "cold", name: "V", sortOrder: 5, isActive: false },
  ],
  sections: [
    { id: "s5a", classId: "c5", name: "A", isActive: true },
    { id: "s5b", classId: "c5", name: "B", isActive: true },
    { id: "s8a", classId: "c8", name: "Sec A", isActive: true },
    { id: "s9a", classId: "c9", name: "A", isActive: true },
    { id: "s5c", classId: "c5", name: "C", isActive: false },
  ],
};
{
  const r = resolveSectionRef({ classKey: "5", sectionName: "A" }, masters);
  assert.ok(r.ok);
  assert.equal(r.match.sectionId, "s5a");
  assert.equal(r.match.label, "V A");

  const r8 = resolveSectionRef({ classKey: "8", sectionName: "A" }, masters);
  assert.ok(r8.ok, "section named 'Sec A' matches the letter A");
  assert.equal(r8.match.sectionId, "s8a");

  const single = resolveSectionRef({ classKey: "9", sectionName: "" }, masters);
  assert.ok(single.ok, "a class with one section resolves without a letter");
  assert.equal(single.match.sectionId, "s9a");

  const amb = resolveSectionRef({ classKey: "5", sectionName: "" }, masters);
  assert.ok(!amb.ok && amb.reason === "ambiguous");
  assert.deepEqual(amb.options.map((o) => o.sectionId), ["s5a", "s5b"], "inactive section C is not offered");

  const noSec = resolveSectionRef({ classKey: "5", sectionName: "D" }, masters);
  assert.ok(!noSec.ok && noSec.reason === "no_section");

  const noClass = resolveSectionRef({ classKey: "12", sectionName: "A" }, masters);
  assert.ok(!noClass.ok && noClass.reason === "no_class");
}

// ─── resolveCommandDate ────────────────────────────────────────────────
{
  const today = "2026-09-05";
  assert.equal(resolveCommandDate("5A me aaj kaun absent hai", today), today);
  assert.equal(resolveCommandDate("kal 5A me kaun nahi aaya", today), "2026-09-04");
  assert.equal(resolveCommandDate("yesterday 5A absent", today), "2026-09-04");
  assert.equal(resolveCommandDate("parso 5A", today), "2026-09-03");
  assert.equal(resolveCommandDate("5A absent 2/9", today), "2026-09-02");
  assert.equal(resolveCommandDate("5A absent 02-09-2026", today), "2026-09-02");
  assert.equal(resolveCommandDate("5A absent on 2026-08-30", today), "2026-08-30");
  assert.equal(
    resolveCommandDate("5A absent 25/12", today),
    "2025-12-25",
    "a day/month that would be in the future rolls to last year",
  );
  assert.equal(resolveCommandDate("5A absent", "2026-01-01"), "2026-01-01");
  assert.equal(resolveCommandDate("kal 5A", "2026-01-01"), "2025-12-31", "yesterday across a year boundary");
}

// ─── parseErpCommandLocal (no model needed for the daily commands) ─────
{
  const p = parseErpCommandLocal("5A me aaj kaun absent hai");
  assert.ok(p && p.commandId === "absent_list" && p.fields.section === "5A" && p.source === "local");
  assert.equal(parseErpCommandLocal("absent list 7B")?.fields.section, "7B");
  assert.equal(parseErpCommandLocal("class 3 A attendance today")?.commandId, "absent_list");
  assert.equal(parseErpCommandLocal("8B hazri")?.commandId, "absent_list");
  assert.equal(parseErpCommandLocal("VIII B me kaun nahi aaya")?.fields.section, "8B");
  assert.equal(parseErpCommandLocal("5A में कौन गैरहाजिर है")?.commandId, "absent_list", "Devanagari fee/absent words match without ASCII word boundaries");
  assert.equal(parseErpCommandLocal("7B की उपस्थिति")?.fields.section, "7B");
  assert.equal(parseErpCommandLocal("pending leaves")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("leave requests")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("5A leave requests")?.fields.section, "5A");
  assert.equal(parseErpCommandLocal("kitni chutti pending hai")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("leave approvals")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("कितनी छुट्टी बाकी है")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("leave"), null, "'leave' alone is left to the staff bot");
  assert.equal(parseErpCommandLocal("5A me aaj kaun leave pe hai")?.commandId, "absent_list", "who is absent/on leave in a section is the absent list");
  assert.equal(parseErpCommandLocal("who is free in period 3")?.fields.text, "3");
  assert.equal(parseErpCommandLocal("period 3 me kaun free hai")?.fields.text, "3");
  assert.equal(parseErpCommandLocal("3rd period khali kaun hai")?.fields.text, "3");
  assert.equal(parseErpCommandLocal("abhi kaun free hai")?.fields.text, "now");
  assert.equal(parseErpCommandLocal("free teachers next period")?.fields.text, "next");
  assert.equal(parseErpCommandLocal("kal 5th period kaun khali hai")?.commandId, "free_teachers");
  assert.equal(parseErpCommandLocal("P4 free teachers")?.fields.text, "4");
  assert.equal(parseFreeTeachersQuery("free of fees for Amay"), null, "fee waivers are not this");
  assert.equal(parseFreeTeachersQuery("5A free period"), null, "a section's free period is not this ask");
  assert.equal(parseFreeTeachersQuery("kaun free hai"), "now", "no period said → now");
  assert.equal(parseErpCommandLocal("aaj ka collection")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("today's collection")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("kal ka collection")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("collection report")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("aaj kitna cash aaya")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("आज का कलेक्शन")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("5A collection"), null, "a class with 'collection' is not the day's takings");
  assert.equal(parseErpCommandLocal("attendance summary")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("aaj ki attendance")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("today's attendance")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("kal ki hazri report")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("आज की उपस्थिति")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("5A attendance")?.commandId, "absent_list", "a section makes it the absent list");
  assert.equal(parseErpCommandLocal("absent")?.commandId, undefined, "'absent' alone is neither");
  assert.equal(parseErpCommandLocal("commands")?.commandId, "help");
  assert.equal(parseErpCommandLocal("commands report")?.commandId, "commands_digest");
  assert.equal(parseErpCommandLocal("aaj ke commands")?.commandId, "commands_digest");
  assert.equal(parseErpCommandLocal("AI report")?.commandId, "commands_digest");
  assert.equal(parseErpCommandLocal("?")?.commandId, "help");
  assert.equal(parseErpCommandLocal("hello sir"), null);
  assert.equal(parseErpCommandLocal("5A"), null, "a bare section with no ask is not a command");
  assert.equal(parseErpCommandLocal("absent"), null, "absent with no section is not a command");
  assert.equal(parseErpCommandLocal("IN"), null, "punch keyword stays with the attendance bot");
  assert.equal(parseErpCommandLocal("help"), null, "'help' stays with the office escalation");
}

// ─── looksLikeCommand gate for the model ───────────────────────────────
{
  assert.equal(looksLikeCommand("Class 3 ke defaulters batao"), true);
  assert.equal(looksLikeCommand("how many students in 5A?"), true);
  assert.equal(looksLikeCommand("Amay ki fees pending"), true);
  assert.equal(looksLikeCommand("hi"), false);
  assert.equal(looksLikeCommand("Good morning sir"), false);
  assert.equal(looksLikeCommand("Homework: page 42 ex 4.2"), true, "teacher post — model decides, catalogue says none");
  assert.equal(looksLikeCommand("x".repeat(400)), false);
}

// ─── model JSON contract ───────────────────────────────────────────────
{
  const ok = parseErpCommandLlmJson('{"command":"absent_list","section":"5A","date":"","confidence":0.92}');
  assert.ok(ok && ok.command === "absent_list" && ok.section === "5A" && ok.confidence === 0.92);
  const none = parseErpCommandLlmJson('{"command":"none","confidence":0}');
  assert.ok(none && none.command === "none");
  assert.equal(parseErpCommandLlmJson('{"command":"delete_everything","confidence":1}'), null, "unknown command ids are rejected");
  assert.equal(parseErpCommandLlmJson("not json"), null);
  assert.equal(parseErpCommandLlmJson('{"confidence":1}'), null);
  const clamp = parseErpCommandLlmJson('{"command":"absent_list","confidence":7}');
  assert.equal(clamp?.confidence, 1);
  const prompt = buildErpCommandSystemPrompt({ commands: ERP_COMMANDS, todayIso: "2026-09-05" });
  assert.ok(prompt.includes("absent_list") && prompt.includes("2026-09-05") && prompt.includes('"none"'));
}

// ─── confirm cards ─────────────────────────────────────────────────────
{
  const pending: PendingErpConfirm = {
    token: "abc123xyz",
    commandId: "absent_list",
    fields: {},
    resolved: {},
    summary: "x",
    createdAt: "2026-09-05T10:00:00.000Z",
    originalText: "x",
  };
  const ids = confirmButtonIds(pending.token);
  assert.deepEqual(parseConfirmReply(ids.yes, null), { decision: "yes", token: "abc123xyz" }, "button ids work even with no pending in memory");
  assert.deepEqual(parseConfirmReply(ids.no, pending), { decision: "no", token: "abc123xyz" });
  assert.deepEqual(parseConfirmReply("haan", pending), { decision: "yes", token: "abc123xyz" });
  assert.deepEqual(parseConfirmReply("nahi", pending), { decision: "no", token: "abc123xyz" });
  assert.equal(parseConfirmReply("yes", null), null, "plain yes with nothing pending is not a confirm");
  assert.equal(parseConfirmReply("yes", pending, { allowPlainWords: false }), null, "teacher flow: plain yes belongs to the class channel");
  assert.equal(parseConfirmReply("5A absent", pending), null);
  const t0 = Date.parse(pending.createdAt);
  assert.equal(confirmIsFresh(pending, t0 + 4 * 60 * 1000), true);
  assert.equal(confirmIsFresh(pending, t0 + 6 * 60 * 1000), false);
}

// ─── hourly cap ────────────────────────────────────────────────────────
{
  let hist: number[] | undefined;
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i++) {
    const r = noteCommandUse(hist, t0 + i * 1000, 30);
    assert.equal(r.allowed, true, `command ${i + 1} allowed`);
    hist = r.history;
  }
  const blocked = noteCommandUse(hist, t0 + 31_000, 30);
  assert.equal(blocked.allowed, false, "31st command in the hour is blocked");
  assert.equal(blocked.history.length, 30, "a blocked attempt is not counted");
  const later = noteCommandUse(hist, t0 + 61 * 60 * 1000, 30);
  assert.equal(later.allowed, true, "window slides");
  assert.equal(later.history.length, 1);
}

// ─── pause switch ──────────────────────────────────────────────────────
{
  assert.equal(parseCommandsSwitch("commands off"), "off");
  assert.equal(parseCommandsSwitch("Commands ON"), "on");
  assert.equal(parseCommandsSwitch("command band"), "off");
  assert.equal(parseCommandsSwitch("commands"), null, "bare 'commands' is help, not a switch");
  assert.equal(parseCommandsSwitch("turn commands off please"), null);
}

// ─── reply formatting ──────────────────────────────────────────────────
{
  const today = "2026-09-05";
  const base = {
    sectionLabel: "V A",
    date: today,
    todayIso: today,
    total: 32,
    absent: [
      { rollNo: "11", fullName: "Riya Verma" },
      { rollNo: "4", fullName: "Aarav Sharma" },
    ],
    leave: [{ rollNo: "19", fullName: "Kabir Ali" }],
    late: [],
    halfDay: [],
  };
  const marked = formatAbsentListReply({ ...base, marked: true });
  assert.ok(marked.startsWith("*V A* · today"));
  assert.ok(marked.includes("Present 29 / 32 · Absent 2 · Leave 1"));
  assert.ok(marked.indexOf("4. Aarav Sharma") < marked.indexOf("11. Riya Verma"), "absentees sorted by roll number");
  assert.ok(marked.includes("*On leave*\n19. Kabir Ali"));

  const unmarked = formatAbsentListReply({ ...base, marked: false });
  assert.ok(unmarked.includes("Attendance not marked yet (32 students)"));

  const empty = formatAbsentListReply({ ...base, total: 0, marked: false, absent: [], leave: [] });
  assert.ok(empty.includes("No active students"));

  const yesterday = formatAbsentListReply({ ...base, marked: true, absent: [], leave: [], date: "2026-09-04" });
  assert.ok(yesterday.includes("4 Sept") || yesterday.includes("4 Sep"), yesterday);
  assert.ok(yesterday.includes("No one absent."));

  const help = formatHelpReply(ERP_COMMANDS.filter((c) => c.id !== "help"), "Sunita");
  assert.ok(help.startsWith("Sunita, you can send me"));
  assert.ok(help.includes("Absent list for a section"));

  assert.ok(formatSectionProblem("no_class", [], "13A").includes('"13A"'));
  assert.ok(
    formatSectionProblem(
      "ambiguous",
      [
        { classId: "c5", sectionId: "s5a", className: "V", sectionName: "A", label: "V A" },
        { classId: "c5", sectionId: "s5b", className: "V", sectionName: "B", label: "V B" },
      ],
      "5",
    ).includes("V A, V B"),
  );
  assert.ok(formatSectionProblem("not_allowed", [], "V A").includes("own sections"));
}

// ─── WhatsApp markers → assistant markdown ─────────────────────────────
{
  assert.equal(waMarkersToAssistantText("*V A* · today"), "**V A** · today");
  assert.equal(
    waMarkersToAssistantText("Present 29 / 32\n\n*Absent*\n4. Aarav"),
    "Present 29 / 32\n\n**Absent**\n4. Aarav",
  );
  assert.equal(
    waMarkersToAssistantText("Try _5A me aaj kaun absent hai_."),
    "Try 5A me aaj kaun absent hai.",
    "italics become plain text",
  );
  assert.equal(
    waMarkersToAssistantText("cmd_yes_abc snake_case_word"),
    "cmd_yes_abc snake_case_word",
    "underscores inside words are not italics",
  );
  assert.equal(waMarkersToAssistantText("2 * 3 * 4"), "2 * 3 * 4", "spaced asterisks are arithmetic, not bold");
}

// ─── director's daily digest ───────────────────────────────────────────
{
  const row = (
    over: Partial<CommandAuditRow> & { after?: Record<string, unknown> | null },
  ): CommandAuditRow => ({
    actorName: "Sunita Sharma",
    actorEmail: null,
    action: "view",
    entityId: "absent_list",
    summary: "WhatsApp command (ok): 5A me aaj kaun absent hai",
    after: { outcome: "ok", channel: "whatsapp", command: "absent_list" },
    createdAt: "2026-09-05T04:30:00.000Z",
    ...over,
  });
  const rows: CommandAuditRow[] = [
    row({}),
    row({ after: { outcome: "ok", channel: "whatsapp", command: "absent_list", voice: true } }),
    row({ actorName: "Rakesh Verma", after: { outcome: "ok", channel: "app", command: "absent_list" } }),
    row({
      actorName: "Rakesh Verma",
      entityId: "help",
      summary: "App command (ok): commands",
      after: { outcome: "ok", channel: "app", command: "help" },
    }),
    row({
      actorName: "Rakesh Verma",
      summary: "WhatsApp command (denied): 7B absent",
      after: { outcome: "denied", reason: "scope", channel: "whatsapp", command: "absent_list" },
      createdAt: "2026-09-05T06:05:00.000Z",
    }),
    row({
      actorName: "Anita Devi",
      action: "edit",
      entityId: "post_homework",
      summary: "App command (ok): post homework 6B maths ex 4.2",
      after: { outcome: "ok", channel: "app", command: "post_homework" },
      createdAt: "2026-09-05T09:40:00.000Z",
    }),
  ];
  const stats = summarizeCommandAudit(rows);
  assert.equal(stats.total, 6);
  assert.equal(stats.ok, 5);
  assert.equal(stats.denied, 1);
  assert.equal(stats.writes, 1);
  assert.equal(stats.voice, 1);
  assert.deepEqual(stats.byChannel, [
    { channel: "app", count: 3 },
    { channel: "whatsapp", count: 3 },
  ]);
  assert.equal(stats.byCommand[0]!.commandId, "absent_list");
  assert.equal(stats.byCommand[0]!.count, 4);
  assert.deepEqual(stats.byActor[0], { name: "Rakesh Verma", count: 3, denied: 1 });
  assert.equal(stats.deniedRows[0]!.text, "7B absent");
  assert.equal(stats.deniedRows[0]!.reason, "scope");
  assert.equal(stats.deniedRows[0]!.at, "11:35 am", "times are shown in IST");
  assert.equal(stats.writeRows[0]!.text, "post homework 6B maths ex 4.2");

  const text = formatCommandDigest(stats, { date: "2026-09-05", paused: false });
  assert.ok(text.startsWith("*ERP commands · 5 Sept*") || text.startsWith("*ERP commands · 5 Sep*"), text);
  assert.ok(text.includes("6 commands · 1 write · 1 denied · 1 by voice"));
  assert.ok(text.includes("App / assistant 3 · WhatsApp 3"));
  assert.ok(text.includes("4 × Absent list for a section"));
  assert.ok(text.includes("Rakesh Verma 3 (1 denied)"));
  assert.ok(text.includes("*Writes*\n03:10 pm Anita Devi: post homework 6B maths ex 4.2"));
  assert.ok(text.includes("*Denied*\n11:35 am Rakesh Verma: 7B absent (not their section)"));
  assert.ok(!text.includes("⏸"));

  const paused = formatCommandDigest(stats, { date: "2026-09-05", paused: true, pausedBy: "Director" });
  assert.ok(paused.includes("⏸ Commands are paused by Director."));

  const quiet = formatCommandDigest(summarizeCommandAudit([]), { date: "2026-09-05", paused: false });
  assert.ok(quiet.includes("No commands today."));

  const one = formatCommandDigestOneLine(stats, "2026-09-05");
  assert.equal(one, "ERP commands 2026-09-05: 6 commands, 1 writes, 1 denied, most by Rakesh Verma (3).");
  assert.ok(!one.includes("\n"));
}

// ─── student fees: query → name (+ section / roll) ──────────────────────
{
  const q = (t: string) => parseStudentFeesQuery(t);
  assert.deepEqual(q("Amay ki fees pending"), { name: "amay" });
  assert.deepEqual(q("show me all dues of Aarav Sharma"), { name: "aarav sharma" });
  assert.deepEqual(q("Riya Verma dues"), { name: "riya verma" });
  assert.deepEqual(q("Aarav ka kitna baki hai"), { name: "aarav" });
  assert.deepEqual(q("fees Amay Gupta 4B"), {
    name: "amay gupta",
    section: { classKey: "4", sectionName: "B" },
  });
  assert.deepEqual(q("roll 12 4B fees"), {
    name: "",
    section: { classKey: "4", sectionName: "B" },
    rollNo: "12",
  });
  assert.deepEqual(q("Amay Gupta ki फीस बकाया"), { name: "amay gupta" });
  assert.equal(q("class 3 fees pending"), null, "a section alone is a class question");
  assert.equal(q("Amay Gupta"), null, "no fee word — not a fees query");
  assert.equal(q("5A me aaj kaun absent hai"), null);
  // The local parser routes it as a command with the student field filled.
  const p = parseErpCommandLocal("fees Amay Gupta 4B");
  assert.ok(p && p.commandId === "student_fees" && p.fields.student === "amay gupta 4B", JSON.stringify(p));
  assert.equal(parseErpCommandLocal("Class 3 defaulters")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("Class 3 defaulters")?.fields.section, "3", "whole class when no letter");
  assert.equal(parseErpCommandLocal("5A defaulters")?.fields.section, "5A");
  assert.equal(parseErpCommandLocal("class 5 ke bakayedar")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("fees pending list 7B")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("class 3 me kisne fees nahi di")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("कक्षा 3 के बकायेदार")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("Amay Gupta 4B fees pending")?.commandId, "student_fees", "a name with a section is still one student");
  assert.equal(parseErpCommandLocal("defaulters"), null, "no class → not a command");
  // Model JSON carries the student too.
  const llm = parseErpCommandLlmJson('{"command":"student_fees","student":"Amay Gupta","confidence":0.9}');
  assert.equal(llm?.student, "Amay Gupta");
}

// ─── student matching ──────────────────────────────────────────────────
{
  const st = (id: string, fullName: string, sectionId: string, rollNo: string, extra?: Partial<StudentLike>): StudentLike => ({
    id,
    fullName,
    admissionNo: `ADM${id}`,
    rollNo,
    classId: "c",
    sectionId,
    status: "active",
    academicYearCode: "2026-27",
    ...extra,
  });
  const students = [
    st("1", "Amay Gupta", "s4b", "12"),
    st("2", "Amay Singh", "s1a", "3"),
    st("3", "Aarav Sharma", "s5a", "4"),
    st("4", "Aarav Sharma", "s5b", "9"),
    st("5", "Riya Verma", "s5a", "11"),
    st("6", "Old Amay", "s4b", "1", { status: "left" }),
    st("7", "Amay Gupta", "s4b", "12", { academicYearCode: "2025-26" }),
  ];
  const ay = { academicYearCode: "2026-27" };
  const names = (r: ReturnType<typeof matchStudents>) => r.map((m) => `${m.student.id}:${m.student.fullName}`);
  assert.deepEqual(names(matchStudents({ name: "amay" }, students, ay)), ["1:Amay Gupta", "2:Amay Singh"], "first name → both, inactive and last year excluded");
  assert.deepEqual(names(matchStudents({ name: "amay gupta" }, students, ay)), ["1:Amay Gupta"], "exact full name wins");
  assert.deepEqual(names(matchStudents({ name: "aarav sharma" }, students, ay)), ["3:Aarav Sharma", "4:Aarav Sharma"], "two students, same name → both, caller asks back");
  assert.deepEqual(names(matchStudents({ name: "aarav sharma" }, students, { ...ay, sectionId: "s5b" })), ["4:Aarav Sharma"], "section narrows");
  assert.deepEqual(names(matchStudents({ name: "aarav sh" }, students, ay)), ["3:Aarav Sharma", "4:Aarav Sharma"], "prefix per word");
  assert.deepEqual(names(matchStudents({ name: "sharma" }, students, ay)), ["3:Aarav Sharma", "4:Aarav Sharma"], "surname only");
  assert.deepEqual(names(matchStudents({ name: "", rollNo: "12" }, students, { ...ay, sectionId: "s4b" })), ["1:Amay Gupta"], "roll within a section");
  assert.deepEqual(names(matchStudents({ name: "", rollNo: "12" }, students, ay)), [], "roll without a section is too vague");
  assert.deepEqual(names(matchStudents({ name: "adm5" }, students, ay)), ["5:Riya Verma"], "admission number");
  assert.deepEqual(names(matchStudents({ name: "zzz" }, students, ay)), []);
}

// ─── student fees reply ────────────────────────────────────────────────
{
  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const base = {
    studentName: "Amay Gupta",
    classLabel: "IV · B",
    rollNo: "12",
    todayIso: "2026-09-05",
    lastReceipt: { receiptNo: "R-0912", date: "2026-06-08", amountPaise: 515000, modes: ["UPI"] },
    parentMobile: "9876543221",
    siblings: [{ name: "Anaya Gupta", classLabel: "I · A", duePaise: 620000 }],
    formatInr: inr,
  };
  const dues = [
    { label: "Jul 2026", headName: "Tuition", kind: "academic", dueOn: "2026-07-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: ["Sibling 2nd child"], future: false },
    { label: "Jul 2026", headName: "Transport", kind: "transport", dueOn: "2026-07-10", balancePaise: 120000, billedPaise: 120000, concessionPaise: 0, concessionNames: [], future: false },
    { label: "Aug 2026", headName: "Tuition", kind: "academic", dueOn: "2026-08-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: ["Sibling 2nd child"], future: false },
    { label: "Sep 2026", headName: "Tuition", kind: "academic", dueOn: "2026-09-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: ["Sibling 2nd child"], future: false },
    { label: "Oct 2026", headName: "Tuition", kind: "academic", dueOn: "2026-10-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: [], future: true },
    { label: "Nov 2026", headName: "Tuition", kind: "academic", dueOn: "2026-11-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: [], future: true },
    { label: "Dec 2026", headName: "Tuition", kind: "academic", dueOn: "2026-12-10", balancePaise: 400000, billedPaise: 450000, concessionPaise: 50000, concessionNames: [], future: true },
  ];
  const full = formatStudentFeesReply({ ...base, dues, detail: "full" });
  assert.ok(full.startsWith("*Amay Gupta* · IV · B · Roll 12"), full);
  assert.ok(full.includes("Total due today: *₹13,200*   (overdue since 10 Jul)"), full);
  assert.ok(full.includes("*By month*\nJul 2026   ₹5,200\nAug 2026   ₹4,000\nSep 2026   ₹4,000"), full);
  assert.ok(full.includes("*By head*\nTuition   ₹12,000  (₹1,500 Sibling 2nd child concession applied)\nTransport   ₹1,200"), full);
  assert.ok(full.includes("Pay-ahead, not yet due: Oct 2026 to Dec 2026, ₹12,000"), full);
  assert.ok(full.includes("Last receipt: ₹5,150 on 8 Jun, UPI (R-0912)"), full);
  assert.ok(full.includes("Parent: 98xxxxxx21"));
  assert.ok(full.includes("Sibling Anaya Gupta, I · A: ₹6,200 due"));

  const basic = formatStudentFeesReply({ ...base, dues, detail: "basic" });
  assert.ok(basic.includes("Tuition   ₹12,000  (₹1,500 concession applied)"), "class teacher sees the amount, not the policy name");
  assert.ok(!basic.includes("Sibling"), "class teacher does not see the sibling line");

  const clear = formatStudentFeesReply({ ...base, dues: dues.filter((d) => d.future), detail: "full", siblings: [] });
  assert.ok(clear.includes("No dues pending today. ✅"), clear);
  assert.ok(clear.includes("Pay-ahead"));

  const none = formatStudentFeesReply({ ...base, dues: [], lastReceipt: null, siblings: [], detail: "basic" });
  assert.ok(none.includes("No receipt on record this session."));

  assert.ok(formatStudentMatchesAsk([], "Zed").includes('"Zed"'));
  const ask = formatStudentMatchesAsk(
    [
      { fullName: "Aarav Sharma", classLabel: "V · A", rollNo: "4" },
      { fullName: "Aarav Sharma", classLabel: "V · B", rollNo: "9" },
    ],
    "aarav sharma",
  );
  assert.ok(ask.includes("• Aarav Sharma (V · A, roll 4)\n• Aarav Sharma (V · B, roll 9)"), ask);
}

// ─── attendance summary reply ──────────────────────────────────────────
{
  const sec = (label: string, total: number, present: number, absent = 0, leave = 0, marked = true, holiday = false) => ({
    label, total, marked, holiday, present, absent, leave, late: 0, halfDay: 0,
  });
  const input = {
    date: "2026-09-05",
    todayIso: "2026-09-05",
    scope: "school" as const,
    classes: [
      { className: "Nursery", sections: [sec("Nursery A", 20, 0, 0, 0, false, true)] },
      { className: "V", sections: [sec("V A", 32, 30, 2), sec("V B", 31, 28, 2, 1)] },
      { className: "VI", sections: [sec("VI A", 30, 0, 0, 0, false)] },
    ],
    staff: {
      activeStaff: 44,
      registerMarked: true,
      present: 40,
      absent: 1,
      leave: 1,
      notPunched: ["Rakesh Verma", "Sunita Sharma"],
    },
  };
  const t = formatAttendanceSummaryReply(input);
  assert.ok(t.startsWith("*School attendance* · today"), t);
  assert.ok(t.includes("Present *92%* (58 / 63) · Absent 4 · Leave 1"), t);
  assert.ok(t.includes("2 of 3 sections marked"), "the holiday section is not counted as expected");
  assert.ok(t.includes("*Not marked:* VI A"), t);
  assert.ok(!t.includes("Nursery A"), "a section on holiday is not listed as pending");
  assert.ok(t.includes("V  92%  (A 30/32, B 28/31)"), t);
  assert.ok(t.includes("*Staff:* Present 40 · Absent 1 · Leave 1 of 44"), t);
  assert.ok(t.includes("Not punched in: Rakesh Verma, Sunita Sharma"), t);

  const mine = formatAttendanceSummaryReply({ ...input, scope: "mine", staff: null, classes: input.classes.slice(1, 2) });
  assert.ok(mine.startsWith("*Your sections* · today"));
  assert.ok(!mine.includes("Staff"));

  const early = formatAttendanceSummaryReply({
    ...input,
    classes: [{ className: "V", sections: [sec("V A", 32, 0, 0, 0, false)] }],
    staff: { activeStaff: 44, registerMarked: false, present: 0, absent: 0, leave: 0, notPunched: [] },
  });
  assert.ok(early.includes("No section marked yet (1 pending)"), early);
  assert.ok(early.includes("*Staff:* no punches yet (44 active)."), early);

  const yesterday = formatAttendanceSummaryReply({ ...input, date: "2026-09-04" });
  assert.ok(yesterday.includes("· 4 Sep"), yesterday);
}

// ─── class-or-section resolution ───────────────────────────────────────
{
  const whole = resolveClassOrSectionRef({ classKey: "5", sectionName: "" }, masters);
  assert.ok(whole.ok && whole.wholeClass && whole.sections.map((s) => s.sectionId).join() === "s5a,s5b", JSON.stringify(whole));
  const one = resolveClassOrSectionRef({ classKey: "5", sectionName: "B" }, masters);
  assert.ok(one.ok && !one.wholeClass && one.sections.length === 1 && one.sections[0]!.sectionId === "s5b");
  const none = resolveClassOrSectionRef({ classKey: "12", sectionName: "" }, masters);
  assert.ok(!none.ok && none.reason === "no_class");
}

// ─── class defaulters reply ────────────────────────────────────────────
{
  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const rows = [
    { sectionLabel: "V A", rollNo: "4", fullName: "Aarav Sharma", overdueAmountPaise: 840000, overdueDays: 45, earliestDueOn: "2026-07-22", onPlan: false },
    { sectionLabel: "V B", rollNo: "9", fullName: "Kabir Ali", overdueAmountPaise: 1200000, overdueDays: 12, earliestDueOn: "2026-08-24", onPlan: true },
    { sectionLabel: "V A", rollNo: "11", fullName: "Riya Verma", overdueAmountPaise: 400000, overdueDays: 26, earliestDueOn: "2026-08-10", onPlan: false },
  ];
  const whole = formatClassDefaultersReply({ title: "Class V", todayIso: "2026-09-05", wholeClass: true, rows, formatInr: inr });
  assert.ok(whole.startsWith("*Class V* · defaulters · today"), whole);
  assert.ok(whole.includes("3 students · *₹24,400* overdue"), whole);
  assert.ok(whole.includes("*V A* · 2 · ₹12,400\n4. Aarav Sharma  ₹8,400 · 45d (22 Jul)\n11. Riya Verma  ₹4,000 · 26d (10 Aug)"), whole);
  assert.ok(whole.includes("*V B* · 1 · ₹12,000\n9. Kabir Ali  ₹12,000 · 12d (24 Aug) · plan"), whole);
  assert.ok(whole.endsWith("Reply with a name for the full ledger."));

  const section = formatClassDefaultersReply({ title: "V A", todayIso: "2026-09-05", wholeClass: false, rows: rows.filter((r) => r.sectionLabel === "V A"), formatInr: inr });
  assert.ok(section.includes("2 students · *₹12,400* overdue\n\n4. Aarav Sharma"), section);
  assert.ok(!section.includes("*V A* · 2"), "no per-section header for a single section");

  const limited = formatClassDefaultersReply({ title: "Class V", todayIso: "2026-09-05", wholeClass: true, rows: [], limitedTo: ["V A"], formatInr: inr });
  assert.ok(limited.includes("(your sections only: V A)") && limited.includes("No overdue fees. ✅"), limited);
}

// ─── collection reply ──────────────────────────────────────────────────
{
  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const base = {
    date: "2026-09-05",
    todayIso: "2026-09-05",
    receiptCount: 23,
    totalPaise: 18650000,
    byMode: [
      { label: "Cash", paise: 9200000, count: 12 },
      { label: "UPI", paise: 6100000, count: 8 },
      { label: "Online (Cashfree)", paise: 2350000, count: 2 },
      { label: "Cheque / DD", paise: 1000000, count: 1 },
    ],
    chequesPending: { count: 1, paise: 1000000 },
    bySource: { counter: 20, manualBook: 1, paymentLink: 2 },
    cashiers: [
      { name: "Sunita Sharma", paise: 12000000, count: 15 },
      { name: "Rakesh Verma", paise: 6650000, count: 8 },
    ],
    dayClose: { status: "submitted", cashierName: "Sunita Sharma", physicalCashPaise: 9150000, systemCashPaise: 9200000 },
    monthToDatePaise: 41200000,
    monthLabel: "September",
    formatInr: inr,
  };
  const t = formatCollectionReply(base);
  assert.ok(t.startsWith("*Fee collection* · today\n*₹1,86,500* · 23 receipts"), t);
  assert.ok(t.includes("*By mode*\nCash   ₹92,000  (12)\nUPI   ₹61,000  (8)\nOnline (Cashfree)   ₹23,500  (2)\nCheque / DD   ₹10,000  (1)"), t);
  assert.ok(t.includes("Cheques awaiting clearance: 1 · ₹10,000"), t);
  assert.ok(t.includes("Receipts: counter 20 · paper book 1 · online link 2"), t);
  assert.ok(t.includes("*By cashier*\nSunita Sharma   ₹1,20,000  (15)"), t);
  assert.ok(t.includes("Day close: submitted, awaiting approval (Sunita Sharma) · cash short by ₹500"), t);
  assert.ok(t.endsWith("September so far: ₹4,12,000"), t);

  const empty = formatCollectionReply({ ...base, receiptCount: 0, totalPaise: 0, byMode: [], cashiers: [], dayClose: null, chequesPending: { count: 0, paise: 0 }, bySource: { counter: 0, manualBook: 0, paymentLink: 0 } });
  assert.ok(empty.includes("No receipts yet.") && empty.includes("Day close: —"), empty);

  const single = formatCollectionReply({ ...base, cashiers: base.cashiers.slice(0, 1), bySource: { counter: 23, manualBook: 0, paymentLink: 0 }, dayClose: { status: "approved", cashierName: "", physicalCashPaise: null, systemCashPaise: null } });
  assert.ok(!single.includes("*By cashier*"), "one cashier — no breakdown");
  assert.ok(!single.includes("Receipts:"), "one source — no breakdown");
  assert.ok(single.includes("Day close: approved ✅"), single);

  const yesterday = formatCollectionReply({ ...base, date: "2026-09-04", dayClose: null });
  assert.ok(yesterday.startsWith("*Fee collection* · 4 Sep") && yesterday.includes("Day close: not started."), yesterday);
}

// ─── period at time ────────────────────────────────────────────────────
{
  const periods = [
    { no: 1, startTime: "08:00", endTime: "08:40" },
    { no: 2, startTime: "08:40", endTime: "09:20" },
    { no: 3, startTime: "09:40", endTime: "10:20" },
  ];
  assert.deepEqual(periodAtTime(periods, "08:10", "now"), { no: 1 });
  assert.deepEqual(periodAtTime(periods, "09:30", "now"), { no: 3 }, "a break counts as the period about to start");
  assert.deepEqual(periodAtTime(periods, "08:10", "next"), { no: 2 });
  assert.deepEqual(periodAtTime(periods, "07:30", "now"), { before: true });
  assert.deepEqual(periodAtTime(periods, "10:30", "now"), { after: true });
  assert.deepEqual(periodAtTime(periods, "10:00", "next"), { after: true });
}

// ─── free teachers reply ───────────────────────────────────────────────
{
  const t = formatFreeTeachersReply({
    date: "2026-09-05",
    todayIso: "2026-09-05",
    periodNo: 3,
    periodLabel: "Period 3",
    timeLabel: "09:40–10:20",
    weekdayLabel: "Sat",
    free: [
      { name: "Sunita Sharma", dayLoad: 5, subLoad: 0, designation: "TGT" },
      { name: "Anita Devi", dayLoad: 3, subLoad: 0, designation: "PRT" },
      { name: "Rakesh Verma", dayLoad: 3, subLoad: 1, designation: "" },
    ],
    absentCount: 1,
    uncovered: [{ classLabel: "V A", subject: "Maths", absentTeacher: "Kabir Ali" }],
    covered: [{ classLabel: "VI B", subject: "Hindi", substitute: "Anita Devi" }],
  });
  assert.ok(t.startsWith("*Free in Period 3* · today · 09:40–10:20\n3 free"), t);
  assert.ok(t.indexOf("Anita Devi (PRT)  · 3 pd today") < t.indexOf("Rakesh Verma  · 3 pd today, 1 sub"), "lighter load first; a sub counts double");
  assert.ok(t.indexOf("Rakesh Verma") < t.indexOf("Sunita Sharma"), t);
  assert.ok(t.includes("*Uncovered this period* (1 absent today)\nV A Maths — Kabir Ali absent"), t);
  assert.ok(t.includes("*Substitutions this period*\nVI B Hindi → Anita Devi"), t);

  const none = formatFreeTeachersReply({
    date: "2026-09-04", todayIso: "2026-09-05", periodNo: 1, periodLabel: "Period 1", timeLabel: "", weekdayLabel: "Fri",
    free: [], absentCount: 2, uncovered: [], covered: [],
  });
  assert.ok(none.startsWith("*Free in Period 1* · Fri 4 Sep"), none);
  assert.ok(none.includes("No teacher is free this period.") && none.includes("2 teachers absent today; this period is covered."), none);
}

// ─── pending leaves reply ──────────────────────────────────────────────
{
  const rows = [
    { studentName: "Riya Verma", classLabel: "V A", rollNo: "11", fromDate: "2026-09-08", toDate: "2026-09-10", days: 3, typeLabel: "Sick leave", reason: "Fever", requestedAt: "2026-09-04T10:00:00.000Z", approver: "Class teacher" },
    { studentName: "Kabir Ali", classLabel: "VI B", rollNo: "9", fromDate: "2026-09-06", toDate: "2026-09-06", days: 1, typeLabel: "Leave", reason: "Family function in Jaipur, will return by Sunday evening train", requestedAt: "2026-09-02T08:00:00.000Z", approver: "Class teacher" },
    { studentName: "Aarav Sharma", classLabel: "V B", rollNo: "4", fromDate: "2026-09-07", toDate: "2026-09-14", days: 8, typeLabel: "Medical leave", reason: "", requestedAt: "2026-09-05T06:00:00.000Z", approver: "Principal" },
  ];
  const t = formatPendingLeavesReply({ todayIso: "2026-09-05", scope: "school", rows, approvedToday: 2 });
  assert.ok(t.startsWith("*Pending leave requests* · school\n3 waiting · oldest first"), t);
  assert.ok(t.indexOf("Kabir Ali") < t.indexOf("Riya Verma") && t.indexOf("Riya Verma") < t.indexOf("Aarav Sharma"), "oldest request first");
  assert.ok(t.includes("*Kabir Ali* · VI B · roll 9\n6 Sep · Leave · Family function in Jaipur, will return by Sunday evening…\nasked 3d ago · approver: Class teacher"), t);
  assert.ok(t.includes("*Riya Verma* · V A · roll 11\n8 Sep–10 Sep (3d) · Sick leave · Fever\nasked yesterday"), t);
  assert.ok(t.includes("*Aarav Sharma* · V B · roll 4\n7 Sep–14 Sep (8d) · Medical leave\nasked today · approver: Principal"), t);
  assert.ok(t.includes("2 students on approved leave today."), t);
  assert.ok(t.endsWith("Approve or reject in the ERP: Attendance → Leave."));

  const none = formatPendingLeavesReply({ todayIso: "2026-09-05", scope: "section", scopeLabel: "V A", rows: [], approvedToday: 0 });
  assert.ok(none.startsWith("*Pending leave requests* · V A\nNothing waiting for approval. ✅"), none);
  const mine = formatPendingLeavesReply({ todayIso: "2026-09-05", scope: "mine", rows: [], approvedToday: 0 });
  assert.ok(mine.includes("· your sections"));
}

console.log("erpCommands.selftest.ts OK");
