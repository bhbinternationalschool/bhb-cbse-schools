/**
 * Self-test: a teacher's class notice on its way to parents through the
 * approved notice template — Meta-safe parameters, unfilled blanks caught,
 * and a preview and receipt that say what really happens. Director's brief,
 * 30 Sep 2026.
 *
 * Run: npx tsx src/lib/classNoticeWa.selftest.ts
 */

import assert from "node:assert/strict";

import {
  composeFillBlanksReply,
  composeNoticeParentPreview,
  composeNoticeSentReceipt,
  flattenTemplateParam,
  hasUnfilledBlank,
  TEMPLATE_PARAM_MAX,
} from "./classNoticeWa";
import { buildWaTemplateBodyComponent } from "./waSend";
import { renderTemplateBody } from "./erpCommands";
import { detectClassChannelIntent } from "./waClassChannelEngine";

/* ── One line Meta accepts ─────────────────────────────────────────── */

const metaSafe = (t: string) => !/[\r\n\t]/.test(t) && !/ {5,}/.test(t) && t.length <= 1024;

{
  const typed = "Kal bachchon ko white dress sath me lana hai\nannual function ke liye\n\nTime:     8 baje";
  const flat = flattenTemplateParam(typed);
  assert.ok(metaSafe(flat), flat);
  assert.equal(flat, "Kal bachchon ko white dress sath me lana hai · annual function ke liye · Time: 8 baje");
  // A line that already ends a sentence is not given a second mark.
  assert.equal(flattenTemplateParam("PTM on Saturday.\nCome at 9."), "PTM on Saturday. Come at 9.");
  const long = flattenTemplateParam("x ".repeat(900));
  assert.ok(long.length <= TEMPLATE_PARAM_MAX && long.endsWith("…"), "cut, and visibly so");
  assert.equal(flattenTemplateParam(""), "");
}

// The shared sender cleans every template parameter, whoever built it.
{
  const c = buildWaTemplateBodyComponent(["a", "b", "c"], { a: "line one\nline two", b: "tab\there      wide", c: "" });
  const texts = c.parameters!.map((p) => (p as { text: string }).text);
  assert.deepEqual(texts, ["line one line two", "tab here    wide", "—"]);
  for (const t of texts) assert.ok(metaSafe(t), t);
}

/* ── Blanks left to fill ───────────────────────────────────────────── */

// The director's own examples, as a teacher might send them unfinished.
for (const t of [
  "kal bachchon ko ........... sath me lana hai ........... iss program ke liye",
  "school ki timing kal se change ho gayi hai aur yah....... se.........rahegi",
  "kal ka exam cancel ho gaya hai aur ab ...........ko hoga",
  "Bring ____ tomorrow",
  "Exam on …… at 9",
  "PTM on [date]",
]) {
  assert.equal(hasUnfilledBlank(t), true, t);
}
// Filled in, they go.
for (const t of [
  "kal barish ki vajah se DM ne chhutti kar diya hai",
  "kal bachchon ko white dress sath me lana hai annual function ke liye",
  "school ki timing kal se change ho gayi hai aur yah 8 se 1 rahegi",
  "kal ka exam cancel ho gaya hai aur ab 5 Oct ko hoga",
  "HW 6A Maths: Ex 5.2 Q1-5...",
  "Wait for it…",
  "Timing 8-1",
]) {
  assert.equal(hasUnfilledBlank(t), false, t);
}
assert.ok(composeFillBlanksReply("bring ........ tomorrow").includes("Nothing was sent"));

/* ── What the teacher sees, and what parents get ───────────────────── */

