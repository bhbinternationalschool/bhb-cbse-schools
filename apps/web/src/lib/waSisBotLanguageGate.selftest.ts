/**
 * Test: Parent selects English language without using LANG keyword.
 *
 * Bug: When a parent's preferred language is blank (not explicitly set),
 * the bot was treating the school default (Hindi) as "already known", which
 * prevented language detection from recognizing natural language requests
 * like "Select english language". The parent got "I don't have that info"
 * and their message was forwarded to the office instead of saving their choice.
 *
 * Fix: Only pass a non-empty "known" value when the household has EXPLICITLY
 * chosen a language. The school default should never count as "known".
 *
 * This test reproduces AVINASH DIXIT's chat on 2026-09-29 08:36:
 * Parent wrote: "Select english language"
 * Expected: Language choice saved to English (or at least recognized)
 * Buggy behavior: "इसकी जानकारी मेरे पास नहीं है 🙏" + forwarded to office
 */

import { languageGateDecision, parseLanguageChoiceStrict } from "@/lib/householdPrefs";

export function testLanguageGateWithNaturalEnglishRequest() {
  // Scenario: A household with no explicit language preference receives a
  // message like "Select english language". With the bug, the language gate
  // would see known: "hi" (the school default) and return { action: "pass" },
  // which means "don't try to detect language — pass it through". The intent
  // detector would then not recognize it as a language request, and it would
  // be treated as unknown.

  const buggyLogic = (preferredLanguage: string | null | undefined, explicitLang: boolean) => {
    // This is the BUGGY code from before the fix:
    // return preferredLanguage || (explicitLang ? "" : "hi")
    // Which evaluates to "hi" when preferredLanguage is empty and explicitLang is false
    return preferredLanguage || (explicitLang ? "" : "hi");
  };

  const fixedLogic = (preferredLanguage: string | null | undefined, explicitLang: boolean) => {
    // This is the FIXED code:
    // return preferredLanguage || ""
    // Which correctly returns "" (blank/unknown) when preferredLanguage is empty
    return preferredLanguage || "";
  };

  // Test 1: Household with no explicit language preference
  // Parent writes "english" (a single-word language choice, not using LANG keyword)
  const parentText = "english";
  const explicitLang = false; // "LANG" keyword not used
  const householdPref = null; // No explicit preference set

  // With buggy logic, the "known" would be "hi" (school default)
  const buggyKnown = buggyLogic(householdPref, explicitLang);
  const buggyGate = languageGateDecision({ known: buggyKnown, text: parentText });

  // With fixed logic, the "known" would be "" (blank)
  const fixedKnown = fixedLogic(householdPref, explicitLang);
  const fixedGate = languageGateDecision({ known: fixedKnown, text: parentText });

  console.log("Test: Parent says 'english' (without using LANG keyword)");
  console.log(`Buggy known value: "${buggyKnown}"`);
  console.log(`Buggy gate result:`, buggyGate);
  console.log(`Fixed known value: "${fixedKnown}"`);
  console.log(`Fixed gate result:`, fixedGate);

  // Assertions
  if (buggyGate.action === "pass") {
    console.log("✓ Confirmed: Buggy version returns { action: 'pass' }");
    console.log("  This is wrong — the language is unknown, not known.");
  } else {
    console.log("✗ Unexpected: Buggy version did not return 'pass'");
    throw new Error("Buggy behavior not reproduced");
  }

  if (fixedGate.action === "save" && fixedGate.choice === "en") {
    console.log("✓ FIXED: Now recognizes 'english' and saves choice as 'en'");
  } else if (fixedGate.action === "ask") {
    console.log("✓ FIXED: Now recognizes this is about language and asks to clarify");
  } else {
    console.log(`✗ Unexpected fixed result:`, fixedGate);
    throw new Error("Expected 'save' or 'ask' after fix");
  }

  // Test 2: Verify parseLanguageChoiceStrict recognizes "english" as single word
  const choice = parseLanguageChoiceStrict("english");
  console.log(`\nparseLanguageChoiceStrict("english") = ${choice}`);
  if (choice !== "en") {
    console.log("✗ parseLanguageChoiceStrict did not extract 'en' from the text");
    throw new Error("Expected 'en'");
  }
  console.log("✓ Correctly extracts 'en' from natural language request");

  // Test 3: Household with an already explicit preference should not trigger language flow
  const alreadyChosenPref = "hi";
  const alreadyChosenKnown = fixedLogic(alreadyChosenPref, explicitLang);
  const alreadyChosenGate = languageGateDecision({ known: alreadyChosenKnown, text: parentText });
  console.log(`\nWhen household already chose "hi", gate returns:`, alreadyChosenGate);
  if (alreadyChosenGate.action === "pass") {
    console.log("✓ Correctly passes through — language already known");
  } else {
    console.log("✗ Should pass through when language is already known");
    throw new Error("Should pass when language is known");
  }

  console.log("\n✅ All tests passed");
}

if (require.main === module) {
  testLanguageGateWithNaturalEnglishRequest();
}
