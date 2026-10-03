/**
 * Run: npx tsx src/lib/waMetaAccountAlerts.selftest.ts
 *
 * Meta's account-level alerts are rare and arrive when something has gone
 * wrong. The two failures that matter: a real warning that produces no note
 * (the director finds out from the invoice), and a routine event that
 * produces one (the director learns to ignore them). Payloads below are
 * Meta's own reference examples.
 */
import assert from "node:assert/strict";
import { parseMetaAccountAlerts } from "./waMetaAccountAlerts";

function body(field: string, value: unknown, time = 1790900000) {
  return { object: "whatsapp_business_account", entry: [{ id: "1672893360375109", time, changes: [{ field, value }] }] };
}

// --- a completed recategorisation to marketing --------------------------
{
  const [a] = parseMetaAccountAlerts(
    body("template_category_update", {
      message_template_id: 1622643062888156,
      message_template_name: "bhb_exam_tomorrow",
      message_template_language: "en",
      previous_category: "UTILITY",
      new_category: "MARKETING",
    }),
  );
  assert.ok(a);
  assert.equal(a.field, "template_category_update");
  assert.equal(a.templateCategoryChanged, true, "the registry must re-sync");
  assert.match(a.note, /bhb_exam_tomorrow \(en\)/);
  assert.match(a.note, /Utility to \*Marketing\*/);
  assert.match(a.note, /new name/, "says what to do, not just what happened");
}

// --- an impending recategorisation, with its date -----------------------
{
  const [a] = parseMetaAccountAlerts(
    body("template_category_update", {
      message_template_id: 1,
      message_template_name: "bhb_fee_receipt",
      message_template_language: "hi",
      new_category: "UTILITY",
      correct_category: "MARKETING",
      category_update_timestamp: 1791072000, // Sun 4 Oct 2026, 05:30 IST
    }),
  );
  assert.ok(a);
  assert.equal(a.templateCategoryChanged, false, "nothing has changed yet");
  assert.match(a.note, /will move the template \*bhb_fee_receipt \(hi\)\*/);
  assert.match(a.note, /on Sun 4 Oct/);
  assert.match(a.note, /category review/);
}

// --- a category "update" that changes nothing says nothing ---------------
{
  const [a] = parseMetaAccountAlerts(
    body("template_category_update", { message_template_name: "x", previous_category: "UTILITY", new_category: "UTILITY" }),
  );
  assert.equal(a!.note, "");
}

// --- number quality: downgrade speaks, onboarding does not ---------------
{
  const [down] = parseMetaAccountAlerts(
    body("phone_number_quality_update", {
      display_phone_number: "919318448468",
      event: "DOWNGRADE",
      old_limit: "TIER_2K",
      current_limit: "TIER_250",
      max_daily_conversations_per_business: "TIER_250",
    }),
  );
  assert.match(down!.note, /downgraded/);
  assert.match(down!.note, /\*250 a day\* \(was 2,000 a day\)/);
  const [onboard] = parseMetaAccountAlerts(body("phone_number_quality_update", { event: "ONBOARDING", current_limit: "TIER_NOT_SET" }));
  assert.equal(onboard!.note, "", "registration noise is not an alert");
  const [up] = parseMetaAccountAlerts(body("phone_number_quality_update", { event: "THROUGHPUT_UPGRADE", current_limit: "TIER_UNLIMITED" }));
  assert.match(up!.note, /Good news[\s\S]*unlimited/);
}

// --- account_alerts: active speaks, resolved does not --------------------
{
  const value = {
    entity_type: "BUSINESS",
    entity_id: "975001463485212",
    alert_info: {
      alert_severity: "WARNING",
      alert_status: "ACTIVE",
      alert_type: "INCREASED_CAPABILITIES_ELIGIBILITY_DEFERRED",
      alert_description: "Limits cannot be increased for your business BHB. Use WhatsApp Business platform actively for several days and follow our messaging policies.",
    },
  };
  const [a] = parseMetaAccountAlerts(body("account_alerts", value));
  assert.match(a!.note, /Limits cannot be increased/);
  assert.match(a!.note, /WARNING · INCREASED_CAPABILITIES_ELIGIBILITY_DEFERRED/);
  const [resolved] = parseMetaAccountAlerts(
    body("account_alerts", { ...value, alert_info: { ...value.alert_info, alert_status: "RESOLVED" } }),
  );
  assert.equal(resolved!.note, "");
}

// --- account_update: the dangerous ones speak, routine ones do not -------
{
  const [restricted] = parseMetaAccountAlerts(
    body("account_update", {
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING", expiration: 1791072000 }],
    }),
  );
  assert.match(restricted!.note, /\*restricted\*/);
  assert.match(restricted!.note, /biz initiated messaging until Sun 4 Oct/);
  assert.match(restricted!.note, /Account quality/);

  const [violation] = parseMetaAccountAlerts(body("account_update", { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SCAM" } }));
  assert.match(violation!.note, /Reason given: scam/);

  const [ban] = parseMetaAccountAlerts(
    body("account_update", { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "REINSTATE", waba_ban_date: "April 17, 2025" } }),
  );
  assert.match(ban!.note, /Ban state: reinstate \(April 17, 2025\)/);

  const [loc] = parseMetaAccountAlerts(body("account_update", { event: "BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE", country: "IN" }));
  assert.equal(loc!.note, "", "routine account events are not alerts");
}

// --- re-delivery yields the same key; a different event a different one ---
{
  const v = { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SCAM" } };
  const a = parseMetaAccountAlerts(body("account_update", v))[0]!;
  const again = parseMetaAccountAlerts(body("account_update", { violation_info: { violation_type: "SCAM" }, event: "ACCOUNT_VIOLATION" }))[0]!;
  assert.equal(a.key, again.key, "key ignores property order, so a re-delivery is sent once");
  const other = parseMetaAccountAlerts(body("account_update", v, 1790999999))[0]!;
  assert.notEqual(a.key, other.key, "a later event of the same kind is a new alert");
}

// --- messages and statuses are not account alerts ------------------------
{
  assert.deepEqual(parseMetaAccountAlerts(body("messages", { messages: [{ id: "wamid.x" }] })), []);
  assert.deepEqual(parseMetaAccountAlerts(null), []);
  assert.deepEqual(parseMetaAccountAlerts({ entry: "nope" }), []);
}

console.log("OK — waMetaAccountAlerts.selftest.ts");
