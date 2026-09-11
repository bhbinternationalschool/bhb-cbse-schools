/**
 * Every seeded WhatsApp template passes Meta's rules BEFORE it is submitted,
 * and reads the same way in both languages.
 *
 * Meta reviews a template once, by hand, and a rejection costs a day. The
 * rules it applies are mechanical, so they are checked here at build time:
 *
 *   - a body of at most 1024 characters that neither starts nor ends on a
 *     variable, with every variable numbered 1..n and each used;
 *   - a TEXT header of at most 60 characters, plain — no emoji, no
 *     *bold*, no variable;
 *   - a footer of at most 60 characters, plain, no variable;
 *   - at most three buttons, each label at most 25 characters, URL buttons
 *     with a real https URL;
 *   - review examples that look like real values, never the variable's name.
 *
 * And the school's own rule: the Hindi and English halves of a family carry
 * the SAME set of variables, so one call site can fill either — the sender
 * never knows which language a family chose.
 *
 * Run: npx tsx src/lib/waTemplateSeeds.selftest.ts
 */
import assert from "node:assert/strict";

import { buildPayGoToken, parsePayGoToken, payGoRedirectPath, resolvePublicOrigin } from "./payGoToken";
import {
  buildMetaTemplateCreatePayload,
  buttonUrlVariable,
  templateButtonComponents,
  WA_PAY_NOW_URL,
  matchSeedQuickReply,
  quickReplyAcknowledgement,
  buildMetaTemplateEditPayload,
  emptyWaTemplates,
  markTemplateEditedOnMeta,
  normalizeWaTemplatesState,
  sampleValueForWaVar,
  seedTemplateText,
  seedWaTemplates,
  WA_TEMPLATE_CONTENT_SNIPPETS,
  WA_TEMPLATE_VARIABLES,
  type WaTemplate,
} from "./waTemplates";

const EMOJI = /\p{Extended_Pictographic}/u;
const VAR = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function checkPlainLine(text: string, max: number, what: string) {
  assert.ok(text.length <= max, `${what} is ${text.length} chars (max ${max}): ${text}`);
  assert.ok(!EMOJI.test(text), `${what} must not carry an emoji: ${text}`);
  assert.ok(!/\*|_|~|```/.test(text), `${what} must be plain text: ${text}`);
  assert.ok(!/\{\{/.test(text), `${what} must not carry a variable: ${text}`);
  assert.ok(!/\n/.test(text), `${what} must be one line: ${text}`);
}

const extractAll = (t: string) => [...t.matchAll(VAR)].map((m) => m[1]!);
const seeds = seedWaTemplates();
assert.ok(seeds.length >= 60, `expected the full EN+HI catalogue, got ${seeds.length}`);

const families = new Map<string, WaTemplate[]>();
for (const t of seeds) {
  families.set(t.familyKey, [...(families.get(t.familyKey) ?? []), t]);
}

for (const t of seeds) {
  const label = `${t.metaName}/${t.language}`;
  if (t.category === "AUTHENTICATION") continue; // Meta writes that text itself

  // Body
  assert.ok(t.body.trim().length > 0, `${label}: empty body`);
  assert.ok(t.body.length <= 1024, `${label}: body is ${t.body.length} chars`);
  assert.ok(!/^\s*\{\{/.test(t.body), `${label}: body must not start on a variable`);
  assert.ok(!/\}\}\s*$/.test(t.body), `${label}: body must not end on a variable`);
  // A variable may appear twice in a body ("{{childName}} … wishing {{childName}}");
  // Meta numbers each DISTINCT variable once.
  const bodyVars = [...new Set([...t.body.matchAll(VAR)].map((m) => m[1]!))];
  for (const v of bodyVars) {
    assert.ok(
      WA_TEMPLATE_VARIABLES.some((d) => d.key === v),
      `${label}: variable {{${v}}} is not in the catalogue`,
    );
  }

  // Header
  if (t.headerFormat === "TEXT") {
    checkPlainLine(t.headerText, 60, `${label} header`);
  } else {
    assert.equal(t.headerText, "", `${label}: header text on a ${t.headerFormat} header`);
  }

  // Footer
  if (t.footer) checkPlainLine(t.footer, 60, `${label} footer`);

  // Buttons
  assert.ok(t.buttons.length <= 3, `${label}: ${t.buttons.length} buttons (max 3)`);
  for (const b of t.buttons) {
    assert.ok(b.text.trim().length > 0, `${label}: blank button label`);
    assert.ok(b.text.length <= 25, `${label}: button "${b.text}" is ${b.text.length} chars`);
    if (b.type === "URL") {
      assert.ok(/^https:\/\/\S+$/.test(b.url ?? ""), `${label}: URL button needs an https URL`);
      const v = buttonUrlVariable(b);
      if (v) {
        assert.ok(WA_TEMPLATE_VARIABLES.some((d) => d.key === v), `${label}: button variable {{${v}}} not in catalogue`);
        assert.ok((b.url ?? "").endsWith(`{{${v}}}`), `${label}: Meta allows a button variable only at the END of the URL`);
        assert.equal(extractAll(b.url ?? "").length, 1, `${label}: one variable per button URL`);
      }
    }
  }

  // The payload Meta actually receives — positional, with examples.
  const payload = buildMetaTemplateCreatePayload(t);
  assert.equal(payload.name, t.metaName, `${label}: meta name changed by payload build`);
  const body = payload.components.find((c) => c.type === "BODY") as { text: string; example: { body_text: string[][] } };
  const positional = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  for (let i = 1; i <= bodyVars.length; i += 1) {
    assert.ok(positional.includes(i), `${label}: {{${i}}} declared but unused in payload`);
  }
  assert.ok(!/\{\{[a-zA-Z]/.test(body.text), `${label}: a named variable reached the payload`);
  const examples = body.example.body_text[0]!;
  assert.equal(examples.length, Math.max(1, bodyVars.length), `${label}: example count`);
  bodyVars.forEach((v, i) => {
    assert.notEqual(examples[i], v, `${label}: example for {{${v}}} is the variable's own name`);
    assert.ok(examples[i]!.trim().length > 0, `${label}: blank example for {{${v}}}`);
  });
  if (t.headerFormat === "TEXT" || t.headerFormat === "NONE") {
    assert.equal(payload.warnings.length, 0, `${label}: ${payload.warnings.join("; ")}`);
  }
  const edit = buildMetaTemplateEditPayload(t);
  assert.deepEqual(edit.components, payload.components, `${label}: edit payload differs from create`);
}

