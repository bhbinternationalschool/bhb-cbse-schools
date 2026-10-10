/**
 * Self-test: the unified WhatsApp bot's first menus speak Hindi to families
 * and unknown numbers, English to staff, and every Hindi label fits inside
 * WhatsApp's limits (waInteractive.ts cuts longer ones mid-word).
 * Run: npx tsx src/lib/waUnifiedMenusHindi.selftest.ts
 */

import assert from "node:assert/strict";

import type { WaInteractiveMenu } from "./waInteractive";
import { composeActiveFlowHint } from "./waUnifiedBotEngine";
import {
  menuKnownUserGreeting,
  menuUnknownWelcome,
  menuVisitorPurpose,
  roleFlowInteractiveMenu,
} from "./waUnifiedMenus";
import type { WaResolvedIdentity } from "./waRoleResolver";

console.log("waUnifiedMenusHindi.selftest.ts");

const DEVANAGARI = /[ऀ-ॿ]/;

function assertFits(menu: WaInteractiveMenu, label: string) {
  if (menu.kind === "buttons") {
    for (const b of menu.buttons) assert.ok(b.title.length <= 20, `${label}: button "${b.title}" > 20`);
  } else {
    assert.ok(menu.buttonText.length <= 20, `${label}: list button "${menu.buttonText}" > 20`);
    for (const sec of menu.sections) {
      assert.ok(sec.title.length <= 24, `${label}: section "${sec.title}" > 24`);
      for (const row of sec.rows) {
        assert.ok(row.title.length <= 24, `${label}: row "${row.title}" > 24`);
        assert.ok((row.description ?? "").length <= 72, `${label}: row description > 72`);
      }
    }
  }
}

const parent: WaResolvedIdentity = {
  mobile10: "9000000001",
  displayName: "Priya Sharma",
  isKnown: true,
  roles: [{ kind: "parent", label: "Parent", pickKeyword: "PARENT", householdId: "hh_1" }],
};

const hiParent = menuKnownUserGreeting(parent, true);
assert.ok(DEVANAGARI.test(hiParent.textFallback), "a Hindi family's first menu is Hindi");
assert.match(hiParent.textFallback, /\*DUES\*/, "keywords stay in English letters");
assertFits(hiParent.menu, "parent hi");

const enParent = menuKnownUserGreeting(parent, false);
assert.ok(!DEVANAGARI.test(enParent.textFallback), "an English family's menu is English");
assertFits(enParent.menu, "parent en");

const unknown = menuUnknownWelcome();
assert.ok(DEVANAGARI.test(unknown.menu.body), "an unknown number is greeted in Hindi by default");
assert.match(unknown.menu.body, /English/, "with one English line");
assertFits(unknown.menu, "unknown hi");
assertFits(menuUnknownWelcome(false).menu, "unknown en");

const purpose = menuVisitorPurpose("Rajesh", true);
assert.ok(DEVANAGARI.test(purpose.textFallback));
assertFits(purpose.menu, "purpose hi");

const admission = roleFlowInteractiveMenu("admission", "Rajesh", true)!;
assert.ok(DEVANAGARI.test(admission.textFallback));
assertFits(admission.menu, "admission hi");

// Staff menus ignore the flag: a staff tool stays English.
const staff = roleFlowInteractiveMenu("staff", "Anil", true)!;
assert.ok(!DEVANAGARI.test(staff.textFallback), "staff menu stays English");

for (const flow of ["parent", "admission_lead", "job", "transport", "fee", "timing", "meeting", "other"] as const) {
  assert.ok(DEVANAGARI.test(composeActiveFlowHint(flow, "Rajesh", true)), `${flow} hint in Hindi`);
  assert.ok(!DEVANAGARI.test(composeActiveFlowHint(flow, "Rajesh")), `${flow} hint English by default`);
}
assert.ok(!DEVANAGARI.test(composeActiveFlowHint("vendor", "Acme", true)), "vendor hint stays English");

console.log("  ok");
