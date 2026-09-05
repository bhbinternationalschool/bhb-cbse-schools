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
  type PendingErpConfirm,
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
  assert.equal(parseErpCommandLocal("commands")?.commandId, "help");
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

console.log("erpCommands.selftest.ts OK");