// Both halves of a family are the same message.
for (const [family, pair] of families) {
  const en = pair.find((t) => t.language === "en");
  const hi = pair.find((t) => t.language === "hi");
  assert.ok(en && hi, `${family}: needs both languages`);
  assert.deepEqual(
    [...en!.variables].sort(),
    [...hi!.variables].sort(),
    `${family}: Hindi and English declare different variables`,
  );
  assert.equal(en!.headerFormat, hi!.headerFormat, `${family}: header format differs by language`);
  assert.equal(en!.buttons.length, hi!.buttons.length, `${family}: button count differs by language`);
  en!.buttons.forEach((b, i) => {
    assert.equal(b.type, hi!.buttons[i]!.type, `${family}: button ${i} type differs by language`);
    if (b.type === "URL") assert.equal(b.url, hi!.buttons[i]!.url, `${family}: button ${i} URL differs`);
  });
  assert.equal(!!en!.footer, !!hi!.footer, `${family}: footer present in one language only`);
}

// Parent-facing templates greet, sign off, and carry a title line and a desk
// footer — the shape a parent recognises as the school's.
const staffOnly = new Set(["leave_staff_status", "teacher_message", "fleet_owner_alert", "udise_doc_received"]);
for (const t of seeds) {
  if (t.category !== "UTILITY" || staffOnly.has(t.familyKey)) continue;
  if (t.headerFormat === "DOCUMENT" || t.headerFormat === "IMAGE" || t.carousel.length) continue;
  const label = `${t.metaName}/${t.language}`;
  const greeting = t.language === "hi" ? /^नमस्ते|^📢/ : /^Namaste|^📢/;
  assert.ok(greeting.test(t.body), `${label}: does not open with a greeting`);
  assert.ok(t.footer.trim().length > 0, `${label}: no desk footer`);
  if (["fees_receipt", "fees_pay_link"].includes(t.familyKey)) continue; // approved on Meta as-is
  assert.equal(t.headerFormat, "TEXT", `${label}: no title line`);
}

// Review examples come from the catalogue, never the variable's name.
for (const v of WA_TEMPLATE_VARIABLES) {
  const s = sampleValueForWaVar(v.key);
  assert.notEqual(s, v.key, `sample for ${v.key} is its own name`);
  assert.ok(s.length > 0);
}
assert.equal(sampleValueForWaVar("someUnknownVar"), "Sample");

