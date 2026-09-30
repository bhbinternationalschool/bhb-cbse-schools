/**
 * The parent bot's language gate — what a parent's message does to their
 * stored language. Run: npx tsx src/lib/waSisBotLanguageGate.selftest.ts
 *
 * 2026-09-29: a parent wrote "Select english language" and got "इसकी
 * जानकारी मेरे पास नहीं है" plus a hand-off to the office. Two faults: the
 * server passed the school default ("hi") as if the family had chosen it,
 * and a sentence asking for a language was never read as one.
 */
import { languageGateDecision } from "./householdPrefs";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const gate = (text: string, known = "") => languageGateDecision({ known, text });
const save = (choice: string) => ({ action: "save", choice });

// The reported chat, with nothing stored and with the Hindi default stored.
expect("reported, nothing stored", gate("Select english language"), save("en"));
expect("reported, hi stored", gate("Select english language", "hi"), save("en"));
// Asking for a language in a sentence, either script, either order.
expect("english alone", gate("english"), save("en"));
expect("English me bhejiye", gate("English me bhejiye", "hi"), save("en"));
expect("हिंदी में भेजें", gate("हिंदी में भेजें", "en"), save("hi"));
expect("send in english", gate("Please send in english", "hi"), save("en"));
expect("already that language", gate("Select hindi language", "hi"), { action: "pass" });
// Not language requests.
expect("greeting hi", gate("hi"), { action: "ask" });
expect("Hello", gate("Hello"), { action: "ask" });
expect("fees question", gate("fees kitni hai"), { action: "ask" });
expect("English homework", gate("English homework kya hai"), { action: "ask" });
expect("English book", gate("English book chahiye"), { action: "ask" });
expect("english teacher", gate("change english teacher"), { action: "ask" });
expect("medium question", gate("English medium hai?"), { action: "ask" });
expect("two languages", gate("hindi or english"), { action: "ask" });
expect("known + ordinary message", gate("fees kitni hai", "hi"), { action: "pass" });
// Explicit LANG still wins.
expect("LANG urdu", gate("LANG urdu", "hi"), save("ur"));

if (failed) {
  console.error(`waSisBotLanguageGate: ${failed} failure(s)`);
  process.exit(1);
}
console.log("waSisBotLanguageGate: ok");
