/**
 * Self-test: ask a parent their language ONCE, on their own reply, and
 * remember it.
 *
 * On 2026-09-07 every one of the school's 198 households had a blank
 * preferred_language. The choice had never once been saved, so every parent
 * silently received English — including families who had answered the menu.
 *
 * The cause was that the handler decided "this reply is a language choice" by
 * reading the previous bot message out of the SIS bot's THREAD, and that
 * thread is never persisted: only the classChannel, hub, staffAtt and unified
 * slices ever reach wa_desk_bot_slices. On a fresh instance the thread is
 * empty, so a bare "2" was never recognised.
 *
 * The decision now comes from the household, which does persist.
 *
 * It is also asked on the parent's OWN reply, which is what makes it free:
 * Meta's 24-hour service window opens when the customer writes to the
 * business. Sending them a template does not open it, so the menu cannot be
 * pushed out behind a receipt — it rides on the reply the receipt provokes,
 * and is asked at most once because the answer is stored.
 *
 *   npm run -w web test:wa-language-gate
 */

import assert from "node:assert/strict";
import { languageGateDecision } from "./householdPrefs";

console.log("waLanguageGate.selftest.ts");

/* A family we have never asked: their first words to us trigger the menu,
 * whatever those words are. */
for (const text of ["hi", "namaste", "dues?", "", "when is the PTM"]) {
  assert.deepEqual(
    languageGateDecision({ known: "", text }),
    { action: "ask" },
    `an unknown-language family must be asked (${JSON.stringify(text)})`,
  );
}

/* Their answer is saved — by number, by name, in either script. No thread
 * state is consulted, which is the whole point. */
assert.deepEqual(languageGateDecision({ known: "", text: "2" }), {
  action: "save",
  choice: "hi",
});
assert.deepEqual(languageGateDecision({ known: "", text: "hindi" }), {
  action: "save",
  choice: "hi",
});
assert.deepEqual(languageGateDecision({ known: "", text: "हिंदी" }), {
  action: "save",
  choice: "hi",
});

/* Once known, we never ask again — and a stray number goes back to meaning
 * whatever the menu in front of the parent says it means. This is what stops
 * "1" for "first child" being eaten as a language choice for ever. */
assert.deepEqual(languageGateDecision({ known: "hi", text: "2" }), {
  action: "pass",
});
assert.deepEqual(languageGateDecision({ known: "en", text: "hello" }), {
  action: "pass",
});

/* LANG always works, even once known — that is how a family changes it. */
assert.deepEqual(languageGateDecision({ known: "hi", text: "LANG" }), {
  action: "ask",
});
assert.deepEqual(languageGateDecision({ known: "en", text: "भाषा" }), {
  action: "ask",
});

/* And "LANG hindi" in one line skips the menu entirely. */
assert.deepEqual(languageGateDecision({ known: "en", text: "LANG hindi" }), {
  action: "save",
  choice: "hi",
});
assert.deepEqual(languageGateDecision({ known: "", text: "lang 2" }), {
  action: "save",
  choice: "hi",
});

/* Whitespace and casing must not decide whether a family gets Hindi. */
assert.deepEqual(languageGateDecision({ known: "  ", text: "  3 " }).action, "save");
assert.deepEqual(languageGateDecision({ known: null, text: "ENGLISH" }), {
  action: "save",
  choice: "en",
});

console.log("waLanguageGate.selftest.ts OK");
