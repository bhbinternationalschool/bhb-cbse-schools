/**
 * Self-test: which number sends which template, and the both-languages rule.
 *
 * Two things this pins, both learned on 2026-09-07.
 *
 * A TEMPLATE FAMILY IS BOTH LANGUAGES OR IT IS NOTHING. The fee module had
 * bhb_fee_pay_link approved in Hindi and pending in English, and the receipt
 * sender — reaching for "any approved fees template in this family's
 * language" — would have told a family who had just paid at the counter to pay
 * a link. A half-approved family is now refused outright rather than the
 * existing half being sent to everybody.
 *
 * AND THE NUMBER IS A SETTING, NOT A DEPLOY. Per-template override, then the
 * module's number, then the school default, then the single env-configured
 * one. The chain has a fallback at every step because a module nobody has
 * routed must still send.
 *
 *   npm run -w web test:wa-sender-routing
 */

import assert from "node:assert/strict";
import {
  resolveSenderNumber,
  resolveTemplateForSend,
  templateFamilyReady,
  type WaSenderNumber,
  type WaTemplate,
  type WaTemplatesState,
} from "./waTemplates";

console.log("waSenderRouting.selftest.ts");

const tpl = (
  familyKey: string,
  language: "en" | "hi",
  status: string,
  extra: Partial<WaTemplate> = {},
) =>
  ({
    id: `${familyKey}_${language}`,
    familyKey,
    language,
    status,
    paused: false,
    module: "fees",
    metaName: `bhb_${familyKey}`,
    ...extra,
  }) as unknown as WaTemplate;

const sender = (id: string, extra: Partial<WaSenderNumber> = {}) =>
  ({
    id,
    label: id,
    phoneNumberId: `pn_${id}`,
    displayNumber: "",
    isDefault: false,
    paused: false,
    ...extra,
  }) as WaSenderNumber;

const state = (over: Partial<WaTemplatesState> = {}): WaTemplatesState =>
  ({
    version: 1,
    templates: [],
    lastMetaSyncAt: "",
    audit: [],
    senders: [],
    moduleSenders: {},
    ...over,
  }) as WaTemplatesState;

/* ── Both languages, or nothing ─────────────────────────────────────── */
{
  const half = state({
    templates: [tpl("fees_receipt", "en", "approved"), tpl("fees_receipt", "hi", "pending")],
  });
  const r = templateFamilyReady(half, "fees_receipt");
  assert.equal(r.ready, false, "half-approved family is not usable");
  assert.deepEqual(r.ready === false && r.missing, ["hi"]);

  const send = resolveTemplateForSend({
    state: half,
    familyKey: "fees_receipt",
    language: "en",
  });
  assert.equal(
    send.ok,
    false,
    "even the language that IS approved must not send while its pair is missing — " +
      "that is how one family's language becomes everybody's",
  );

  const whole = state({
    templates: [tpl("fees_receipt", "en", "approved"), tpl("fees_receipt", "hi", "approved")],
  });
  assert.equal(templateFamilyReady(whole, "fees_receipt").ready, true);
}

/* A paused half breaks the family just as a pending one does. */
{
  const paused = state({
    templates: [
      tpl("fees_receipt", "en", "approved"),
      tpl("fees_receipt", "hi", "approved", { paused: true }),
    ],
  });
  assert.equal(templateFamilyReady(paused, "fees_receipt").ready, false);
}

/* ── The family's language is honoured, never the sender's ──────────── */
{
  const st = state({
    templates: [tpl("fees_receipt", "en", "approved"), tpl("fees_receipt", "hi", "approved")],
  });
  const hi = resolveTemplateForSend({ state: st, familyKey: "fees_receipt", language: "hi" });
  assert.ok(hi.ok && hi.template.language === "hi");
  const en = resolveTemplateForSend({ state: st, familyKey: "fees_receipt", language: "en" });
  assert.ok(en.ok && en.template.language === "en");
}

/* ── Number routing: override → module → default → env ──────────────── */
{
  const office = sender("office", { isDefault: true });
  const feesLine = sender("feesline");
  const special = sender("special");

  const st = state({
    senders: [office, feesLine, special],
    moduleSenders: { fees: "feesline" },
  });

  assert.equal(
    resolveSenderNumber(st, { module: "fees", senderNumberId: "" })?.id,
    "feesline",
    "the module's number wins over the school default",
  );
  assert.equal(
    resolveSenderNumber(st, { module: "fees", senderNumberId: "special" })?.id,
    "special",
    "a per-template override wins over the module",
  );
  assert.equal(
    resolveSenderNumber(st, { module: "admissions", senderNumberId: "" })?.id,
    "office",
    "an unrouted module falls back to the default, and still sends",
  );
  assert.equal(
    resolveSenderNumber(state(), { module: "fees", senderNumberId: "" }),
    null,
    "no registry at all = null, so the caller uses the env-configured number",
  );
}

/* A paused number must not be selected, at any level of the chain. */
{
  const st = state({
    senders: [sender("office", { isDefault: true }), sender("old", { paused: true })],
    moduleSenders: { fees: "old" },
  });
  assert.equal(
    resolveSenderNumber(st, { module: "fees", senderNumberId: "old" })?.id,
    "office",
    "a paused number is skipped and the chain continues rather than failing",
  );
}

console.log("waSenderRouting.selftest.ts OK");
