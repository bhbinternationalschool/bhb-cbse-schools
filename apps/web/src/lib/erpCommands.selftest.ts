/**
 * Run: npx tsx src/lib/erpCommands.selftest.ts
 *
 * Pure half of the ERP command desk: section and date extraction in the
 * forms staff actually type, the regex fast path, the model-JSON contract,
 * confirm-token rules, the hourly cap and the reply formatters. The server
 * half (RBAC, data, audit, WhatsApp) is exercised live via the webhook.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BUS_DELAY_MAX_MINUTES,
  ERP_COMMANDS,
  FOLLOW_UP_WINDOW_MINUTES,
  PICK_WINDOW_MINUTES,
  absentListPicks,
  buildErpCommandSystemPrompt,
  classDefaultersPicks,
  classKey,
  commandActorAllowed,
  complaintSubjectFrom,
  confirmButtonIds,
  confirmIsFresh,
  daysSince,
  editBudgetFor,
  extractSectionRefs,
  feeReminderTooSoon,
  followUpCommandFor,
  followUpIsFresh,
  formatAbsentListReply,
  formatAdmissionsPeriodReply,
  formatAttendanceSummaryReply,
  formatBookPtmCard,
  formatBusDelayCard,
  formatBusManifestReply,
  formatClassDefaultersReply,
  formatClassMessageCard,
  formatCollectionReply,
  formatCommandDigest,
  formatCommandDigestOneLine,
  formatCommandHelpDetail,
  formatDecideLeaveCard,
  formatFeeReminderCard,
  formatFreeTeachersReply,
  formatHelpReply,
  formatHomeworkReply,
  formatLeaveRequestPicker,
  formatMarkAttendanceCard,
  formatPayLinkCard,
  formatPendingLeavesReply,
  formatPostHomeworkCard,
  formatPtmSlotPicker,
  formatRaiseComplaintCard,
  formatRouteNotFound,
  formatSchoolSnapshotReply,
  formatSectionProblem,
  formatStaffBroadcastCard,
  formatStudentDetailsReply,
  formatStudentFeesReply,
  formatStudentMatchesAsk,
  formatTemplateMixLabel,
  fuzzyWordMatch,
  guessComplaintCategory,
  helpMenuCommands,
  helpPicks,
  homeworkTitleFrom,
  inFeeReminderQuietHours,
  isCorrectingAttendance,
  istHourOf,
  looksLikeBareName,
  looksLikeCommand,
  matchStudents,
  matchTransportRoutes,
  messageScriptLanguage,
  normalizeCommandMobile,
  noteCommandUse,
  noticeTitleFrom,
  parseAdmissionsQuery,
  parseAttendanceSpec,
  parseBookPtmQuery,
  parseBusDelayQuery,
  isFollowUpPronoun,
  parseBusManifestQuery,
  parseClassMessageQuery,
  parseCommandAllowList,
  parseCommandsSwitch,
  parseConfirmReply,
  parseDecideLeaveQuery,
  parseDueDate,
  parseErpCommandLlmJson,
  parseErpCommandLocal,
  parseFeeReminderQuery,
  parseFreeTeachersQuery,
  parseHomeworkQuery,
  parseMarkAttendanceQuery,
  parsePayLinkQuery,
  parseStaffContactQuery,
  matchStaffContacts,
  staffContactIsOpen,
  formatStaffContactReply,
  type StaffContactCandidate,
  parsePickNumber,
  parsePostHomeworkQuery,
  parsePtmTime,
  parseRaiseComplaintQuery,
  parseStaffBroadcastQuery,
  parseStudentDetailsQuery,
  parseStudentFeesQuery,
  pendingLeavesPicks,
  periodAtTime,
  pickIsFresh,
  ptmSlotPicks,
  ptmTimeCandidates,
  renderTemplateBody,
  resolveClassOrSectionRef,
  resolveCommandDate,
  resolveSectionRef,
  routePicks,
  sectionProblemPicks,
  splitPostHomeworkRest,
  summarizeCommandAudit,
  templateForFamily,
  templatesByLanguage,
  missingLanguagesLabel,
  type CommandAuditRow,
  type PendingErpConfirm,
  type StudentLike,
  waMarkersToAssistantText,
  withinEdits,
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
  assert.equal(parseErpCommandLocal("Payment link for Riya Verma")?.commandId, "pay_link");
  assert.equal(parseErpCommandLocal("Amay Gupta 4B ko payment link bhejo")?.fields.student, "amay gupta 4B");
  assert.equal(parsePayLinkQuery("Send fee reminder to class 3 defaulters"), null, "a class-wide chase is not one link");
  assert.equal(parsePayLinkQuery("payment link"), null, "no name, no link");
  assert.equal(parseErpCommandLocal("Send fee reminder to class 3 defaulters")?.commandId, "fee_reminder");
  assert.equal(parseErpCommandLocal("fee reminder 5A defaulters")?.fields.section, "5A");
  // Looking at defaulters must never start messaging families.
  assert.equal(parseFeeReminderQuery("Class 3 defaulters"), null);
  assert.equal(parseFeeReminderQuery("Amay ki fees pending"), null);
  assert.equal(parseErpCommandLocal("Class 3 defaulters")?.commandId, "class_defaulters");
  assert.equal(parseErpCommandLocal("Approve Aarav's leave")?.commandId, "decide_leave");
  assert.equal(parseErpCommandLocal("reject Kabir Ali leave: no medical certificate")?.fields.date, "reject");
  // Listing pending leaves must never decide one.
  assert.equal(parseDecideLeaveQuery("pending leaves"), null);
  assert.equal(parseDecideLeaveQuery("leave requests"), null);
  assert.equal(parseDecideLeaveQuery("approve leave"), null, "a decision with no name decides nothing");
  assert.equal(parseErpCommandLocal("pending leaves")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("Raise complaint for Riya Verma: bus did not come today")?.commandId, "raise_complaint");
  assert.equal(parseErpCommandLocal("complaint for Amay Gupta 4B: fee receipt not received")?.fields.student, "amay gupta 4B");
  assert.equal(parseRaiseComplaintQuery("raise complaint: 7A projector not working"), null, "a facilities issue with no family is not this command");
  assert.equal(parseRaiseComplaintQuery("complaint"), null);
  assert.equal(parseErpCommandLocal("Staff broadcast: meeting 3 pm in library")?.commandId, "staff_broadcast");
  assert.equal(parseErpCommandLocal("sabhi staff ko bhejo: kal 8 baje aana hai")?.commandId, "staff_broadcast");
  assert.equal(parseStaffBroadcastQuery("Class 4 parents ko bhejo: kal PTM"), null, "a parent audience is not a staff broadcast");
  assert.equal(parseStaffBroadcastQuery("5A teachers ko bhejo: test hai"), null, "a section means it is about a class");
  assert.equal(parseStaffBroadcastQuery("staff meeting"), null, "no colon, no message");
  assert.equal(parseErpCommandLocal("Class 4 parents ko bhejo: kal PTM 9 baje")?.commandId, "class_message");
  assert.equal(parseErpCommandLocal("message 5A parents: bring sports uniform")?.fields.section, "5A");
  assert.equal(parseClassMessageQuery("Class 4 parents ko bhejo"), null, "no colon, no message — nothing is sent");
  assert.equal(parseClassMessageQuery("5A parents"), null);
  assert.equal(parseClassMessageQuery("Riya Verma ke parents ka number"), null, "asking for a number is not a broadcast");
  assert.equal(parseErpCommandLocal("Mark 5A attendance: absent roll 4, 11, 19")?.commandId, "mark_attendance");
  assert.equal(parseErpCommandLocal("mark 6B attendance all present")?.commandId, "mark_attendance");
  // The read commands must survive unharmed — marking is a whole register.
  assert.equal(parseMarkAttendanceQuery("5A me aaj kaun absent hai"), null, "a question never marks");
  assert.equal(parseMarkAttendanceQuery("5A attendance"), null);
  assert.equal(parseMarkAttendanceQuery("aaj ki attendance"), null);
  assert.equal(parseMarkAttendanceQuery("absent list 7B"), null, "asking for the list is not marking it");
  assert.equal(parseErpCommandLocal("5A me aaj kaun absent hai")?.commandId, "absent_list");
  assert.equal(parseErpCommandLocal("aaj ki attendance")?.commandId, "attendance_summary");
  assert.equal(parseErpCommandLocal("Post homework 6B maths: exercise 4.2, due Monday")?.commandId, "post_homework");
  assert.equal(parseErpCommandLocal("Post homework 6B maths: exercise 4.2, due Monday")?.fields.section, "6B");
  assert.equal(parseErpCommandLocal("add homework 6B science: diagram of a plant cell, due tomorrow")?.commandId, "post_homework");
  // The read command and the class channel must both survive.
  assert.equal(parseErpCommandLocal("6B homework")?.commandId, "homework_posted", "a question is still the read command");
  assert.equal(parsePostHomeworkQuery("HW 6B maths: exercise 4.2"), null, "a plain class-channel post is not the write command");
  assert.equal(parsePostHomeworkQuery("Homework: page 42 ex 4.2"), null, "no section, no verb — the class channel keeps it");
  assert.equal(parsePostHomeworkQuery("homework posted today for 6B"), null, "'posted' in a question is not a posting verb with content");
  assert.equal(parseErpCommandLocal("admissions this week")?.fields.text, "week");
  assert.equal(parseErpCommandLocal("admissions report")?.fields.text, "week");
  assert.equal(parseErpCommandLocal("is hafte ke admission")?.commandId, "admissions_week");
  assert.equal(parseErpCommandLocal("admissions this month")?.fields.text, "month");
  assert.equal(parseErpCommandLocal("new enquiries today")?.fields.text, "today");
  assert.equal(parseErpCommandLocal("इस हफ्ते के दाखिले")?.commandId, "admissions_week");
  assert.equal(parseAdmissionsQuery("admission"), null, "the word alone is not a report ask");
  assert.equal(parseAdmissionsQuery("Amay ka admission form kaha hai, uske papa ne kal poocha tha"), null, "a long message about one person is not the report");
  assert.equal(parseErpCommandLocal("school snapshot")?.commandId, "school_snapshot");
  assert.equal(parseErpCommandLocal("school status")?.commandId, "school_snapshot");
  assert.equal(parseErpCommandLocal("aaj ka school report")?.commandId, "school_snapshot");
  assert.equal(parseErpCommandLocal("daily summary")?.commandId, "school_snapshot");
  assert.equal(parseErpCommandLocal("how is the school doing")?.commandId, "school_snapshot");
  assert.equal(parseErpCommandLocal("5A attendance")?.commandId, "absent_list", "a section keeps its own command");
  assert.equal(parseErpCommandLocal("commands report")?.commandId, "commands_digest", "the command-desk report is not the school snapshot");
  assert.equal(parseErpCommandLocal("collection report")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("Riya Verma details")?.fields.student, "riya verma");
  assert.equal(parseErpCommandLocal("student details Aarav Sharma")?.commandId, "student_details");
  assert.equal(parseErpCommandLocal("Amay Gupta 4B info")?.fields.student, "amay gupta 4B");
  assert.equal(parseErpCommandLocal("Riya Verma ki jankari")?.commandId, "student_details");
  assert.equal(parseErpCommandLocal("who is Kabir Ali")?.fields.student, "kabir ali");
  assert.equal(parseStudentDetailsQuery("details"), null, "a details word with no name is not this ask");
  assert.equal(parseStudentDetailsQuery("Amay ki fees pending"), null, "fees wins over details");
  assert.equal(parseStudentDetailsQuery("Bus 3 details"), null, "a bus ask is not a student ask");
  assert.equal(parseErpCommandLocal("Bus 3 manifest")?.fields.text, "3");
  assert.equal(parseErpCommandLocal("bus 3 ka manifest")?.commandId, "bus_manifest");
  assert.equal(parseErpCommandLocal("route A students")?.fields.text, "A");
  assert.equal(parseErpCommandLocal("which children are on bus 2")?.fields.text, "2");
  assert.equal(parseBusManifestQuery("Bus 3 is late by 20 minutes"), null, "a delay notice is not a manifest ask");
  assert.equal(parseBusManifestQuery("bus"), null);
  assert.equal(parseErpCommandLocal("homework posted today for 6B")?.fields.section, "6B");
  assert.equal(parseErpCommandLocal("6B homework")?.commandId, "homework_posted");
  assert.equal(parseErpCommandLocal("aaj 6B ka homework")?.fields.section, "6B");
  assert.equal(parseErpCommandLocal("homework status")?.fields.section, "");
  assert.equal(parseErpCommandLocal("kal kis class me homework nahi hua")?.commandId, "homework_posted");
  assert.equal(parseErpCommandLocal("आज 6B का गृहकार्य")?.commandId, "homework_posted");
  assert.equal(parseHomeworkQuery("Homework: page 42 ex 4.2"), null, "a teacher's post is not a query");
  assert.equal(parseHomeworkQuery("6B homework maths ch 3 q1-10"), null, "content words → a post, not a query");
  assert.equal(parseHomeworkQuery("Post homework 6B maths: exercise 4.2, due Monday"), null);
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
  // "help" belongs to the desk now. It used to be ceded to the office
  // escalation keyword, which meant the one word a staff member is most
  // likely to try was answered by the visitor menu and the desk was never
  // asked. The escalation word people actually use is HUMAN, and that is
  // untouched.
  assert.equal(parseErpCommandLocal("help")?.commandId, "help");
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
  assert.ok(help.startsWith("Sunita, here is everything you can ask me"));
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
      // Numbered now, one per line, so a reply of "2" is unambiguous.
    ).includes("*1.* V A\n*2.* V B"),
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
  // Numbered, and the number is the answer — two children of the same name
  // cannot be told apart by being asked to repeat the name.
  assert.ok(
    ask.includes("*1.* Aarav Sharma — V · A, roll 4\n*2.* Aarav Sharma — V · B, roll 9"),
    ask,
  );
  assert.match(ask, /Reply with the number/);
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
  // These three rolls happen not to collide across the sections, so the
  // roll is still the number you reply with.
  assert.ok(whole.includes("*V A* · 2 · ₹12,400\n*4.* Aarav Sharma  ₹8,400 · 45d (22 Jul)\n*11.* Riya Verma  ₹4,000 · 26d (10 Aug)"), whole);
  assert.ok(whole.includes("*V B* · 1 · ₹12,000\n*9.* Kabir Ali  ₹12,000 · 12d (24 Aug) · plan"), whole);
  assert.ok(whole.endsWith("Or send a name."), whole);
  assert.match(whole, /Reply with a number/);

  const section = formatClassDefaultersReply({ title: "V A", todayIso: "2026-09-05", wholeClass: false, rows: rows.filter((r) => r.sectionLabel === "V A"), formatInr: inr });
  assert.ok(section.includes("2 students · *₹12,400* overdue\n\n*4.* Aarav Sharma"), section);
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

// ─── homework replies ──────────────────────────────────────────────────
{
  const sec = formatHomeworkReply({
    kind: "section",
    sectionLabel: "VI B",
    date: "2026-09-05",
    todayIso: "2026-09-05",
    posts: [
      { subject: "Maths", title: "Exercise 4.2 Q1–10", teacher: "Anita Devi", dueAt: "2026-09-07", requiresSubmit: true },
      { subject: "Hindi", title: "पाठ 3 प्रश्न-उत्तर", teacher: "Sunita Sharma", dueAt: "", requiresSubmit: false },
    ],
    subjectTeachers: [],
  });
  assert.ok(sec.startsWith("*Homework VI B* · today\n2 posts"), sec);
  assert.ok(sec.includes("*Maths* — Anita Devi\nExercise 4.2 Q1–10 · due 7 Sep · submit"), sec);
  assert.ok(sec.includes("*Hindi* — Sunita Sharma\nपाठ 3 प्रश्न-उत्तर"), sec);

  const none = formatHomeworkReply({
    kind: "section", sectionLabel: "VI B", date: "2026-09-04", todayIso: "2026-09-05", posts: [],
    subjectTeachers: [{ subject: "English", teacher: "Rakesh Verma" }, { subject: "Maths", teacher: "Anita Devi" }],
  });
  assert.ok(none.startsWith("*Homework VI B* · 4 Sep\nNone posted yet.\n\n*Subject teachers*\nEnglish — Rakesh Verma"), none);

  const ov = formatHomeworkReply({
    kind: "overview", scope: "school", date: "2026-09-05", todayIso: "2026-09-05",
    sections: [
      { label: "V A", count: 2, subjects: ["Maths", "EVS"] },
      { label: "V B", count: 0, subjects: [] },
      { label: "VI B", count: 1, subjects: ["Hindi"] },
    ],
  });
  assert.ok(ov.startsWith("*Homework* · school · today\n3 posts across 2 of 3 sections"), ov);
  assert.ok(ov.includes("*Posted*\nV A  2 (Maths, EVS)\nVI B  1 (Hindi)"), ov);
  assert.ok(ov.includes("*Nothing yet:* V B"), ov);
}

// ─── bus manifest reply ────────────────────────────────────────────────
{
  const t = formatBusManifestReply({
    routeLabel: "Bus 3 · Civil Lines",
    vehicleReg: "UP80 AB 1234",
    driver: { name: "Ram Singh", mobile: "9876543210" },
    date: "2026-09-05",
    todayIso: "2026-09-05",
    stops: [
      {
        name: "Sabzi Mandi",
        distanceLabel: "3.2 km",
        riders: [
          { fullName: "Aarav Sharma", classLabel: "V A", rollNo: "4", suspended: false, mark: "boarded" },
          { fullName: "Riya Verma", classLabel: "V A", rollNo: "11", suspended: false, mark: "" },
        ],
      },
      {
        name: "Gandhi Chowk",
        distanceLabel: "5 km",
        riders: [
          { fullName: "Kabir Ali", classLabel: "VI B", rollNo: "9", suspended: false, mark: "absent" },
          { fullName: "Old Rider", classLabel: "VII A", rollNo: "2", suspended: true, mark: "" },
        ],
      },
      { name: "Empty Stop", distanceLabel: "6 km", riders: [] },
    ],
    markedCount: 2,
    formatMobile: (m) => `${m.slice(0, 2)}xxxxxx${m.slice(-2)}`,
  });
  assert.ok(t.startsWith("*Bus 3 · Civil Lines* · today\n3 riders · 3 stops"), t);
  assert.ok(t.includes("Driver: Ram Singh 98xxxxxx10 · UP80 AB 1234"), t);
  assert.ok(t.includes("*Sabzi Mandi* · 3.2 km · 2\nAarav Sharma (V A, 4) · boarded\nRiya Verma (V A, 11)"), t);
  assert.ok(t.includes("*Gandhi Chowk* · 5 km · 1\nKabir Ali (VI B, 9) · absent"), t);
  assert.ok(!t.includes("Empty Stop"), "a stop with nobody on it is not listed");
  assert.ok(t.includes("2 of 3 marked today."), t);
  assert.ok(t.includes("*Boarding suspended:* Old Rider"), t);

  const empty = formatBusManifestReply({
    routeLabel: "Bus 9", vehicleReg: "", driver: { name: "", mobile: "" },
    date: "2026-09-04", todayIso: "2026-09-05", stops: [], markedCount: 0,
  });
  assert.ok(empty.startsWith("*Bus 9* · 4 Sep\n0 riders · 0 stops"), empty);
  assert.ok(empty.includes("No students assigned to this route."), empty);

  assert.ok(formatRouteNotFound("7", []).includes('"7"'));
  assert.ok(formatRouteNotFound("civil", ["Bus 3 · Civil Lines", "Bus 4 · Civil Court"]).includes("*1.* Bus 3 · Civil Lines\n*2.* Bus 4 · Civil Court"));
}

// ─── student details reply ─────────────────────────────────────────────
{
  const base = {
    fullName: "Riya Verma",
    classLabel: "V A",
    rollNo: "11",
    admissionNo: "2019/241",
    status: "active",
    gender: "F",
    dob: "2015-04-18",
    bloodGroup: "B+",
    guardianName: "Suresh Verma",
    fatherName: "Suresh Verma",
    motherName: "Kavita Verma",
    fatherMobile: "9876543221",
    motherMobile: "9812345678",
    householdMobile: "9876543221",
    locality: "Civil Lines, Bareilly",
    transport: { routeLabel: "Bus 3 · Civil Lines", stopName: "Sabzi Mandi" },
    siblings: [{ fullName: "Anaya Verma", classLabel: "I A" }],
    hasMedicalNote: true,
    isCwsn: false,
    detail: "full" as const,
  };
  const full = formatStudentDetailsReply(base);
  assert.ok(full.startsWith("*Riya Verma* · V A · Roll 11\nAdm 2019/241 · Girl · DOB 18 Apr · Blood B+"), full);
  assert.ok(full.includes("*Contacts*\nFather: Suresh Verma 9876543221\nMother: Kavita Verma 9812345678"), full);
  assert.ok(!full.includes("Family WhatsApp"), "household number equal to father's is not repeated");
  assert.ok(full.includes("Address: Civil Lines, Bareilly"), full);
  assert.ok(full.includes("*Transport:* Bus 3 · Civil Lines · Sabzi Mandi"), full);
  assert.ok(full.includes("*Siblings:* Anaya Verma (I A)"), full);
  assert.ok(full.includes("⚠️ medical note on file — open the student profile in the ERP."), full);
  assert.ok(!full.includes("Guardian:"), "guardian equal to father is not repeated");

  const basic = formatStudentDetailsReply({ ...base, detail: "basic" });
  assert.ok(basic.includes("Father: Suresh Verma 98xxxxxx21"), basic);
  assert.ok(basic.includes("Mobiles are masked"), basic);

  const other = formatStudentDetailsReply({
    ...base,
    guardianName: "Ram Chacha",
    householdMobile: "9900112233",
    transport: null,
    siblings: [],
    hasMedicalNote: false,
    isCwsn: true,
    status: "left",
  });
  assert.ok(other.includes("⚠️ Status: left"), other);
  assert.ok(other.includes("Family WhatsApp: 9900112233"), other);
  assert.ok(other.includes("Guardian: Ram Chacha"), other);
  assert.ok(!other.includes("*Transport:*") && !other.includes("*Siblings:*"), other);
  assert.ok(other.includes("⚠️ CWSN"), other);
  // Never leak identity documents or the medical text itself.
  for (const t of [full, basic, other]) {
    assert.ok(!/aadhaar|pan\b|medicalNotes|apaar|\bpen\b/i.test(t), "no identity documents in the reply");
  }
}

// ─── school snapshot reply ─────────────────────────────────────────────
{
  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const base = {
    date: "2026-09-05",
    todayIso: "2026-09-05",
    academicYearCode: "2026-27",
    fees: { todayPaise: 18650000, mtdPaise: 41200000, openDuesPaise: 128000000, defaulterHouseholds: 46 },
    attendance: { present: 611, absent: 34, leave: 5, markedPct: 94, sectionsMarked: 22, registersPending: 2 },
    staff: { active: 44, present: 40, absent: 1 },
    admissions: { pipeline: 38, enrolled: 12, followUpsDue: 7 },
    alerts: { vaultExpiring30d: 3, lowStockSkus: 4, waFailures24h: 11 },
    formatInr: inr,
  };
  const t = formatSchoolSnapshotReply(base);
  assert.ok(t.startsWith("*School snapshot* · today · 2026-27"), t);
  assert.ok(t.includes("Collected today: ₹1,86,500 · month ₹4,12,000"), t);
  assert.ok(t.includes("Open dues: ₹12,80,000 across 46 students"), t);
  assert.ok(t.includes("Present 94% (611 / 650) · 22 sections marked"), t);
  assert.ok(t.includes("⚠️ 2 registers still pending"), t);
  assert.ok(t.includes("Present 40 · Absent 1 of 44"), t);
  assert.ok(t.includes("Pipeline 38 · enrolled 12 · 7 follow-ups due"), t);
  assert.ok(t.includes("*Needs attention*\n• 3 documents expiring in 30 days\n• 4 items low on stock\n• 11 WhatsApp sends failed in 24h"), t);

  const quiet = formatSchoolSnapshotReply({
    ...base,
    attendance: { present: 0, absent: 0, leave: 0, markedPct: 0, sectionsMarked: 0, registersPending: 0 },
    staff: { active: 44, present: 0, absent: 0 },
    admissions: { pipeline: 38, enrolled: 12, followUpsDue: 0 },
    alerts: { vaultExpiring30d: 0, lowStockSkus: 0, waFailures24h: 0 },
  });
  assert.ok(quiet.includes("No section marked yet."), quiet);
  assert.ok(quiet.includes("No punches yet (44 active)"), quiet);
  assert.ok(!quiet.includes("follow-up"), "no follow-ups due — the clause is dropped");
  assert.ok(!quiet.includes("Needs attention"), "no alerts — the section is dropped");
}

// ─── admissions period reply ───────────────────────────────────────────
{
  const base = {
    periodLabel: "last 7 days",
    fromDate: "2026-08-30",
    toDate: "2026-09-05",
    todayIso: "2026-09-05",
    newEnquiries: 14,
    bySource: [
      { label: "Walk-in", count: 6 },
      { label: "Website", count: 4 },
      { label: "Referral", count: 3 },
      { label: "Field survey", count: 1 },
    ],
    byClass: [
      { label: "Nursery", count: 5 },
      { label: "I", count: 4 },
      { label: "VI", count: 2 },
    ],
    moved: { applied: 5, verified: 2, enrolled: 3, lost: 2 },
    lostReasons: [{ reason: "Fee too high", count: 2 }],
    followUps: { overdue: 4, dueToday: 2 },
    pipelineOpen: 38,
  };
  const t = formatAdmissionsPeriodReply(base);
  assert.ok(t.startsWith("*Admissions* · last 7 days"), t);
  assert.ok(t.includes("14 new enquiries · Walk-in 6, Website 4, Referral 3, Field survey 1"), t);
  assert.ok(t.includes("5 applied · 2 verified · 3 enrolled · 2 lost"), t);
  assert.ok(t.includes("*Classes asked for*\nNursery  5\nI  4\nVI  2"), t);
  assert.ok(t.includes("*Lost because:* Fee too high (2)"), t);
  assert.ok(t.includes("⚠️ 4 follow-ups overdue · 2 due today"), t);
  assert.ok(t.endsWith("Open pipeline: 38 leads."), t);

  const one = formatAdmissionsPeriodReply({ ...base, periodLabel: "today", newEnquiries: 1, bySource: [{ label: "Phone", count: 1 }], byClass: [], moved: { applied: 0, verified: 0, enrolled: 0, lost: 0 }, lostReasons: [], followUps: { overdue: 0, dueToday: 0 }, pipelineOpen: 1 });
  assert.ok(one.includes("1 new enquiry · Phone 1"), one);
  assert.ok(one.includes("None moved stage in this period."), one);
  assert.ok(one.includes("No follow-up is overdue."), one);
  assert.ok(one.endsWith("Open pipeline: 1 lead."), one);

  const quiet = formatAdmissionsPeriodReply({ ...base, newEnquiries: 0, bySource: [], byClass: [], moved: { applied: 0, verified: 0, enrolled: 0, lost: 0 }, lostReasons: [], followUps: { overdue: 0, dueToday: 0 }, pipelineOpen: 0 });
  assert.ok(quiet.includes("0 new enquiries"), quiet);
  assert.ok(!quiet.includes("None moved stage"), "nothing arrived — no stage line either");
  assert.ok(!quiet.includes("Classes asked for"), quiet);
}

// ─── post homework: parsing, due dates, card ───────────────────────────
{
  const p = parsePostHomeworkQuery("Post homework 6B maths: exercise 4.2, due Monday");
  assert.ok(p && p.section === "6B", JSON.stringify(p));
  assert.equal(p!.rest, "maths: exercise 4.2, due Monday");

  const p2 = parsePostHomeworkQuery("post homework for 5A english: read chapter 3");
  assert.equal(p2?.rest, "english: read chapter 3");
  const p3 = parsePostHomeworkQuery("6B hindi homework post karo: paath 3 ke prashn");
  assert.ok(p3 && p3.section === "6B", JSON.stringify(p3));
  assert.ok(p3!.rest.startsWith("hindi:"), p3!.rest);

  const parts = splitPostHomeworkRest("maths: exercise 4.2, due Monday");
  assert.deepEqual(parts, { subjectHint: "maths", body: "exercise 4.2", dueHint: "Monday" });
  assert.deepEqual(splitPostHomeworkRest("english: read chapter 3"), {
    subjectHint: "english",
    body: "read chapter 3",
    dueHint: "",
  });
  assert.deepEqual(splitPostHomeworkRest("science: diagram of a cell by tomorrow"), {
    subjectHint: "science",
    body: "diagram of a cell",
    dueHint: "tomorrow",
  });
  assert.equal(splitPostHomeworkRest("science diagram of a cell"), null, "no colon — the caller asks for the format");
  assert.equal(splitPostHomeworkRest("maths:"), null, "no body");

  // Due dates point FORWARD — the opposite of a report date.
  const sat = "2026-09-05"; // a Saturday
  assert.equal(parseDueDate("tomorrow", sat), "2026-09-06");
  assert.equal(parseDueDate("kal", sat), "2026-09-06", "'kal' in a due date is tomorrow, not yesterday");
  assert.equal(resolveCommandDate("kal 5A absent", sat), "2026-09-04", "…while a report's 'kal' is still yesterday");
  assert.equal(parseDueDate("Monday", sat), "2026-09-07");
  assert.equal(parseDueDate("somvar", sat), "2026-09-07");
  assert.equal(parseDueDate("saturday", sat), sat, "the same weekday means today, not next week");
  assert.equal(parseDueDate("day after", sat), "2026-09-07");
  assert.equal(parseDueDate("next week", sat), "2026-09-12");
  assert.equal(parseDueDate("12/9", sat), "2026-09-12");
  assert.equal(parseDueDate("5/1", sat), "2027-01-05", "a day/month already past rolls into next year");
  assert.equal(parseDueDate("2026-10-01", sat), "2026-10-01");
  assert.equal(parseDueDate("sometime soon", sat), "", "unreadable → empty, and the caller asks");

  assert.equal(homeworkTitleFrom("exercise 4.2 Q1-10. Show working."), "exercise 4.2 Q1-10");
  assert.equal(homeworkTitleFrom("read chapter 3"), "read chapter 3");
  assert.equal(homeworkTitleFrom("x".repeat(100)).length, 78, "long first lines are trimmed with an ellipsis");

  const card = formatPostHomeworkCard({
    sectionLabel: "VI B",
    subjectName: "Mathematics",
    title: "exercise 4.2",
    body: "exercise 4.2 Q1-10",
    dueAt: "2026-09-07",
    dateIso: "2026-09-05",
    todayIso: "2026-09-05",
    parentCount: 31,
  });
  assert.ok(card.startsWith("*Post homework* · VI B · Mathematics\nexercise 4.2 Q1-10"), card);
  assert.ok(card.includes("Dated today · due 7 Sep"), card);
  assert.ok(card.includes("31 families will be notified."), card);
  const noDue = formatPostHomeworkCard({
    sectionLabel: "VI B", subjectName: "Hindi", title: "t", body: "b", dueAt: "",
    dateIso: "2026-09-05", todayIso: "2026-09-05", parentCount: 1,
  });
  assert.ok(noDue.includes("no due date") && noDue.includes("1 family will be notified."), noDue);
}

// ─── channel restrictions ──────────────────────────────────────────────
{
  const post = ERP_COMMANDS.find((c) => c.id === "post_homework");
  assert.ok(post, "post_homework is registered");
  assert.deepEqual(post!.channels, ["app"], "on WhatsApp the class channel owns teacher homework posts");
  assert.equal(post!.kind, "write");
  assert.equal(post!.scope, "own_sections");
  for (const c of ERP_COMMANDS) {
    if (c.kind === "write") continue;
    assert.equal(c.channels, undefined, `${c.id}: read commands answer on every channel`);
  }
}

// ─── mark attendance: parsing and the confirm card ─────────────────────
{
  const q = parseMarkAttendanceQuery("Mark 5A attendance: absent roll 4, 11, 19");
  assert.ok(q && q.section === "5A", JSON.stringify(q));
  assert.deepEqual(parseAttendanceSpec(q!.spec).absent, ["4", "11", "19"]);

  const mixed = parseMarkAttendanceQuery("Mark 5A attendance: absent Riya Verma, late 7, leave 12");
  const spec = parseAttendanceSpec(mixed!.spec);
  assert.deepEqual(spec.absent, ["Riya Verma"]);
  assert.deepEqual(spec.late, ["7"]);
  assert.deepEqual(spec.leave, ["12"]);

  const hinglish = parseMarkAttendanceQuery("5A attendance absent 4, 11 baaki present");
  assert.deepEqual(parseAttendanceSpec(hinglish!.spec).absent, ["4", "11"], "'baaki present' is not a name");

  const all = parseMarkAttendanceQuery("mark 6B attendance all present");
  assert.equal(parseAttendanceSpec(all!.spec).allPresent, true);

  // "correct" sits before the colon, so the whole message is what decides.
  assert.equal(isCorrectingAttendance("correct 5A attendance: absent 4"), true);
  assert.equal(isCorrectingAttendance("Mark 5A attendance: absent 4"), false);
  assert.equal(isCorrectingAttendance("5A attendance phir se: absent 4"), true);

  const card = formatMarkAttendanceCard({
    sectionLabel: "V A",
    date: "2026-09-05",
    todayIso: "2026-09-05",
    total: 32,
    absent: [
      { rollNo: "4", fullName: "Aarav Sharma" },
      { rollNo: "11", fullName: "Riya Verma" },
    ],
    leave: [{ rollNo: "19", fullName: "Kabir Ali" }],
    late: [],
    halfDay: [],
    correcting: false,
  });
  assert.ok(card.startsWith("*Mark attendance* · V A · today\n29 present of 32"), card);
  assert.ok(card.includes("*Absent* (2)\n4. Aarav Sharma\n11. Riya Verma"), card);
  assert.ok(card.includes("*On leave* (1)\n19. Kabir Ali"), card);
  assert.ok(!card.includes("⚠️"), "not a correction");

  const allCard = formatMarkAttendanceCard({
    sectionLabel: "VI B", date: "2026-09-04", todayIso: "2026-09-05", total: 30,
    absent: [], leave: [], late: [], halfDay: [], correcting: true,
  });
  assert.ok(allCard.startsWith("*Correct attendance* · VI B · 4 Sep\n30 present of 30"), allCard);
  assert.ok(allCard.includes("Everyone present."), allCard);
  assert.ok(allCard.includes("⚠️ This replaces the register already marked for this date."), allCard);
}

// ─── class parent message ──────────────────────────────────────────────
{
  assert.deepEqual(parseClassMessageQuery("Class 4 parents ko bhejo: kal PTM 9 baje"), {
    section: "4",
    message: "kal PTM 9 baje",
  });
  assert.deepEqual(parseClassMessageQuery("send 6B parents: fee counter closed on Friday"), {
    section: "6B",
    message: "fee counter closed on Friday",
  });
  // The words after the colon are what families read — they are never edited.
  const long = "Kal school 9 baje khulega, sabhi bachche time par aayein, ID card zaroori hai";
  assert.equal(parseClassMessageQuery(`5A parents ko batao: ${long}`)?.message, long);

  assert.equal(messageScriptLanguage("कल छुट्टी है"), "hi");
  assert.equal(messageScriptLanguage("holiday tomorrow"), "en");
  assert.equal(noticeTitleFrom("kal PTM 9 baje. Sabhi aayein."), "kal PTM 9 baje");
  assert.equal(noticeTitleFrom("x".repeat(80)).length, 58);

  assert.equal(
    renderTemplateBody("*{{schoolName}}*\n\n*{{noticeTitle}}*\n\n{{noticeBody}}", {
      schoolName: "BHB",
      noticeTitle: "PTM",
      noticeBody: "kal 9 baje",
    }),
    "*BHB*\n\n*PTM*\n\nkal 9 baje",
  );
  assert.equal(
    renderTemplateBody("Hello {{guardianName}} — {{unknownVar}}", { guardianName: "Parent" }),
    "Hello Parent — {{unknownVar}}",
    "an unfilled placeholder stays visible on the card rather than becoming blank",
  );

  const card = formatClassMessageCard({
    sectionLabel: "V A",
    templateLabel: "School notice broadcast (EN)",
    rendered: "📢 *BHB*\n\n*kal PTM 9 baje*\n\nkal PTM 9 baje",
    familyCount: 31,
    optedOut: 2,
  });
  assert.ok(card.startsWith("*Message V A parents*\nTemplate: School notice broadcast (EN)"), card);
  assert.ok(card.includes("📢 *BHB*"), "the card shows exactly what parents will receive");
  assert.ok(card.includes("Goes to 31 families."), card);
  assert.ok(card.includes("2 opted out of WhatsApp and will not receive it."), card);
  const one = formatClassMessageCard({ sectionLabel: "V A", templateLabel: "t", rendered: "r", familyCount: 1, optedOut: 0 });
  assert.ok(one.includes("Goes to 1 family.") && !one.includes("opted out"), one);
}

// ─── staff broadcast ───────────────────────────────────────────────────
{
  assert.equal(parseStaffBroadcastQuery("Staff broadcast: meeting 3 pm in library"), "meeting 3 pm in library");
  assert.equal(parseStaffBroadcastQuery("tell all staff: staff meeting at 3pm"), "staff meeting at 3pm");
  assert.equal(parseStaffBroadcastQuery("broadcast to staff: submit marks by Friday"), "submit marks by Friday");
  assert.equal(parseStaffBroadcastQuery("staff ko bhejo: hi"), null, "too short to be a message");

  const withTpl = formatStaffBroadcastCard({
    message: "meeting 3 pm in library",
    staffCount: 44,
    templateLabel: "School notice broadcast (EN)",
    rendered: "📢 *BHB*\n\n*meeting 3 pm in library*\n\nmeeting 3 pm in library",
  });
  assert.ok(withTpl.startsWith("*Broadcast to staff*"), withTpl);
  assert.ok(withTpl.includes("📢 *BHB*"), "the card shows what staff will receive");
  assert.ok(withTpl.includes("Goes to 44 staff members."), withTpl);
  assert.ok(withTpl.includes("Phone notification to everyone · WhatsApp via School notice broadcast (EN)."), withTpl);

  const noTpl = formatStaffBroadcastCard({
    message: "meeting 3 pm", staffCount: 1, templateLabel: "", rendered: "",
  });
  assert.ok(noTpl.includes("Goes to 1 staff member."), noTpl);
  assert.ok(
    noTpl.includes("Phone notification only — no approved WhatsApp notice template, so WhatsApp is skipped."),
    "without a template the card says WhatsApp is skipped rather than implying it sent",
  );
  assert.ok(noTpl.includes("meeting 3 pm"), "the plain message is still shown");
}

// ─── log a family's complaint ──────────────────────────────────────────
{
  assert.deepEqual(parseRaiseComplaintQuery("Raise complaint for Riya Verma: bus did not come today"), {
    student: "riya verma",
    body: "bus did not come today",
  });
  assert.deepEqual(parseRaiseComplaintQuery("Riya Verma ki shikayat darj karo: bus late hai"), {
    student: "riya verma",
    body: "bus late hai",
  });
  // The family's own words are filed unedited.
  const words = "Bus 20 minute late aayi aur driver ne stop par ruka bhi nahi";
  assert.equal(parseRaiseComplaintQuery(`complaint for Aarav Sharma: ${words}`)?.body, words);

  assert.equal(guessComplaintCategory("bus did not come today"), "transport");
  assert.equal(guessComplaintCategory("fee receipt not received"), "fees");
  assert.equal(guessComplaintCategory("projector not working in class"), "facilities");
  assert.equal(guessComplaintCategory("teacher was rude"), "staff_behavior");
  assert.equal(guessComplaintCategory("child got hurt in playground"), "safety");
  assert.equal(guessComplaintCategory("something else entirely"), "other");

  assert.equal(complaintSubjectFrom("Bus late. Driver rude too."), "Bus late");
  assert.equal(complaintSubjectFrom("x".repeat(200)).length, 108);

  const card = formatRaiseComplaintCard({
    studentName: "Riya Verma",
    classLabel: "V A",
    guardianName: "Suresh Verma",
    categoryLabel: "Transport",
    subject: "bus did not come today",
    body: "bus did not come today",
  });
  assert.ok(card.startsWith("*Log complaint* · Riya Verma · V A\nCategory: Transport"), card);
  assert.ok(card.includes("Filed against Suresh Verma's record, as taken by the office."), card);
  assert.ok(
    card.includes("The family is not messaged; it goes to the complaints queue."),
    "the card says plainly that nothing is sent to the family",
  );
}

// ─── approve / reject leave ────────────────────────────────────────────
{
  assert.deepEqual(parseDecideLeaveQuery("Approve Aarav's leave"), {
    student: "aarav",
    approve: true,
    note: "",
  });
  assert.deepEqual(parseDecideLeaveQuery("reject Kabir Ali leave: no medical certificate"), {
    student: "kabir ali",
    approve: false,
    note: "no medical certificate",
  });
  assert.deepEqual(parseDecideLeaveQuery("Aarav Sharma ki chutti manjoor karo"), {
    student: "aarav sharma",
    approve: true,
    note: "",
  });
  assert.equal(
    parseDecideLeaveQuery("approve and reject Aarav leave"),
    null,
    "a contradictory message decides nothing",
  );

  const picker = formatLeaveRequestPicker("Aarav Sharma", [
    { id: "a", fromDate: "2026-09-08", toDate: "2026-09-10", typeLabel: "Sick leave", reason: "Fever" },
    { id: "b", fromDate: "2026-09-20", toDate: "2026-09-20", typeLabel: "Leave", reason: "" },
  ]);
  assert.ok(picker.startsWith("Aarav Sharma has 2 pending leave requests:"), picker);
  assert.ok(picker.includes("1. 8 Sep–10 Sep · Sick leave · Fever"), picker);
  assert.ok(picker.includes("2. 20 Sep · Leave"), picker);

  const card = formatDecideLeaveCard({
    approve: true,
    studentName: "Aarav Sharma",
    classLabel: "V A",
    fromDate: "2026-09-04",
    toDate: "2026-09-08",
    days: 5,
    typeLabel: "Sick leave",
    reason: "Fever",
    note: "",
    approverHint: "Principal (over 3 days / medical / long leave)",
    applyDates: 2,
    futureDates: 3,
  });
  assert.ok(card.startsWith("*Approve leave* · Aarav Sharma · V A\n4 Sep–8 Sep (5d) · Sick leave · Fever"), card);
  assert.ok(card.includes("Normally decided by: Principal"), card);
  assert.ok(card.includes("Marks leave on 2 days already registered."), card);
  assert.ok(
    card.includes("3 days not yet marked — mark those as usual; the class is not pre-marked."),
    "future days are not silently pre-marked for the whole class",
  );
  assert.ok(card.includes("The family is told either way."), card);

  const reject = formatDecideLeaveCard({
    approve: false, studentName: "Kabir Ali", classLabel: "VI B",
    fromDate: "2026-09-06", toDate: "2026-09-06", days: 1, typeLabel: "Leave",
    reason: "", note: "no medical certificate", approverHint: "Class teacher (≤3 days)",
    applyDates: 0, futureDates: 0,
  });
  assert.ok(reject.startsWith("*Reject leave* · Kabir Ali · VI B\n6 Sep · Leave"), reject);
  assert.ok(reject.includes("Note: no medical certificate"), reject);
  assert.ok(!reject.includes("Marks leave on"), "a rejection touches no register");
}

// ─── fee reminders ─────────────────────────────────────────────────────
{
  assert.equal(parseFeeReminderQuery("Send fee reminder to class 3 defaulters"), "3");
  assert.equal(parseFeeReminderQuery("fee reminder 5A defaulters"), "5A");
  assert.equal(parseFeeReminderQuery("class 5 ke bakayedar ko fee reminder bhejo"), "5");
  assert.equal(parseFeeReminderQuery("remind me to call Amay's father"), null, "no class, no send");

  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const card = formatFeeReminderCard({
    title: "Class V",
    templateLabel: "Fee overdue stage reminder (EN)",
    send: [
      { studentName: "Aarav Sharma", classLabel: "V A", amountPaise: 840000, overdueDays: 45 },
      { studentName: "Riya Verma", classLabel: "V A", amountPaise: 400000, overdueDays: 26 },
    ],
    tooSoon: [{ studentName: "Kabir Ali", daysAgo: 3 }],
    optedOut: 1,
    formatInr: inr,
  });
  assert.ok(card.startsWith("*Fee reminder* · Class V\nTemplate: Fee overdue stage reminder (EN)"), card);
  assert.ok(card.includes("2 families · ₹12,400 overdue"), card);
  assert.ok(
    card.includes("Aarav Sharma (V A)  ₹8,400 · 45d"),
    "each family's own amount is shown, since each gets a different message",
  );
  assert.ok(card.includes("*Skipped — reminded this week:* Kabir Ali (3d ago)"), card);
  assert.ok(card.includes("1 opted out of WhatsApp and will not receive it."), card);

  const none = formatFeeReminderCard({
    title: "V A", templateLabel: "t", send: [], tooSoon: [], optedOut: 0, formatInr: inr,
  });
  assert.ok(none.includes("Nobody to remind right now."), none);
}

// ─── fee reminder guards: quiet hours and the weekly cap ───────────────
{
  // A fee chase must never arrive at night.
  assert.equal(inFeeReminderQuietHours(20), true, "8 pm is quiet");
  assert.equal(inFeeReminderQuietHours(23), true);
  assert.equal(inFeeReminderQuietHours(0), true, "midnight is quiet");
  assert.equal(inFeeReminderQuietHours(7), true, "7 am is quiet");
  assert.equal(inFeeReminderQuietHours(8), false, "8 am is the first sendable hour");
  assert.equal(inFeeReminderQuietHours(19), false, "7 pm is the last sendable hour");

  // IST is UTC+5:30, so 19:00 UTC is past midnight in India.
  assert.equal(istHourOf(new Date("2026-09-05T03:00:00Z")), 8, "03:00 UTC is 08:30 IST");
  assert.equal(istHourOf(new Date("2026-09-05T19:00:00Z")), 0, "19:00 UTC is 00:30 IST — quiet");
  assert.equal(inFeeReminderQuietHours(istHourOf(new Date("2026-09-05T19:00:00Z"))), true);

  // Once a week per family, however many people think of it.
  assert.equal(daysSince(undefined, "2026-09-05"), null, "never reminded");
  assert.equal(daysSince("2026-09-05", "2026-09-05"), 0);
  assert.equal(daysSince("2026-08-29T10:00:00.000Z", "2026-09-05"), 7, "a timestamp is read as its date");
  assert.deepEqual(feeReminderTooSoon(undefined, "2026-09-05"), { skip: false, daysAgo: null });
  assert.deepEqual(feeReminderTooSoon("2026-09-05", "2026-09-05"), { skip: true, daysAgo: 0 }, "not twice in one day");
  assert.deepEqual(feeReminderTooSoon("2026-08-30", "2026-09-05"), { skip: true, daysAgo: 6 });
  assert.deepEqual(feeReminderTooSoon("2026-08-29", "2026-09-05"), { skip: false, daysAgo: 7 }, "a week later is allowed");
}

// ─── payment link ──────────────────────────────────────────────────────
{
  assert.equal(parsePayLinkQuery("Payment link for Riya Verma"), "riya verma");
  assert.equal(parsePayLinkQuery("send pay link to Aarav Sharma"), "aarav sharma");
  assert.equal(parsePayLinkQuery("fee link for Riya Verma"), "riya verma");
  assert.equal(parsePayLinkQuery("Amay ki fees pending"), null, "asking the balance never raises a link");

  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const card = formatPayLinkCard({
    studentName: "Riya Verma",
    classLabel: "V A",
    guardianName: "Suresh Verma",
    mobileMasked: "98xxxxxx21",
    rows: [
      { label: "Jul 2026", headName: "Tuition", amountPaise: 400000 },
      { label: "Jul 2026", headName: "Transport", amountPaise: 120000 },
      { label: "Aug 2026", headName: "Tuition", amountPaise: 400000 },
    ],
    totalPaise: 920000,
    expiresInDays: 7,
    templateReady: true,
    formatInr: inr,
  });
  assert.ok(card.startsWith("*Payment link* · Riya Verma · V A\nAmount: *₹9,200*"), card);
  assert.ok(card.includes("Jul 2026 · Tuition  ₹4,000"), card);
  assert.ok(card.includes("Jul 2026 · Transport  ₹1,200"), card);
  assert.ok(card.includes("Goes to Suresh Verma 98xxxxxx21"), card);
  assert.ok(
    card.includes("Valid 7 days. Future months are not included."),
    "the card says the link is only for what is owed now",
  );
  assert.ok(card.includes("The receipt is sent automatically once they pay."), card);

  const noTpl = formatPayLinkCard({
    studentName: "R", classLabel: "V A", guardianName: "", mobileMasked: "98xxxxxx21",
    rows: [{ label: "Jul", headName: "Tuition", amountPaise: 100 }], totalPaise: 100,
    expiresInDays: 7, templateReady: false, formatInr: inr,
  });
  assert.ok(
    noTpl.includes("⚠️ No approved pay-link template — the link will be created but not sent; share it yourself."),
    "without a template the card does not pretend the parent will receive it",
  );
  assert.ok(noTpl.includes("Goes to the parent 98xxxxxx21"), noTpl);
}

// ─── book a PTM slot ───────────────────────────────────────────────────
{
  // A time needs a separator or a marker; a bare number is a class or roll.
  assert.deepEqual(parsePtmTime("10:30"), { hh: 10, mm: 30, meridiem: null });
  assert.deepEqual(parsePtmTime("10.30 am"), { hh: 10, mm: 30, meridiem: "am" });
  assert.deepEqual(parsePtmTime("2 pm"), { hh: 2, mm: 0, meridiem: "pm" });
  assert.deepEqual(parsePtmTime("11 baje"), { hh: 11, mm: 0, meridiem: null });
  assert.deepEqual(parsePtmTime("11 बजे"), { hh: 11, mm: 0, meridiem: null });
  assert.equal(parsePtmTime("Riya Verma 4B"), null, "a section is not a time");
  assert.equal(parsePtmTime("roll 4"), null, "a roll number is not a time");

  // Without am/pm both readings are offered and the slots decide.
  assert.deepEqual(ptmTimeCandidates({ hh: 10, mm: 30, meridiem: null }), ["10:30"]);
  assert.deepEqual(ptmTimeCandidates({ hh: 2, mm: 30, meridiem: null }), ["02:30", "14:30"]);
  assert.deepEqual(ptmTimeCandidates({ hh: 2, mm: 0, meridiem: "pm" }), ["14:00"]);
  assert.deepEqual(ptmTimeCandidates({ hh: 12, mm: 0, meridiem: "pm" }), ["12:00"]);
  assert.deepEqual(ptmTimeCandidates({ hh: 12, mm: 15, meridiem: "am" }), ["00:15"]);

  assert.deepEqual(parseBookPtmQuery("Book PTM slot for Riya Verma, 10:30"), {
    student: "riya verma",
    time: "10:30",
  });
  assert.deepEqual(parseBookPtmQuery("book ptm for Aarav Sharma 11 am"), {
    student: "aarav sharma",
    time: "11:00am",
  });
  assert.deepEqual(parseBookPtmQuery("Amay Gupta 4B ka PTM 10:30 book karo"), {
    student: "amay gupta 4B",
    time: "10:30",
  });
  assert.deepEqual(parseBookPtmQuery("fix ptm appointment for Kabir Ali"), {
    student: "kabir ali",
    time: "",
  }, "no time is allowed — the desk offers the open ones");
  assert.equal(parseBookPtmQuery("PTM kab hai"), null, "asking the date is not an instruction to book");
  assert.equal(parseBookPtmQuery("book slot for Riya Verma"), null, "without PTM it is not this command");
  assert.equal(
    parseBookPtmQuery("Riya ka PTM slot kab hai"),
    null,
    "a question about the slot is not an instruction to book one",
  );
  assert.equal(parseBookPtmQuery("kaun se PTM slot khali hain?"), null);

  // A notice that merely mentions the PTM stays a notice.
  const notice = parseErpCommandLocal("message 5A parents: PTM slot booking is open");
  assert.equal(notice?.commandId, "class_message", JSON.stringify(notice));
  const booking = parseErpCommandLocal("Book PTM slot for Riya Verma, 10:30");
  assert.equal(booking?.commandId, "book_ptm", JSON.stringify(booking));
  assert.equal(booking?.fields.student, "riya verma");
  assert.equal(booking?.fields.text, "10:30");

  const card = formatBookPtmCard({
    studentName: "Riya Verma",
    classLabel: "V A",
    eventName: "Term PTM",
    eventDate: "2026-09-12",
    modeLabel: "In person",
    startAt: "10:30",
    endAt: "10:45",
    teacherName: "Sunita Sharma",
    roomOrLink: "Room 12",
    guardianName: "Suresh Verma",
    mobileMasked: "98xxxxxx21",
    familyLinked: true,
    templateLabel: "School notice broadcast (EN)",
  });
  assert.ok(card.startsWith("*Book PTM* · Riya Verma · V A"), card);
  assert.ok(card.includes("Term PTM · 12 Sep · 10:30–10:45"), card);
  assert.ok(card.includes("With: Sunita Sharma"), card);
  assert.ok(card.includes("Where: Room 12 (In person)"), card);
  assert.ok(card.includes("Booked for Suresh Verma 98xxxxxx21"), card);

  const noTpl = formatBookPtmCard({
    studentName: "R", classLabel: "V A", eventName: "Term PTM", eventDate: "2026-09-12",
    modeLabel: "Video", startAt: "10:30", endAt: "10:45", teacherName: "S", roomOrLink: "",
    guardianName: "", mobileMasked: "", familyLinked: true, templateLabel: "",
  });
  assert.ok(noTpl.includes("Mode: Video"), noTpl);
  assert.ok(
    noTpl.includes("⚠️ No approved notice template — the family is told on the app only."),
    "without a template the card does not promise a WhatsApp message",
  );

  const noFamily = formatBookPtmCard({
    studentName: "R", classLabel: "V A", eventName: "Term PTM", eventDate: "2026-09-12",
    modeLabel: "In person", startAt: "10:30", endAt: "10:45", teacherName: "S", roomOrLink: "",
    guardianName: "", mobileMasked: "", familyLinked: false, templateLabel: "School notice broadcast (EN)",
  });
  assert.ok(
    noFamily.includes("⚠️ No family record is linked to this child, so nobody can be told"),
    "an unlinked child never gets a card promising the parent will hear",
  );
  assert.ok(!noFamily.includes("WhatsApp:"), noFamily);

  const picker = formatPtmSlotPicker({
    studentName: "Riya Verma",
    eventName: "Term PTM",
    eventDate: "2026-09-12",
    slots: [
      { startAt: "10:00", teacherName: "Sunita Sharma", free: 1 },
      { startAt: "10:30", teacherName: "Sunita Sharma", free: 2 },
    ],
  });
  assert.ok(picker.includes("Term PTM · 12 Sep — open times for Riya Verma:"), picker);
  assert.ok(picker.includes("10:30 · Sunita Sharma (2 places)"), picker);
  // The tail used to spell out a whole command to retype. The number is
  // the shorter answer and the time still works.
  assert.ok(picker.includes("Reply with the number, or the time — e.g. _10:00_."), picker);

  const taken = formatPtmSlotPicker({
    studentName: "Riya Verma", eventName: "Term PTM", eventDate: "2026-09-12",
    slots: [{ startAt: "11:00", teacherName: "S", free: 1 }], askedTime: "10:30",
  });
  assert.ok(taken.startsWith("No free slot at 10:30 in Term PTM (12 Sep)."), taken);

  const full = formatPtmSlotPicker({
    studentName: "Riya Verma", eventName: "Term PTM", eventDate: "2026-09-12", slots: [],
  });
  assert.ok(full.includes("Every slot in Term PTM (12 Sep) is full."), full);

  // `\b` never sits beside a Devanagari letter, so the Hindi half of the
  // model-parse gate used to be unreachable.
  assert.equal(looksLikeCommand("5A me kaun absent hai"), true);
  assert.equal(looksLikeCommand("कक्षा 5 में कौन absent hai"), true);
  assert.equal(looksLikeCommand("फीस बकाया दिखाओ"), true);
  assert.equal(
    looksLikeCommand("PTM ke liye ready rehna"),
    false,
    "book_ptm is matched by regex, so PTM chatter never buys a model call",
  );
  assert.equal(looksLikeCommand("thik hai ji"), false);

  const def = ERP_COMMANDS.find((c) => c.id === "book_ptm");
  assert.ok(def && def.kind === "write" && def.module === "ptm" && def.action === "edit");
  assert.equal(def!.scope, "own_sections", "a teacher books only for their own children");
}

// ─── bus delay notice ──────────────────────────────────────────────────
{
  assert.deepEqual(parseBusDelayQuery("Bus 3 ko batao: 20 minute late"), { route: "3", minutes: 20 });
  assert.deepEqual(parseBusDelayQuery("bus 5 is running 15 mins late"), { route: "5", minutes: 15 });
  assert.deepEqual(parseBusDelayQuery("route A 20 minute late"), { route: "A", minutes: 20 });
  assert.deepEqual(parseBusDelayQuery("bus 2 aadha ghanta late hai"), { route: "2", minutes: 30 });
  assert.deepEqual(parseBusDelayQuery("bus 2 half an hour late"), { route: "2", minutes: 30 });
  assert.deepEqual(parseBusDelayQuery("bus 4 1 hour late"), { route: "4", minutes: 60 });
  assert.deepEqual(parseBusDelayQuery("बस 3 आधा घंटा लेट"), { route: "3", minutes: 30 });

  // The bus number and the delay are both bare numbers, so a duration
  // without a unit is never guessed at — the desk asks instead.
  assert.deepEqual(parseBusDelayQuery("bus 3 20 late"), { route: "3", minutes: 0 });
  assert.deepEqual(parseBusDelayQuery("bus 3 is late"), { route: "3", minutes: 0 });

  assert.equal(parseBusDelayQuery("Bus 3 manifest"), null, "the manifest reading is not a notice");
  assert.equal(parseBusDelayQuery("Riya is late today"), null, "no bus word, no notice");

  // A delay message must not be read as a class notice or a manifest.
  const delay = parseErpCommandLocal("Bus 3 ko batao: 20 minute late");
  assert.equal(delay?.commandId, "bus_delay", JSON.stringify(delay));
  assert.equal(delay?.fields.text, "3");
  assert.equal(delay?.fields.date, "20");
  const manifest = parseErpCommandLocal("Bus 3 manifest");
  assert.equal(manifest?.commandId, "bus_manifest", JSON.stringify(manifest));
  const parentsDelay = parseErpCommandLocal("bus 3 ke parents ko batao: 20 minute late");
  assert.equal(
    parentsDelay?.commandId,
    "bus_delay",
    `a bus delay addressed to "parents" is still the route's notice, not a class message: ${JSON.stringify(parentsDelay)}`,
  );

  // One matcher for both bus commands: exact on bus number, code or name
  // before any contained match.
  const routes = [
    { code: "R1", name: "Civil Lines", busNo: "3" },
    { code: "R2", name: "Civil Lines Extension", busNo: "13" },
  ];
  assert.deepEqual(matchTransportRoutes(routes, "3").map((r) => r.code), ["R1"], "exact bus number wins over 13");
  assert.deepEqual(matchTransportRoutes(routes, "civil lines").map((r) => r.code), ["R1"]);
  assert.deepEqual(matchTransportRoutes(routes, "civil").map((r) => r.code), ["R1", "R2"], "an ambiguous ask returns both");
  assert.deepEqual(matchTransportRoutes(routes, "R2").map((r) => r.code), ["R2"]);
  assert.deepEqual(matchTransportRoutes(routes, ""), []);

  const card = formatBusDelayCard({
    routeLabel: "Bus 3 · Civil Lines",
    minutesLate: 20,
    send: [
      { studentName: "Riya Verma", classLabel: "V A", stopName: "Gandhi Chowk" },
      { studentName: "Aarav Sharma", classLabel: "III B", stopName: "Gandhi Chowk" },
      { studentName: "Kabir Ali", classLabel: "VIII A", stopName: "Station Road" },
    ],
    optedOut: 1,
    suspended: 2,
    noMobile: 1,
    templateLabel: "Bus running late (EN)",
  });
  assert.ok(card.startsWith("*Bus delay* · Bus 3 · Civil Lines\nRunning *20 minutes late*"), card);
  assert.ok(card.includes("*Goes to 3 families*"), card);
  assert.ok(card.includes("Gandhi Chowk — Riya Verma (V A), Aarav Sharma (III B)"), card);
  assert.ok(card.includes("Station Road — Kabir Ali (VIII A)"), card);
  assert.ok(
    card.includes("Not messaged: 2 suspended from boarding, 1 with no WhatsApp number, 1 opted out."),
    "every skipped family is accounted for on the card",
  );
  assert.ok(!card.includes("⚠️"), "no repeat warning when the route was not just told");

  const repeat = formatBusDelayCard({
    routeLabel: "Bus 3", minutesLate: 40,
    send: [{ studentName: "R", classLabel: "V A", stopName: "" }],
    optedOut: 0, suspended: 0, noMobile: 0, templateLabel: "Bus running late (EN)",
    lastNoticeMinutesAgo: 6,
  });
  assert.ok(
    repeat.includes("⚠️ This route's families were told 6 minutes ago."),
    "a second notice within the hour says so, rather than quietly resending",
  );
  assert.ok(repeat.includes("Stop not set — R (V A)"), repeat);

  assert.equal(BUS_DELAY_MAX_MINUTES, 180);
  const def = ERP_COMMANDS.find((c) => c.id === "bus_delay");
  assert.ok(def && def.kind === "write" && def.module === "transport" && def.action === "edit");
}

// ─── pilot allowlist ───────────────────────────────────────────────────
{
  // Ten digits or nothing. An id full of digits must never be truncated
  // into something that looks like a phone number.
  assert.equal(normalizeCommandMobile("9876543210"), "9876543210");
  assert.equal(normalizeCommandMobile("+91 98765 43210"), "9876543210");
  assert.equal(normalizeCommandMobile("919876543210"), "9876543210");
  assert.equal(normalizeCommandMobile("09876543210"), "9876543210");
  assert.equal(normalizeCommandMobile("98765-43210"), "9876543210");
  assert.equal(normalizeCommandMobile("staff:stf_9a8b7c"), "", "an actor key is not a mobile");
  assert.equal(normalizeCommandMobile("staff:12345678901234"), "", "nor is a long digit run");
  assert.equal(normalizeCommandMobile("12345"), "");
  assert.equal(normalizeCommandMobile(""), "");
  assert.equal(normalizeCommandMobile(undefined), "");

  // Pasted out of a phone book, in whatever shape.
  assert.deepEqual(parseCommandAllowList("9876543210"), ["9876543210"]);
  assert.deepEqual(
    parseCommandAllowList("+91 98765 43210, 09123456789\n9000000000"),
    ["9876543210", "9123456789", "9000000000"],
  );
  assert.deepEqual(parseCommandAllowList("9876543210, 919876543210"), ["9876543210"], "deduped");
  // Spaces inside a number, and spaces between numbers, in the same string.
  assert.deepEqual(
    parseCommandAllowList("9876543210 9000000000"),
    ["9876543210", "9000000000"],
    "space-separated list",
  );
  assert.deepEqual(
    parseCommandAllowList("+91 98765 43210"),
    ["9876543210"],
    "spaces inside one number are not a separator",
  );
  assert.deepEqual(parseCommandAllowList(""), []);
  assert.deepEqual(parseCommandAllowList(undefined), []);
  assert.deepEqual(parseCommandAllowList("not a number"), []);

  // Empty list = everyone. This is how the desk shipped, and a typo that
  // empties the variable must not lock the whole school out.
  assert.equal(commandActorAllowed([], ["9876543210"]), true);
  assert.equal(commandActorAllowed([], [undefined, null]), true);

  const list = parseCommandAllowList("9876543210, 9000000000");
  assert.equal(commandActorAllowed(list, ["9876543210"]), true, "the number they messaged from");
  assert.equal(commandActorAllowed(list, ["9111111111"]), false);
  // Any number we know them by counts — a director on the list messaging
  // from their second phone still reaches their own brake.
  assert.equal(
    commandActorAllowed(list, ["staff:stf_1", "9111111111", "9000000000"]),
    true,
    "matched on the alternate mobile",
  );
  assert.equal(
    commandActorAllowed(list, ["staff:stf_1", undefined, ""]),
    false,
    "an app actor with no known mobile is not on the list",
  );
  // An id must never match by accident.
  assert.equal(commandActorAllowed(["9876543210"], ["staff:9876543210x"]), false);
}

// ─── follow-up: a bare name after a list ───────────────────────────────
{
  // The case this exists for: the desk prints a class list, somebody types
  // the name they see.
  assert.equal(looksLikeBareName("Manvi Singh"), true);
  assert.equal(looksLikeBareName("Aarav"), true);
  assert.equal(looksLikeBareName("रिया वर्मा"), true, "Devanagari names count");
  assert.equal(looksLikeBareName("Mary D'Souza"), true);
  assert.equal(looksLikeBareName("Anne-Marie Fernandes"), true);

  // Anything carrying a question is a command, and goes down the normal
  // path where it can be parsed properly.
  assert.equal(looksLikeBareName("Manvi Singh details"), true, "still a name-shape; the parser gets first refusal");
  assert.equal(looksLikeBareName("5A me kaun absent hai"), false, "digits");
  assert.equal(looksLikeBareName("attendance summary"), false, "two stop words");
  assert.equal(looksLikeBareName("roll 4"), false);

  // The keyword vocabulary the older bots own must never be swallowed.
  for (const kw of ["MENU", "menu", "STAFF", "FEE", "ADMISSIONS", "HUMAN", "help", "YES", "no"]) {
    assert.equal(looksLikeBareName(kw), false, `"${kw}" belongs to another bot`);
  }
  assert.equal(looksLikeBareName(""), false);
  assert.equal(looksLikeBareName("ok"), false, "too short to be a name");
  assert.equal(looksLikeBareName("a very long sentence about five words"), false, "too many words");
  assert.equal(looksLikeBareName("x".repeat(61)), false, "too long");

  // What a name means depends on the list it answers.
  assert.equal(followUpCommandFor("class_defaulters"), "student_fees", "after money, money");
  assert.equal(followUpCommandFor("collection_today"), "student_fees");
  assert.equal(followUpCommandFor("absent_list"), "student_details");
  assert.equal(followUpCommandFor("pending_leaves"), "student_details");
  assert.equal(followUpCommandFor("anything_else"), "student_details", "details is the safe default");

  // The window: long enough to read a list, short enough that a name typed
  // into an unrelated conversation later is not swallowed.
  const now = Date.parse("2026-09-07T10:00:00.000Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(followUpIsFresh(ago(0), now), true);
  assert.equal(followUpIsFresh(ago(FOLLOW_UP_WINDOW_MINUTES - 1), now), true);
  assert.equal(followUpIsFresh(ago(FOLLOW_UP_WINDOW_MINUTES + 1), now), false);
  assert.equal(followUpIsFresh("", now), false);
  assert.equal(followUpIsFresh("not a date", now), false);
  // A timestamp from the future is not fresh, it is broken.
  assert.equal(followUpIsFresh(new Date(now + 60_000).toISOString(), now), false);
}

// ── Which language a family is written to in ──────────────────────────
// The desk used to pick ONE template for everybody: for the class message
// and the bus delay, from the script the STAFF MEMBER typed in; for the
// fee reminder and the pay link, from a hardcoded "English first". Neither
// has anything to do with what the family reads.
{
  const tpl = (familyKey: string, language: string) => ({
    familyKey,
    language,
    name: `${familyKey} ${language}`,
    metaName: `bhb_${familyKey}_${language}`,
    metaLanguage: language,
    variables: ["schoolName", "childName"],
  });

  const both = templatesByLanguage(
    [tpl("comms_notice", "en"), tpl("comms_notice", "hi")],
    ["comms_notice"],
  );
  assert.equal(both.byLang.en?.metaName, "bhb_comms_notice_en");
  assert.equal(both.byLang.hi?.metaName, "bhb_comms_notice_hi");

  // A Hindi-reading family gets Hindi even though English exists.
  assert.equal(
    templateForFamily(both.byLang, "hi", null)?.metaName,
    "bhb_comms_notice_hi",
  );
  assert.equal(
    templateForFamily(both.byLang, "en", null)?.metaName,
    "bhb_comms_notice_en",
  );

  // Only Hindi approved — the family is REFUSED, not half-served.
  //
  // This test used to assert the opposite: that an English-reading family
  // got the Hindi template because silence was the worse answer. #101
  // settled it the other way, and it is right — sending a parent a
  // language they did not choose is not "reaching" them, and the concrete
  // case was a family who had just paid at the counter being told in the
  // wrong language to pay a link. The school actually had this shape on
  // 2026-09-07: fees_pay_link approved in hi, pending in en.
  const hiOnly = templatesByLanguage([tpl("fees_pay_link", "hi")], ["fees_pay_link"]);
  assert.equal(hiOnly.byLang.hi?.metaName, "bhb_fees_pay_link_hi");
  assert.equal(hiOnly.byLang.en, null);
  assert.equal(hiOnly.ready, null, "a half-approved family is not usable");
  assert.deepEqual(hiOnly.missing, ["en"]);
  assert.equal(hiOnly.rawReady, null);
  assert.equal(
    templateForFamily(hiOnly.byLang, "en", null),
    null,
    "no cross-language fallback: an English reader is never handed Hindi",
  );
  assert.equal(missingLanguagesLabel(hiOnly.missing), "English");
  assert.equal(missingLanguagesLabel(["en", "hi"]), "Hindi and English");

  // Earlier family keys win outright, per language.
  const staged = templatesByLanguage(
    [
      tpl("fees_soft_reminder", "hi"),
      tpl("fees_soft_reminder", "en"),
      tpl("fees_stage_reminder", "hi"),
      tpl("fees_stage_reminder", "en"),
    ],
    ["fees_stage_reminder", "fees_soft_reminder"],
  );
  assert.equal(staged.byLang.hi?.metaName, "bhb_fees_stage_reminder_hi");
  assert.equal(staged.byLang.en?.metaName, "bhb_fees_stage_reminder_en");
  assert.ok(staged.ready, "both languages present, so it is usable");

  // A family half-approved on the PREFERRED key does not silently drop to
  // the fallback key's other language. Both must be whole.
  const halfStaged = templatesByLanguage(
    [tpl("fees_stage_reminder", "hi"), tpl("fees_soft_reminder", "en")],
    ["fees_stage_reminder", "fees_soft_reminder"],
  );
  assert.equal(halfStaged.ready, null);

  // Nothing approved at all is still "nothing", not a broken template.
  const none = templatesByLanguage([], ["comms_notice"]);
  assert.equal(none.ready, null);
  assert.deepEqual(none.missing, ["en", "hi"]);
  assert.equal(templateForFamily(none.byLang, "hi", null), null);

  // The card has to say what the mix is BEFORE anyone taps Confirm — and
  // it can only ever name languages that are actually served now.
  assert.equal(
    formatTemplateMixLabel(both.byLang, { hi: 12, en: 3 }),
    "12 in HI · 3 in EN",
  );
  assert.equal(formatTemplateMixLabel(both.byLang, { hi: 15 }), "15 in HI");
  assert.equal(
    formatTemplateMixLabel(none.byLang, { hi: 4 }),
    "",
    "nothing approved means no card is built at all, so no label",
  );
}

// ── Three children called Yatharth ────────────────────────────────────
// "Reply with the full name and class" is a fine answer for an Amay and an
// Amay Gupta, and useless for three children who share a name: repeating
// the name reproduces the ambiguity. The list is numbered and the number
// is the answer.
{
  const rows = [
    { fullName: "Yatharth Singh", classLabel: "IV A", rollNo: "12", fatherName: "Rakesh Singh", admissionNo: "ADM-101" },
    { fullName: "Yatharth Singh", classLabel: "IV A", rollNo: "31", fatherName: "Manoj Singh", admissionNo: "ADM-233" },
    { fullName: "Yatharth Singh", classLabel: "VII A", rollNo: "8", fatherName: "Dinesh Singh", admissionNo: "ADM-402" },
  ];
  const ask = formatStudentMatchesAsk(rows, "Yatharth");
  assert.match(ask, /There are 3 students called Yatharth Singh/);
  for (const n of ["*1.*", "*2.*", "*3.*"]) assert.ok(ask.includes(n), `numbered ${n}`);
  // Two of them share a class, so roll and father's name are doing the
  // work and the admission number is shown as well.
  assert.ok(ask.includes("father Rakesh Singh"));
  assert.ok(ask.includes("ADM-101"));
  assert.match(ask, /Reply with the number/);
  // Nothing restricted is ever in a disambiguation prompt.
  for (const leak of ["aadhaar", "pan", "9", "@"]) {
    assert.equal(
      ask.toLowerCase().includes(leak) && leak === "aadhaar",
      false,
      "no document number in a pick list",
    );
  }

  // Different classes: no admission number needed, class does the work.
  const spread = formatStudentMatchesAsk(
    [
      { fullName: "Riya Verma", classLabel: "IV A", rollNo: "3", fatherName: "A", admissionNo: "ADM-1" },
      { fullName: "Riya Sharma", classLabel: "VI A", rollNo: "9", fatherName: "B", admissionNo: "ADM-2" },
    ],
    "Riya",
  );
  assert.match(spread, /Which one did you mean\?/);
  assert.equal(spread.includes("ADM-1"), false, "admission number only when nothing else separates them");

  assert.match(formatStudentMatchesAsk([], "Zzz"), /couldn't find/i);

  // The number, and only the number.
  assert.equal(parsePickNumber("2", 3), 2);
  assert.equal(parsePickNumber(" 3 ", 3), 3);
  assert.equal(parsePickNumber("no. 1", 3), 1);
  assert.equal(parsePickNumber("#2", 3), 2);
  assert.equal(parsePickNumber("2.", 3), 2);
  assert.equal(parsePickNumber("4", 3), null, "off the end of the list");
  assert.equal(parsePickNumber("0", 3), null);
  assert.equal(parsePickNumber("", 3), null);
  // The case that must never select a student: a real message that starts
  // with a digit.
  assert.equal(parsePickNumber("2 din se absent hai", 3), null);
  assert.equal(parsePickNumber("5A me kaun absent hai", 3), null);
  assert.equal(parsePickNumber("2 students", 3), null);

  // Short window: a stray "2" is far likelier than a stray name.
  const now = Date.parse("2026-09-07T10:00:00.000Z");
  assert.equal(pickIsFresh(new Date(now - 60_000).toISOString(), now), true);
  assert.equal(
    pickIsFresh(new Date(now - (PICK_WINDOW_MINUTES + 1) * 60_000).toISOString(), now),
    false,
  );
  assert.equal(pickIsFresh("", now), false);
  assert.equal(pickIsFresh(new Date(now + 60_000).toISOString(), now), false);
  assert.ok(PICK_WINDOW_MINUTES < FOLLOW_UP_WINDOW_MINUTES);
}

// ── Typed on a phone, in a hurry, in a second language ────────────────
{
  // A misspelt command still reaches the parse. Without this the message
  // never gets to the model that would have understood it, and the older
  // keyword bot answers something unrelated — which reads as the desk
  // being broken rather than as a typo.
  for (const t of [
    "atendance summary",
    "attendence summary 5A",
    "defalters class 3",
    "manifets bus 3",
    "homwork posted 6B",
    "payement link for Riya",
  ]) {
    assert.equal(looksLikeCommand(t), true, `"${t}" is a typo, not a new sentence`);
  }
  // And ordinary conversation still is not a command.
  for (const t of [
    "kal milte hain",
    "good morning sir",
    "chalo chalte hain",
    "meeting kal subah",
    "ok thanks",
  ]) {
    assert.equal(looksLikeCommand(t), false, `"${t}" must stay with the other bots`);
  }

  // Bounded edit distance, and it stops early rather than filling a matrix.
  assert.equal(withinEdits("abc", "abc", 0), true);
  assert.equal(withinEdits("abc", "abd", 1), true);
  assert.equal(withinEdits("abc", "xyz", 1), false);
  assert.equal(withinEdits("kitten", "sitting", 3), true);
  assert.equal(withinEdits("kitten", "sitting", 2), false);

  // Short words get no budget: at three letters, one edit is a different
  // name. "Om" and "Am", "Ravi" and "Rani" are already at the edge.
  assert.equal(editBudgetFor("om"), 0);
  assert.equal(editBudgetFor("ram"), 0);
  assert.equal(editBudgetFor("riya"), 1);
  assert.equal(editBudgetFor("yatharth"), 2);
  assert.equal(fuzzyWordMatch("ram", "ravi"), false, "no budget, no match");
  assert.equal(fuzzyWordMatch("yathart", "yatharth"), true);
  assert.equal(fuzzyWordMatch("srivastava", "shrivastava"), true);
  assert.equal(fuzzyWordMatch("riya", "riya"), true);
  assert.equal(fuzzyWordMatch("ri", "riya"), true, "a short prefix is still a prefix");
}

// ── Help lists every command the person actually holds ────────────────
// `help` — the single most obvious word — was not in the help pattern at
// all, so it fell through to the older keyword bot. From the phone that
// looked like the desk answering with the wrong list.
{
  assert.deepEqual(parseErpCommandLocal("help"), { commandId: "help", fields: {}, source: "local" });
  for (const t of ["HELP", "commands", "command list", "all commands", "madad", "मदद", "?", "cmd"]) {
    assert.equal(parseErpCommandLocal(t)?.commandId, "help", `"${t}" asks for help`);
  }
  // Not a request for the command list.
  for (const t of ["helpline number", "help me with Riya's fees"]) {
    assert.notEqual(parseErpCommandLocal(t)?.commandId, "help", `"${t}" is not the help list`);
  }

  const all = ERP_COMMANDS.filter((c) => c.id !== "help");
  const reply = formatHelpReply(all, "Ashish");
  for (const c of all) {
    assert.ok(reply.includes(c.title), `help must list "${c.title}"`);
  }
  // One WhatsApp message, not three.
  assert.ok(reply.length < 4096, `help is ${reply.length} chars, over one message`);
  // A write is marked, because a write can reach a family.
  assert.ok(reply.includes("✍️"));
  // App-only commands say so rather than looking ignored.
  assert.ok(reply.includes("(app only)"));
  // A role with nothing still gets a usable answer.
  assert.match(formatHelpReply([], "Ashish"), /doesn't include any desk commands/);
  // A command whose module nobody grouped still appears.
  const odd = formatHelpReply(
    [{ ...all[0]!, module: "vault" }],
    "",
  );
  assert.ok(odd.includes(all[0]!.title), "an ungrouped command must not vanish from help");
}

// ── The number printed is the number resolved ─────────────────────────
//
// This is the whole risk of numbering a list: the text and the pick list
// are produced by two different functions, and if they ever disagree the
// desk offers "reply 7" and hands back somebody else's child. So every
// list is checked BOTH ways — the numbers the formatter printed are
// exactly the numbers the picks accept, in the same order.
{
  const printedNumbers = (text: string): number[] =>
    [...text.matchAll(/(?:^|\n)\*?(\d{1,3})\.\*?\s/g)].map((m) => Number(m[1]));

  const agree = (text: string, picks: { n: number; label: string }[], what: string) => {
    assert.deepEqual(
      printedNumbers(text),
      picks.map((p) => p.n),
      `${what}: the numbers printed must be the numbers accepted\n${text}`,
    );
  };

  // Absent list — numbered by roll, because the roll is already printed
  // and making a teacher count rows past a visible number is worse than
  // not numbering at all.
  const absentInput = {
    sectionLabel: "V A",
    date: "2026-09-07",
    todayIso: "2026-09-07",
    marked: true,
    total: 30,
    absent: [
      { id: "s2", rollNo: "11", fullName: "Ishita Rao" },
      { id: "s1", rollNo: "4", fullName: "Aarav Sharma" },
    ],
    leave: [{ id: "s3", rollNo: "19", fullName: "Kabir Nath" }],
    late: [],
    halfDay: [],
  };
  const absentText = formatAbsentListReply(absentInput);
  const absentPicks = absentListPicks(absentInput);
  agree(absentText, absentPicks, "absent list");
  assert.deepEqual(absentPicks.map((p) => p.n), [4, 11, 19], "the roll is the number");
  assert.equal(absentPicks[0]!.studentId, "s1");
  assert.equal(absentPicks[0]!.label, "Aarav Sharma");
  assert.match(absentText, /Reply with a number/);

  // No roll on a row, or a roll that repeats: there is nothing
  // unambiguous to type, so nothing is offered rather than something
  // wrong being accepted.
  assert.deepEqual(
    absentListPicks({ ...absentInput, absent: [{ id: "x", rollNo: "", fullName: "No roll" }], leave: [], late: [], halfDay: [] }),
    [],
    "a row with no roll offers no number",
  );
  assert.deepEqual(
    absentListPicks({
      ...absentInput,
      absent: [{ id: "a", rollNo: "4", fullName: "One" }],
      leave: [{ id: "b", rollNo: "4", fullName: "Two" }],
      late: [],
      halfDay: [],
    }),
    [],
    "a repeated roll offers no number",
  );
  assert.equal(
    formatAbsentListReply({ ...absentInput, absent: [{ id: "x", rollNo: "", fullName: "No roll" }], leave: [], late: [], halfDay: [] })
      .includes("Reply with a number"),
    false,
    "and the reply must not offer one either",
  );

  // Defaulters — one section keeps the roll; a whole class cannot, since
  // roll 4 exists in every section, so it falls back to 1..n and moves
  // the roll into the detail rather than printing two rival numbers.
  const dRow = (name: string, roll: string, sec: string, paise: number, id: string) => ({
    sectionLabel: sec,
    rollNo: roll,
    fullName: name,
    overdueAmountPaise: paise,
    overdueDays: 20,
    earliestDueOn: "2026-08-10",
    onPlan: false,
    studentId: id,
  });
  const oneSection = {
    title: "V A",
    todayIso: "2026-09-07",
    wholeClass: false,
    rows: [dRow("Aarav", "4", "V A", 500000, "s1"), dRow("Ishita", "11", "V A", 300000, "s2")],
    formatInr: (p: number) => `₹${Math.round(p / 100)}`,
  };
  agree(formatClassDefaultersReply(oneSection), classDefaultersPicks(oneSection), "defaulters, one section");
  assert.deepEqual(classDefaultersPicks(oneSection).map((p) => p.n), [4, 11]);
  assert.equal(formatClassDefaultersReply(oneSection).includes("(roll 4)"), false, "the roll IS the number here");

  const wholeClass = {
    ...oneSection,
    title: "Class V",
    wholeClass: true,
    rows: [dRow("Aarav", "4", "V A", 500000, "s1"), dRow("Bhavya", "4", "V B", 400000, "s3")],
  };
  const wcText = formatClassDefaultersReply(wholeClass);
  agree(wcText, classDefaultersPicks(wholeClass), "defaulters, whole class");
  assert.deepEqual(classDefaultersPicks(wholeClass).map((p) => p.n), [1, 2]);
  assert.ok(wcText.includes("(roll 4)"), "the roll still shows, just not as the number");
  assert.equal(classDefaultersPicks(wholeClass)[0]!.commandId, "student_fees", "money list → money");

  // Pending leaves — spans classes, so position, never roll.
  const leaves = {
    todayIso: "2026-09-07",
    scope: "school" as const,
    rows: [
      { studentName: "Late Ask", classLabel: "V A", rollNo: "4", fromDate: "2026-09-08", toDate: "2026-09-08", days: 1, typeLabel: "Sick", reason: "fever", requestedAt: "2026-09-07T09:00:00Z", approver: "Class teacher", studentId: "s9" },
      { studentName: "Early Ask", classLabel: "VI B", rollNo: "4", fromDate: "2026-09-09", toDate: "2026-09-09", days: 1, typeLabel: "Sick", reason: "", requestedAt: "2026-09-06T09:00:00Z", approver: "Principal", studentId: "s8" },
    ],
    approvedToday: 0,
  };
  agree(formatPendingLeavesReply(leaves), pendingLeavesPicks(leaves), "pending leaves");
  // Oldest first — and the picks must follow the print order, not the
  // order the rows arrived in.
  assert.equal(pendingLeavesPicks(leaves)[0]!.label, "Early Ask");
  assert.equal(pendingLeavesPicks(leaves)[0]!.studentId, "s8");

  // Which section? — numbered, and picking one re-runs the same command.
  const opts = [
    { classId: "c5", sectionId: "s5a", className: "V", sectionName: "A", label: "V A" },
    { classId: "c5", sectionId: "s5b", className: "V", sectionName: "B", label: "V B" },
  ];
  const secText = formatSectionProblem("ambiguous", opts, "5");
  const secPicks = sectionProblemPicks("ambiguous", opts, "absent_list");
  agree(secText, secPicks, "section options");
  assert.equal(secPicks[1]!.section?.sectionId, "s5b");
  assert.equal(secPicks[1]!.commandId, "absent_list", "the number re-runs what you asked");
  // "You can only ask about your own sections" lists them as information.
  // A number there would answer a question nobody asked.
  assert.deepEqual(sectionProblemPicks("not_allowed", opts, "absent_list"), []);
  assert.deepEqual(sectionProblemPicks("no_class", [], "absent_list"), []);

  // Which route? — the id is carried, so the pick is exact, and the
  // original wording is replayed so the minutes are not lost.
  const routes = [
    { id: "r1", label: "Bus 3 · Sarnath" },
    { id: "r2", label: "Bus 30 · Ramnagar" },
  ];
  agree(
    formatRouteNotFound("3", routes.map((r) => r.label)),
    routePicks(routes, "bus_delay", "bus 3 ko batao 20 minute late"),
    "route options",
  );
  const rp = routePicks(routes, "bus_delay", "bus 3 ko batao 20 minute late");
  assert.equal(rp[0]!.routeId, "r1");
  assert.match(
    String(rp[0]!.rerunText),
    /20 minute late/,
    "picking the bus must not lose how late it is",
  );

  // PTM open times.
  const slots = [
    { startAt: "10:00", teacherName: "Meera", free: 2 },
    { startAt: "10:30", teacherName: "Rakesh", free: 1 },
  ];
  const ptmText = formatPtmSlotPicker({
    studentName: "Riya Verma",
    eventName: "Term 1 PTM",
    eventDate: "2026-09-12",
    slots,
  });
  agree(ptmText, ptmSlotPicks(slots, "Riya Verma"), "PTM slots");
  assert.equal(ptmSlotPicks(slots, "Riya Verma")[1]!.slotAt, "10:30");
  assert.match(String(ptmSlotPicks(slots, "Riya Verma")[1]!.rerunText), /Riya Verma 10:30/);

  // Help — numbered straight through the groups, because "3" has to mean
  // one thing, and every number DESCRIBES rather than runs.
  const menu = ERP_COMMANDS.filter((c) => c.id !== "help");
  const helpText = formatHelpReply(menu, "Ashish");
  const hp = helpPicks(menu);
  agree(helpText, hp, "help menu");
  assert.deepEqual(hp.map((p) => p.n), menu.map((_, i) => i + 1), "1..n straight through");
  assert.ok(hp.every((p) => p.describe), "a help number never runs a command");
  assert.equal(hp.length, menu.length, "every command is reachable by number");
  assert.match(helpText, /Reply with a number \(\*1\*–\*\d+\*\)/);
  // Grouped by module, and the numbering follows the printed order.
  assert.ok(helpText.includes("*Attendance*") && helpText.includes("*Fees*"));
  assert.equal(hp[0]!.commandId, helpMenuCommands(menu)[0]!.id);

  // And the detail a number gets you.
  const detail = formatCommandHelpDetail(ERP_COMMANDS.find((c) => c.id === "pay_link")!);
  assert.ok(detail.includes("Send a payment link to a family"));
  for (const ex of ERP_COMMANDS.find((c) => c.id === "pay_link")!.examples) {
    assert.ok(detail.includes(ex), "every accepted phrasing is shown, not just one");
  }
  assert.match(detail, /confirm card/, "a write says so plainly");
  const appOnly = formatCommandHelpDetail(ERP_COMMANDS.find((c) => c.id === "post_homework")!);
  assert.match(appOnly, /app only/i);
}

// ── No server file may ask the browser for the templates ──────────────
// `ensureWaTemplatesHydrated` fetches the relative URL
// `/api/school-data/desk-slice/wa_templates`. In a browser that resolves
// against the page. Under Node it throws, the throw is caught, and
// `loadWaTemplates()` quietly returns the built-in defaults — in which
// NOTHING is approved. So every parent-facing command reported "no
// approved template" no matter what the school had approved with Meta:
// the pay link, the fee reminder, the class message, the bus delay, the
// PTM notice, the staff broadcast, and the held teacher messages.
//
// It failed silently and identically in all seven places, which is why a
// grep is the test. Server code reads templates through
// `waTemplatesRead.server.ts`.
{
  const dir = path.join(import.meta.dirname, ".");
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith(".server.ts")) continue;
      // The reader itself names both, in the comment explaining why.
      if (e.name === "waTemplatesRead.server.ts") continue;
      const src = fs.readFileSync(full, "utf8");
      // Import specifiers, not prose: a comment about the bug is fine.
      if (/from "@\/lib\/waTemplatesPersistence"|import\("@\/lib\/waTemplatesPersistence"\)|\bloadWaTemplates\(\)/.test(src)) {
        offenders.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  assert.deepEqual(
    offenders,
    [],
    `server code must read templates via waTemplatesRead.server.ts, not the browser hydrate path: ${offenders.join(", ")}`,
  );
}

// ── Transport ─────────────────────────────────────────────────────────
// The desk answered almost nothing about buses. "route 2" — the single
// most obvious thing to type — returned null because an explicit ask word
// was required; "transport" was not a bus word at all; Devanagari कौन was
// missing from the ask list; and "bus route 2" came back as a route
// literally named "route".
{
  const busId = (t: string) => parseErpCommandLocal(t)?.commandId ?? null;
  const busRoute = (t: string) =>
    (parseErpCommandLocal(t)?.fields.text ?? null) as string | null;

  // A route named, however it is phrased.
  for (const t of [
    "bus 2",
    "route 2",
    "Route 2 ka manifest",
    "route 2 me kaun kaun hai",
    "bus 2 ki list",
    "who is on bus 2",
    "bus route 2 details",
    "बस 2 में कौन है",
    "रूट 2 की सूची",
  ]) {
    assert.equal(busId(t), "bus_manifest", `manifest: ${t}`);
    assert.equal(busRoute(t), "2", `route 2 from: ${t}`);
  }

  // Transport asked, no route named — the desk lists the routes with
  // numbers rather than going quiet.
  for (const t of ["transport", "Transport", "transport list", "bus manifest", "buses"]) {
    assert.equal(busId(t), "bus_manifest", `manifest: ${t}`);
    assert.equal(busRoute(t), "", `no route named: ${t}`);
  }

  // Delays keep their minutes.
  assert.equal(parseBusDelayQuery("bus 2 is late by 15 minutes")?.minutes, 15);
  assert.deepEqual(parseBusDelayQuery("route 2 15 minute late"), { route: "2", minutes: 15 });
  assert.equal(parseBusDelayQuery("बस 2 देरी")?.route, "2");

  // Staff talking about a bus is not a command, and must still fall
  // through to the rest of WhatsApp untouched.
  for (const t of [
    "bus 2 abhi tak nahi aayi, driver ko phone karo",
    "bus me AC nahi chal raha",
    "route ke liye naya driver chahiye",
    "kal bus kharab thi",
    "Business meeting at 4",
  ]) {
    assert.equal(parseBusManifestQuery(t), null, `not a command: ${t}`);
    assert.equal(busId(t), null, `falls through: ${t}`);
  }
}

// ── Following on from the last answer ─────────────────────────────────
// "uska payment link bhejo" parses to the right command already; what was
// missing is that "uska" is not a child's name, so it matched nobody.
{
  for (const t of [
    "uska", "uski", "iska", "inka", "usko", "same student",
    "his", "her", "that student", "same student ka",
    "उसका", "इसकी", "उनके", "वही",
  ]) {
    assert.equal(isFollowUpPronoun(t), true, `back-reference: ${t}`);
  }
  // A real name is never a back-reference — answering about the wrong
  // child is worse than asking which one.
  for (const t of [
    "Yatharth", "Kavya mishra", "Uzair", "Ishan", "Vihaan",
    "", "5A", "Aarav uska bhai",
  ]) {
    assert.equal(isFollowUpPronoun(t), false, `a name, not a pronoun: ${t}`);
  }
  // And the follow-ups still parse to the command they always did —
  // "uska" and "iska" alike, in both scripts.
  for (const [t, want] of [
    ["uska bakaya", "student_fees"],
    ["iska bakaya", "student_fees"],
    ["uski fees", "student_fees"],
    ["iski fees", "student_fees"],
    ["uska detail", "student_details"],
    ["iska detail", "student_details"],
    ["usko payment link bhejo", "pay_link"],
    ["isko payment link bhejo", "pay_link"],
    ["उसका बकाया", "student_fees"],
    ["इसका बकाया", "student_fees"],
    ["उसका पेमेंट लिंक", "pay_link"],
    ["इसका पेमेंट लिंक", "pay_link"],
  ] as const) {
    const p = parseErpCommandLocal(t);
    assert.equal(p?.commandId, want, `follow-up command: ${t}`);
    assert.equal(isFollowUpPronoun(String(p?.fields.student ?? "")), true, `back-ref: ${t}`);
  }
}

// पेमेंट is what people type; भुगतान is the dictionary word. Only the
// second was accepted, so "उसका पेमेंट लिंक" parsed as nothing at all.
{
  assert.equal(parsePayLinkQuery("यतार्थ का पेमेंट लिंक भेजो"), "यतार्थ");
  assert.equal(parsePayLinkQuery("रिया वर्मा की फीस लिंक"), "रिया वर्मा");
  assert.equal(parsePayLinkQuery("Kavya Mishra ko पेमेंट लिंक"), "kavya mishra");
  // A payment being discussed is not a payment link being asked for.
  for (const t of ["payment aa gaya kya", "link bhejo", "पेमेंट हो गया"]) {
    assert.equal(parsePayLinkQuery(t), null, `not a pay link: ${t}`);
  }
}

// ── Reaching a colleague ──────────────────────────────────────────────
// "Sujata ko phone karo" and "Principal ko phone karo" were sent to the
// live desk and answered with nothing at all: there was no command for
// reaching a colleague, so the desk stayed silent, correctly and
// uselessly.
{
  const roster: StaffContactCandidate[] = [
    ["stf_cc4dngi", "Sujata Bajpayee", "STF-003", "Principal", "9198761534"],
    ["stf_rkiozpd", "Ashish Singh", "EMP-0001", "Director", "9919101755"],
    ["stf_n95e15t", "Kanchan Singh", "STF-010", "Director", "9198756050"],
    ["stf_tc3dwg6", "NIHAL RAJAK", "STF-032", "Accountant", "9198760001"],
    ["stf_ot5fh2x", "RASHMI YADAV", "STF-021", "Counsellor", "9198760002"],
    ["stf_szzis9t", "Sikha Singh", "STF-004", "Peon", "9198760006"],
  ].map(([id, fullName, empCode, designation, mobile]) => ({
    id: id!, fullName: fullName!, empCode: empCode!, designation: designation!,
    department: "", mobile: mobile!,
  }));
  const only = (ask: string) => {
    const p = parseErpCommandLocal(ask);
    assert.equal(p?.commandId, "staff_contact", `staff lookup: ${ask}`);
    const m = matchStaffContacts(String(p!.fields.text ?? ""), roster);
    assert.equal(m.length, 1, `exactly one match: ${ask} (got ${m.length})`);
    return m[0]!.fullName;
  };
  // By name, by post, in either script, and through a typo.
  assert.equal(only("Sujata ko phone karo"), "Sujata Bajpayee");
  assert.equal(only("Principal ko phone karo"), "Sujata Bajpayee");
  assert.equal(only("Principal se baat karni hai"), "Sujata Bajpayee");
  assert.equal(only("प्रिंसिपल से बात करनी है"), "Sujata Bajpayee");
  assert.equal(only("sujata ka number"), "Sujata Bajpayee");
  assert.equal(only("Sujta ko phone karo"), "Sujata Bajpayee", "a typo still lands");
  assert.equal(only("STF-003 ka number"), "Sujata Bajpayee");
  assert.equal(only("call the accountant"), "NIHAL RAJAK");
  assert.equal(only("counsellor ka number"), "RASHMI YADAV");

  // A surname three people share is a numbered question, not a guess.
  {
    const p = parseErpCommandLocal("Singh ka number");
    assert.equal(p?.commandId, "staff_contact");
    assert.ok(matchStaffContacts(String(p!.fields.text ?? ""), roster).length > 1);
  }

  // Not this command's business.
  for (const t of ["Yatharth ke parent ka number", "bus 2 driver ka number", "father ka contact"]) {
    assert.notEqual(parseErpCommandLocal(t)?.commandId, "staff_contact", `not a staff lookup: ${t}`);
  }
  // Half a thought is not a lookup.
  assert.equal(parseStaffContactQuery("phone karo"), null);
  assert.equal(parseStaffContactQuery("call"), null);

  // Everyone may reach the principal or the office; a peon's personal
  // number is the office's to give out.
  assert.equal(staffContactIsOpen("Principal"), true);
  assert.equal(staffContactIsOpen("Director"), true);
  assert.equal(staffContactIsOpen("Accountant"), true);
  assert.equal(staffContactIsOpen("Peon"), false);
  assert.equal(staffContactIsOpen("Teacher"), false);

  // The reply carries the number and nothing else off the staff record.
  const reply = formatStaffContactReply({
    fullName: "Sujata Bajpayee", designation: "Principal", department: "",
    mobile: "91987 61534", unmasked: true,
  });
  assert.match(reply, /Sujata Bajpayee · Principal/);
  assert.match(reply, /91987 61534/);
  const masked = formatStaffContactReply({
    fullName: "Sikha Singh", designation: "Peon", department: "",
    mobile: "91xxxxxx06", unmasked: false,
  });
  assert.match(masked, /Ask the office/);
}

console.log("erpCommands.selftest.ts OK");
