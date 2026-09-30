/**
 * Self-test: the WhatsApp template autopilot's rules — when a held message
 * lapses, which language groups may go, what an AI rewrite must keep, what
 * is done with each template, and Meta's latest word over a stale desk copy.
 *
 * Run: npx tsx src/lib/waTemplateAutopilot.selftest.ts
 */

import assert from "node:assert/strict";

import {
  countRecipients,
  heldExpiryFor,
  MAX_AUTO_FIXES,
  overlayMetaFields,
  splitReleasable,
  templateAction,
  templateVariables,
  validateTemplateRewrite,
} from "./waTemplateAutopilot";
import { datesMentioned } from "./staffLeaveWa";

/* ── When a held message lapses ────────────────────────────────────── */

// 30 Sep 2026, 10:00 IST.
const NOW = new Date("2026-09-30T04:30:00Z");
{
  // "kal" — lapses at 7 AM tomorrow, IST.
  assert.equal(heldExpiryFor("kal barish ki vajah se DM ne chhutti kar diya hai", NOW), "2026-10-01T01:30:00.000Z");
  // The first day it mentions decides: tomorrow's exam news is stale once tomorrow starts.
  assert.equal(heldExpiryFor("kal ka exam cancel ho gaya hai aur ab 5 Oct ko hoga", NOW), "2026-10-01T01:30:00.000Z");
  // Only today: midnight tonight.
  assert.equal(heldExpiryFor("aaj 2 baje chhutti hogi", NOW), "2026-09-30T18:29:00.000Z");
  // No day at all: a day from now.
  assert.equal(heldExpiryFor("PTM registration open", NOW), "2026-10-01T04:30:00.000Z");
  // The parser's event date counts.
  assert.equal(heldExpiryFor("Annual function", NOW, "2026-10-03"), "2026-10-03T01:30:00.000Z");
  // Never more than a week.
  assert.equal(heldExpiryFor("Exam on 25 Oct", NOW), "2026-10-07T04:30:00.000Z");
  // Never less than an hour, even for "today" late at night.
  const late = new Date("2026-09-30T18:20:00Z");
  assert.equal(heldExpiryFor("aaj", late), "2026-09-30T19:20:00.000Z");
}
assert.deepEqual(datesMentioned("kal ka exam cancel, ab 5 Oct ko", "2026-09-30"), ["2026-10-01", "2026-10-05"]);

/* ── Which families may get it now ─────────────────────────────────── */

{
  const r = splitReleasable({ hi: ["9000000001", "9000000002"], en: ["9000000003"] }, ["hi"]);
  assert.deepEqual(r.send, { hi: ["9000000001", "9000000002"] });
  assert.deepEqual(r.keep, { en: ["9000000003"] }, "English families wait for the English template — never Hindi instead");
  assert.equal(countRecipients(r.keep), 1);
  const none = splitReleasable({ hi: ["9000000001"] }, []);
  assert.deepEqual(none.send, {});
  assert.deepEqual(splitReleasable({ hi: [] }, ["hi"]), { send: {}, keep: {} });
}

/* ── An AI rewrite Meta will take and the senders can still fill ──── */

{
  const original = {
    body: "📢 *Notice from {{schoolName}}*\n\n*{{noticeTitle}}*\n\n{{noticeBody}}\n\nPlease read carefully and reply if you have a question. Thank you! 🙏",
  };
  assert.deepEqual(templateVariables(original.body), ["schoolName", "noticeTitle", "noticeBody"]);
  const good = "Namaste 🙏 This is a notice from {{schoolName}} about {{noticeTitle}}:\n\n{{noticeBody}}\n\nPlease reply to this message if you have any question.";
  assert.deepEqual(validateTemplateRewrite(original, good), { ok: true });

  const reordered = "A notice about {{noticeTitle}} from {{schoolName}} for you: {{noticeBody}} Please reply with any question.";
  const r1 = validateTemplateRewrite(original, reordered);
  assert.ok(!r1.ok && r1.errors.some((e) => e.includes("in that order")), "Meta fills by position: order must not change");

  const dropped = "Notice from {{schoolName}}: {{noticeBody}}. Please reply with any question you have.";
  assert.equal(validateTemplateRewrite(original, dropped).ok, false, "a variable dropped");

  const renamed = "Notice from {{school}} about {{noticeTitle}}: {{noticeBody}}. Reply with questions please.";
  assert.equal(validateTemplateRewrite(original, renamed).ok, false, "a variable renamed");

  const endsOnVar = "Notice from {{schoolName}} about {{noticeTitle}} for all parents: {{noticeBody}}";
  const r2 = validateTemplateRewrite(original, endsOnVar);
  assert.ok(!r2.ok && r2.errors.includes("ends with a variable"));

  const startsOnVar = "{{schoolName}} notice about {{noticeTitle}} for parents: {{noticeBody}} Please reply with questions.";
  assert.ok(!validateTemplateRewrite(original, startsOnVar).ok);

  const adjacent = "Notice: {{schoolName}} {{noticeTitle}} for all our parents today {{noticeBody}} Please reply with questions.";
  const r3 = validateTemplateRewrite(original, adjacent);
  assert.ok(!r3.ok && r3.errors.includes("two variables side by side"));

  const broken = "Notice from {{schoolName}} about {{noticeTitle}: {{noticeBody}} Please reply with questions.";
  assert.equal(validateTemplateRewrite(original, broken).ok, false, "a broken placeholder");

  assert.equal(validateTemplateRewrite(original, "x".repeat(1100)).ok, false, "too long");
  assert.equal(validateTemplateRewrite(original, "").ok, false);
  const thin = "Hi {{schoolName}} a {{noticeTitle}} b {{noticeBody}} c";
  assert.ok(!validateTemplateRewrite(original, thin).ok, "too few words for its variables");
}

