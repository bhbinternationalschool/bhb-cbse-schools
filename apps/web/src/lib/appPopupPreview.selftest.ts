import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { popupStatus } from "../components/comms/AppPopupPreview";
import { normalizeAppPopup } from "./appPopups";

console.log("appPopupPreview.selftest.ts");

/**
 * Comms → App pop-ups: each pop-up shows its status, its counts and a phone
 * preview drawn from the app's own dialog, with Preview / Edit / Stop-Start /
 * Duplicate / Delete.
 */

const p = normalizeAppPopup({ id: "a", title: "Aadhaar", form: "aadhaar", startsOn: "2026-10-10", endsOn: "2026-10-31" })!;
assert.deepEqual(popupStatus(p, "2026-10-12"), { label: "Live", tone: "live" });
assert.deepEqual(popupStatus(p, "2026-10-09"), { label: "Starts 2026-10-10", tone: "wait" });
assert.deepEqual(popupStatus(p, "2026-11-01"), { label: "Ended", tone: "off" });
assert.deepEqual(popupStatus({ ...p, active: false }, "2026-10-12"), { label: "Stopped", tone: "off" });

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const preview = read("../components/comms/AppPopupPreview.tsx");
const app = readFileSync(join(__dirname, "../../../../cbse_school_mobile/lib/core/popups/app_popups.dart"), "utf8");
// The preview's words are the app's words — if the app's dialog changes, this fails.
for (const phrase of [
  "Used only for the school's records, UDISE+ and APAAR. The app shows it hidden (XXXX-XXXX-1234).",
  "यह केवल स्कूल के रिकॉर्ड, UDISE+ और APAAR के लिए है। ऐप में यह छिपा दिखेगा (XXXX-XXXX-1234)।",
  '"सेव करें"',
  '"I do not agree"',
  '"मैं सहमत हूँ"',
  '"बाद में"',
]) {
  assert.ok(app.includes(phrase), `app dialog still says ${phrase}`);
  assert.ok(preview.includes(phrase), `preview says ${phrase}`);
}
const panel = read("../components/comms/AppPopupsPanel.tsx");
for (const label of ['"Hide preview" : "Preview"', '"Stop" : "Start"', "Duplicate", "Delete", "Still to do", "Tapped “Later”"]) {
  assert.ok(panel.includes(label), `panel has ${label}`);
}
assert.ok(/<AppPopupPreview popup=\{draft\} lang=\{lang\} \/>/.test(panel), "the editor shows a live preview");

console.log("appPopupPreview.selftest: all assertions passed");