// Starter snippets follow the same rules as seeds.
for (const s of WA_TEMPLATE_CONTENT_SNIPPETS) {
  checkPlainLine(s.header, 60, `snippet ${s.id} header`);
  checkPlainLine(s.footer, 60, `snippet ${s.id} footer`);
  assert.ok(!/^\s*\{\{/.test(s.body) && !/\}\}\s*$/.test(s.body), `snippet ${s.id}: body edges on a variable`);
  for (const m of s.body.matchAll(VAR)) {
    assert.ok(WA_TEMPLATE_VARIABLES.some((d) => d.key === m[1]), `snippet ${s.id}: {{${m[1]}}} not in catalogue`);
  }
}

// The registry seed IS the transport desk's text.
const eta = seedTemplateText("transport_eta", "en");
assert.ok(eta && eta.metaName === "bhb_transport_eta" && eta.variables.length === 5);
assert.equal(seedTemplateText("no_such_family", "en"), null);

/* ── seed refresh: never-submitted templates pick up furniture ── */

const fresh = emptyWaTemplates();
const attendanceEn = fresh.templates.find((t) => t.id === "tpl_attendance_absent_en")!;
assert.equal(attendanceEn.headerFormat, "TEXT");
assert.ok(attendanceEn.buttons.length > 0);

// Production's shape on 2026-09-08: seed body, no header, no buttons, no
// footer, never submitted → gets the seed's header, footer and buttons.
const bare: WaTemplate = {
  ...attendanceEn,
  headerFormat: "NONE",
  headerText: "",
  footer: "",
  buttons: [],
  status: "pending",
  metaTemplateId: "",
  variables: [],
};
const refreshed = normalizeWaTemplatesState({ version: 1, templates: [bare] }).templates.find(
  (t) => t.id === bare.id,
)!;
assert.equal(refreshed.headerFormat, "TEXT", "never-submitted seed gains its title line");
assert.equal(refreshed.headerText, attendanceEn.headerText);
assert.equal(refreshed.footer, attendanceEn.footer);
assert.deepEqual(refreshed.buttons, attendanceEn.buttons);
assert.deepEqual(refreshed.variables, attendanceEn.variables, "variables recomputed after refresh");

// Approved on Meta with the OLD wording → untouched. Meta holds the words;
// only an explicit edit may change them.
const approvedOld: WaTemplate = {
  ...bare,
  status: "approved",
  metaTemplateId: "1577620407230684",
  body: "Dear {{guardianName}}, *{{childName}}* ({{classLabel}}) is marked absent today ({{date}}).",
};
const keptApproved = normalizeWaTemplatesState({ version: 1, templates: [approvedOld] }).templates.find(
  (t) => t.id === bare.id,
)!;
assert.equal(keptApproved.headerFormat, "NONE", "an approved template is never restyled behind Meta's back");
assert.equal(keptApproved.buttons.length, 0);
assert.equal(keptApproved.body, approvedOld.body);

// Reworded by the school → theirs; nothing added.
const reworded: WaTemplate = { ...bare, body: "Our own words {{guardianName}} for {{childName}}." };
const keptReworded = normalizeWaTemplatesState({ version: 1, templates: [reworded] }).templates.find(
  (t) => t.id === bare.id,
)!;
assert.equal(keptReworded.headerFormat, "NONE", "a reworded template keeps the school's own shape");
assert.equal(keptReworded.buttons.length, 0);

// The school's own header on a seed body is kept, buttons still added.
const ownHeader: WaTemplate = { ...bare, headerFormat: "TEXT", headerText: "Our title" };
const keptHeader = normalizeWaTemplatesState({ version: 1, templates: [ownHeader] }).templates.find(
  (t) => t.id === bare.id,
)!;
assert.equal(keptHeader.headerText, "Our title");
assert.deepEqual(keptHeader.buttons, attendanceEn.buttons);

/* ── "Pay now" opens THIS family's link ─────────────────────── */

const payLinkEn = seeds.find((t) => t.familyKey === "fees_pay_link" && t.language === "en")!;
const payBtn = payLinkEn.buttons.find((b) => b.type === "URL")!;
assert.equal(payBtn.url, WA_PAY_NOW_URL);
assert.equal(buttonUrlVariable(payBtn), "payToken");
const payPayload = buildMetaTemplateCreatePayload(payLinkEn);
const payButtons = payPayload.components.find((c) => c.type === "BUTTONS") as { buttons: { type: string; url?: string; example?: string[] }[] };
const metaUrl = payButtons.buttons.find((b) => b.type === "URL")!;
assert.equal(metaUrl.url, "https://bhbinternational.school/pay/go/{{1}}", "Meta numbers the button variable {{1}}");
assert.ok(metaUrl.example?.[0]?.includes("pl_"), "the example is a real-looking token, not the variable's name");
assert.ok(!payLinkEn.variables.includes("payToken"), "a button variable is not a body variable — body positions stay unchanged");