{
  const parsed = detectClassChannelIntent("Notice 8A: kal barish ki vajah se DM ne chhutti kar diya hai", { subjectNames: [] });
  assert.equal(parsed.kind, "notice", "a teacher's notice is a notice");
  const body =
    "📢 *Notice from {{schoolName}}*\n\n*{{noticeTitle}}*\n\n{{noticeBody}}\n\nPlease read carefully and reply to this message if you have a question. Thank you! 🙏";
  const rendered = renderTemplateBody(body, {
    schoolName: "BHB International School",
    noticeTitle: "Notice · Class VIII A",
    noticeBody: `${flattenTemplateParam(parsed.body)} — Priya Sharma`,
  });
  assert.ok(rendered.includes("kal barish ki vajah se DM ne chhutti kar diya hai — Priya Sharma"), rendered);
  const preview = composeNoticeParentPreview({
    kindLabel: "NOTICE",
    classLabel: "Class VIII A",
    rendered,
    families: 38,
    languages: "30 Hindi, 8 English",
  });
  assert.ok(preview.includes("*Parents will receive:*") && preview.includes(rendered), "the exact parents' message");
  assert.ok(preview.includes("*38* families") && preview.includes("30 Hindi, 8 English"));
  assert.ok(preview.includes("not only those who wrote in today"));
  assert.ok(preview.includes("Reply *YES* to send"));
  const none = composeNoticeParentPreview({ kindLabel: "NOTICE", classLabel: "Class II B", rendered, families: 0, languages: "" });
  assert.ok(none.includes("No parent WhatsApp numbers"), "an empty class is said, not hidden");
}

{
  const ok = composeNoticeSentReceipt({ classLabel: "Class VIII A", families: 38, sent: 36, failed: 1, optedOut: 1, mode: "template", erpLine: "Saved in the ERP · Notice published." });
  assert.ok(ok.startsWith("✅ Sent to 36 of 38 families of Class VIII A · 1 failed · 1 opted out."), ok);
  assert.ok(ok.includes("Saved in the ERP"));
  const text = composeNoticeSentReceipt({ classLabel: "Class VIII A", families: 38, sent: 4, failed: 34, optedOut: 0, mode: "text", erpLine: "" });
  assert.ok(!text.includes("✅") && text.includes("4 of 38") && text.includes("24 hours"), "never claims every family when it was plain text");
  const zero = composeNoticeSentReceipt({ classLabel: "Class II B", families: 0, sent: 0, failed: 0, optedOut: 0, mode: "none", erpLine: "" });
  assert.ok(zero.includes("no family was messaged"));
}

/* ── A language whose template is not approved yet: held, not lost ─ */

{
  const preview = composeNoticeParentPreview({
    kindLabel: "NOTICE",
    classLabel: "Class VIII A",
    rendered: "📢 Notice …",
    families: 38,
    languages: "30 Hindi, 8 English",
    waiting: [{ lang: "English", families: 8 }],
  });
  assert.ok(preview.includes("8 English families will get it automatically"), preview);
  assert.ok(preview.includes("nothing for you to do"));
  const clean = composeNoticeParentPreview({ kindLabel: "NOTICE", classLabel: "Class VIII A", rendered: "x", families: 38, languages: "38 Hindi", waiting: [] });
  assert.ok(!clean.includes("⏳"), "nothing waiting, nothing said");

  const receipt = composeNoticeSentReceipt({
    classLabel: "Class VIII A", families: 38, sent: 31, failed: 0, optedOut: 0, mode: "template",
    erpLine: "", held: 7, heldUntil: "2026-10-01T01:30:00.000Z",
  });
  assert.ok(receipt.startsWith("✅ Sent to 31 of 38 families of Class VIII A."), receipt);
  assert.ok(receipt.includes("7 more will get it *automatically*") && receipt.includes("Thu 1 Oct, 7:00 AM"), receipt);
  const none = composeNoticeSentReceipt({ classLabel: "Class II B", families: 5, sent: 0, failed: 0, optedOut: 0, mode: "text", erpLine: "", held: 5, heldUntil: "" });
  assert.ok(none.startsWith("⏳ Sent to 0 of 5") && !none.includes("✅"), "never a tick when nobody has it yet");
}

console.log("classNoticeWa.selftest.ts\n  ok");
