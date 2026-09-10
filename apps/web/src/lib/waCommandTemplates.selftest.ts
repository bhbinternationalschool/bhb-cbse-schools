/**
 * Run: npx tsx src/lib/waCommandTemplates.selftest.ts
 *
 * Guards the two "here is what you can do on WhatsApp" templates against
 * the ways a template gets rejected by Meta or quietly breaks the bot.
 */
import assert from "node:assert/strict";
import { seedWaTemplates } from "./waTemplates";

console.log("waCommandTemplates.selftest.ts");

const seeds = seedWaTemplates();

// Every bot keyword in the ERP. A QUICK_REPLY whose text is one of these
// breaks that keyword for EVERYONE: matchSeedQuickReply scans all seeds
// against any inbound message, and the parent bot reads a match as "send
// this to the office" rather than running the command.
const BOT_KEYWORDS = new Set([
  "IN", "OUT", "STATUS", "ATTEND", "CANCEL", "LANG",
  "TUTOR", "HINT", "HINTS", "TEACH", "EXAMPLES", "PRACTICE", "SCORE",
  "HOMEWORK", "HW", "EXAM", "PASS", "BUY",
  "LINK", "LINKS", "UNLINK",
  "DUES", "PAY", "RECEIPTS", "KIDS", "INFO", "COMPLAINT",
  "MENU", "HELP", "HUMAN", "YES", "NO",
  "ROUTE", "STUDENTS", "BREAKDOWN",
  "FEE", "REGISTER", "DOCS", "VISIT",
  "START", "BREAK", "END", "CAPTURE",
]);

// --- no seed anywhere may shadow a command keyword -------------------
{
  const clashes: string[] = [];
  for (const t of seeds) {
    for (const b of t.buttons || []) {
      if (
        b.type === "QUICK_REPLY" &&
        BOT_KEYWORDS.has(b.text.trim().toUpperCase())
      ) {
        clashes.push(`${t.familyKey}/${t.language}: "${b.text}"`);
      }
    }
  }
  assert.deepEqual(
    clashes,
    [],
    `quick-reply button text collides with a bot keyword — that keyword would stop working: ${clashes.join(" · ")}`,
  );
}

for (const familyKey of ["staff_wa_commands", "study_help_intro"]) {
  const family = seeds.filter((t) => t.familyKey === familyKey);

  // --- both languages, or the sender refuses to send it at all -------
  {
    assert.deepEqual(
      family.map((t) => t.language).sort(),
      ["en", "hi"],
      `${familyKey} needs both en and hi — resolveTemplateForSend refuses a family approved in only one`,
    );
  }

  for (const t of family) {
    const where = `${familyKey}/${t.language}`;

    // --- Meta's body rules ------------------------------------------
    assert.ok(t.body.length <= 1024, `${where}: body ${t.body.length} chars, Meta caps 1024`);
    assert.doesNotMatch(t.body, /^\s*\{\{/, `${where}: a variable may not open the body`);
    assert.doesNotMatch(t.body, /\}\}\s*$/, `${where}: a variable may not close the body`);
    assert.doesNotMatch(t.body, /\}\}[\s]*\{\{/, `${where}: variables may not be adjacent`);

    // --- an announcement is MARKETING ------------------------------
    // Nothing has happened to the reader; the school is telling them a
    // facility exists. Calling that UTILITY is how a WABA gets its
    // templates rejected wholesale.
    assert.equal(t.category, "MARKETING", `${where} must be MARKETING`);

    // --- and MARKETING must be escapable ---------------------------
    if (familyKey === "study_help_intro") {
      assert.match(t.footer, /STOP/, `${where}: a marketing send needs an opt-out line`);
    }

    // --- every variable is one the senders actually fill ------------
    const KNOWN = new Set(["staffName", "schoolName", "guardianName", "childName"]);
    for (const v of t.variables) {
      assert.ok(KNOWN.has(v), `${where}: {{${v}}} is not a variable any sender fills`);
    }
  }
}

// --- the staff template lists only what every staff member has ------
{
  const en = seeds.find(
    (t) => t.familyKey === "staff_wa_commands" && t.language === "en",
  )!;
  // Attendance is universal, so it is spelled out as keywords.
  for (const kw of ["*IN*", "*OUT*", "*STATUS*"]) {
    assert.ok(en.body.includes(kw), `staff template should offer ${kw}`);
  }
  // Role-specific things are pointed at, never listed as bare keywords a
  // reader's role cannot use — that teaches them the bot is broken.
  assert.match(en.body, /Class teachers/);
  assert.match(en.body, /Transport staff/);
}

// --- the parent template is honest about the child's own number -----
{
  const en = seeds.find(
    (t) => t.familyKey === "study_help_intro" && t.language === "en",
  )!;
  assert.match(en.body, /\*TUTOR\*/);
  assert.match(en.body, /\*LINK\*/);
  // The limits of a linked student number are stated up front, not left
  // to be discovered — it is the reason a parent can say yes to it.
  assert.match(en.body, /study help only/);
  assert.match(en.body, /never fees, receipts or payments/);
  assert.match(en.body, /cannot buy anything/);
  // It must not offer a parent-only keyword as if the child had it.
  assert.doesNotMatch(en.body, /\*PASS\*/);
}

console.log("OK — waCommandTemplates.selftest.ts");
