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
  assert.equal(parseErpCommandLocal("Class 3 defaulters"), null, "class dues is a later command, not student fees");
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

console.log("erpCommands.selftest.ts OK");