/* ── What happens to each template ─────────────────────────────────── */

{
  const seeds = new Set(["comms_notice", "comms_weekly_child_digest", "auth_otp"]);
  const base = {
    familyKey: "comms_notice",
    language: "en",
    category: "UTILITY",
    status: "approved",
    metaTemplateId: "123",
    syncedAt: "2026-09-30T06:00:00Z",
    headerFormat: "TEXT",
  };
  assert.equal(templateAction(base, null, seeds), "none");
  assert.equal(templateAction({ ...base, status: "pending" }, null, seeds), "none", "waiting on Meta: leave it");
  assert.equal(templateAction({ ...base, status: "rejected" }, null, seeds), "fix");
  assert.equal(templateAction({ ...base, status: "rejected" }, { attempts: MAX_AUTO_FIXES - 1, notifiedAt: "", lastAttemptAt: "" }, seeds), "fix");
  assert.equal(templateAction({ ...base, status: "rejected" }, { attempts: MAX_AUTO_FIXES, notifiedAt: "", lastAttemptAt: "" }, seeds), "notify", "after two tries, a person");
  assert.equal(templateAction({ ...base, status: "rejected" }, { attempts: MAX_AUTO_FIXES, notifiedAt: "2026-09-30", lastAttemptAt: "" }, seeds), "none", "told once, not every hour");
  assert.equal(templateAction({ ...base, status: "paused" }, null, seeds), "notify", "a pause needs a person");
  // The digest: in the catalogue, never sent to Meta.
  const never = { ...base, familyKey: "comms_weekly_child_digest", status: "pending", metaTemplateId: "", syncedAt: "" };
  assert.equal(templateAction(never, null, seeds), "submit");
  assert.equal(templateAction({ ...never, category: "MARKETING" }, null, seeds), "none", "marketing is the school's choice");
  assert.equal(templateAction({ ...never, headerFormat: "IMAGE" }, null, seeds), "none", "a media header needs a sample upload");
  assert.equal(templateAction({ ...base, familyKey: "meta_custom", status: "rejected" }, null, seeds), "none", "not one of ours");
  assert.equal(templateAction({ ...base, familyKey: "auth_otp", category: "AUTHENTICATION", status: "rejected" }, null, seeds), "notify");
}

/* ── Meta's latest word over a stale desk copy ─────────────────────── */

{
  const desk = [
    { metaName: "bhb_school_notice", language: "en", status: "pending", paused: false, metaTemplateId: "", rejectionReason: "", syncedAt: "2026-09-21T12:00:00Z", body: "office wording" },
    { metaName: "bhb_school_notice", language: "hi", status: "approved", paused: false, metaTemplateId: "9", rejectionReason: "", syncedAt: "2026-10-01T00:00:00Z", body: "हिंदी" },
  ];
  const registry = [
    { metaName: "bhb_school_notice", language: "en", status: "approved", paused: false, metaTemplateId: "8", rejectionReason: "", syncedAt: "2026-09-30T06:30:00Z" },
    { metaName: "bhb_school_notice", language: "hi", status: "rejected", paused: false, metaTemplateId: "9", rejectionReason: "old", syncedAt: "2026-09-25T00:00:00Z" },
  ];
  const merged = overlayMetaFields(desk, registry);
  assert.equal(merged[0]!.status, "approved", "approved after the desk was last saved: approved");
  assert.equal(merged[0]!.metaTemplateId, "8");
  assert.equal(merged[0]!.body, "office wording", "the wording stays the office's");
  assert.equal(merged[1]!.status, "approved", "an older registry row does not overrule a newer desk");
  // Meta's category wins: a template it re-classed as marketing is billed as marketing.
  const recat = overlayMetaFields(
    [{ ...desk[0]!, category: "UTILITY" }],
    [{ ...registry[0]!, category: "MARKETING" }],
  );
  assert.equal(recat[0]!.category, "MARKETING");
}

console.log("waTemplateAutopilot.selftest.ts\n  ok");