const token = buildPayGoToken({ id: "pl_8f3k2x9a", code: "PL-7K2M" });
assert.equal(token, "pl_8f3k2x9a.PL-7K2M");
assert.deepEqual(parsePayGoToken(token), { linkId: "pl_8f3k2x9a", code: "PL-7K2M" });
assert.deepEqual(parsePayGoToken("pl_8f3k2x9a.pl-7k2m"), { linkId: "pl_8f3k2x9a", code: "PL-7K2M" }, "code is case-insensitive");
assert.equal(parsePayGoToken("pl_8f3k2x9a"), null, "no code → not a token");
assert.equal(parsePayGoToken("pl_8f3k2x9a.XYZ"), null, "malformed code → not a token");
assert.equal(parsePayGoToken("../etc.PL-7K2M"), null);
assert.equal(payGoRedirectPath({ linkId: "pl_8f3k2x9a", code: "PL-7K2M" }), "/pay/share?linkId=pl_8f3k2x9a&code=PL-7K2M");
// The redirect origin comes from the public host, never the container's bind address.
const H = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
assert.equal(resolvePublicOrigin(H({ host: "bhbinternational.school" }), "https://x.example"), "https://bhbinternational.school");
assert.equal(resolvePublicOrigin(H({ host: "0.0.0.0:3000" }), "https://bhbinternational.school/"), "https://bhbinternational.school", "0.0.0.0 is the container, not a host");
assert.equal(resolvePublicOrigin(H({}), "https://bhbinternational.school"), "https://bhbinternational.school");
assert.equal(resolvePublicOrigin(H({ host: "localhost:3000" }), "https://x"), "http://localhost:3000", "dev keeps working");
assert.equal(resolvePublicOrigin(H({ "x-forwarded-host": "bhbinternational.school", "x-forwarded-proto": "https", host: "0.0.0.0:3000" }), "https://x"), "https://bhbinternational.school");

const withToken = templateButtonComponents(payLinkEn, { payToken: token });
assert.deepEqual(withToken.missing, []);
assert.deepEqual(withToken.components, [
  { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: token }] },
]);
const withoutToken = templateButtonComponents(payLinkEn, { payLink: "https://x" });
assert.deepEqual(withoutToken.missing, ["payToken"], "a missing button value is reported, never defaulted");
assert.equal(withoutToken.components.length, 0);
// Static buttons and quick replies need no parameters at all.
const soft = seeds.find((t) => t.familyKey === "fees_soft_reminder" && t.language === "en")!;
assert.deepEqual(templateButtonComponents(soft, {}), { components: [], missing: [] });

/* ── a tap on a template button is recognised in either language ── */

assert.deepEqual(matchSeedQuickReply("Already paid"), {
  familyKey: "admissions_fee_reminder",
  language: "en",
  label: "Already paid",
});
assert.equal(matchSeedQuickReply(" child is unwell ")?.familyKey, "attendance_absent", "case and spacing do not matter");
assert.equal(matchSeedQuickReply("बच्चा अस्वस्थ है")?.language, "hi");
assert.equal(matchSeedQuickReply("DUES"), null, "a keyword is not a button");
assert.equal(matchSeedQuickReply(""), null);
assert.ok(/office/.test(quickReplyAcknowledgement({ familyKey: "x", language: "en", label: "y" })));
assert.ok(/कार्यालय/.test(quickReplyAcknowledgement({ familyKey: "x", language: "hi", label: "y" })));
// Every seeded quick reply round-trips — a label the bot cannot recognise
// would be read as free text.
for (const t of seeds) {
  for (const b of t.buttons) {
    if (b.type !== "QUICK_REPLY") continue;
    assert.ok(matchSeedQuickReply(b.text), `${t.metaName}/${t.language}: button "${b.text}" not recognised`);
  }
}

/* ── in-place Meta edit keeps the id and returns to review ────── */

const edited = markTemplateEditedOnMeta(
  { ...fresh, templates: [{ ...approvedOld, headerFormat: "TEXT", headerText: "Attendance today" }] },
  approvedOld.id,
  "test",
);
const e = edited.templates.find((t) => t.id === approvedOld.id)!;
assert.equal(e.status, "pending");
assert.equal(e.metaTemplateId, "1577620407230684", "the Meta id survives an edit");
assert.equal(edited.audit[0]!.action, "edit_meta");

console.log("  ok");
