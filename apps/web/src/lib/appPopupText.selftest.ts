import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPopupTextPrompt,
  looksHindi,
  parsePopupDraft,
  parsePopupTranslation,
  POPUP_TITLE_MAX,
  popupBodyMax,
  popupTextTooLong,
} from "./appPopupText";

console.log("appPopupText.selftest.ts");

/**
 * App pop-up text: a pop-up fits one phone screen (no scrolling), and the AI
 * writes the message from the title and fills the other language.
 */

// ── Limits ────────────────────────────────────────────────────────────────
assert.equal(popupBodyMax("aadhaar", false), 160);
assert.equal(popupBodyMax("none", false), 320);
assert.equal(popupBodyMax("none", true), 120, "a poster takes room from the message");
const base = { title: "Aadhaar", titleHi: "आधार", body: "", bodyHi: "", consentText: "", consentTextHi: "", form: "aadhaar" as const, imageUrl: "" };
assert.equal(popupTextTooLong(base), "");
assert.match(popupTextTooLong({ ...base, bodyHi: "क".repeat(161) }), /Hindi message is 161 characters — keep it within 160/);
assert.match(popupTextTooLong({ ...base, title: "x".repeat(POPUP_TITLE_MAX + 1) }), /English title/);
// The first live Aadhaar pop-up (900+ characters) would now be refused.
assert.ok(popupTextTooLong({ ...base, body: "Dear Parent, ".repeat(70) }));

// ── Language detection ─────────────────────────────────────────────────────
assert.equal(looksHindi("कृपया आधार नंबर भरें"), true);
assert.equal(looksHindi("Please fill Aadhaar"), false);
assert.equal(looksHindi("UDISE+, PEN और APAAR ID के लिए आधार"), true, "Hindi with English terms is Hindi");
assert.equal(looksHindi("1234"), false);

// ── Prompts and parsing ────────────────────────────────────────────────────
const d = buildPopupTextPrompt({ mode: "draft", title: "Aadhaar needed", form: "aadhaar", bodyMax: 160 });
assert.ok(d.system.includes("at most 160 characters") && /Do not invent deadlines/.test(d.system));
assert.ok(d.user.includes("Aadhaar numbers"));
const t = buildPopupTextPrompt({ mode: "translate", text: "x", from: "en", field: "body", max: 160 });
assert.ok(/into Hindi/.test(t.system) && /UDISE\+, PEN, APAAR and Aadhaar exactly/.test(t.system));
assert.deepEqual(parsePopupDraft('```json\n{"title":"T","titleHi":"टी","body":"' + "a".repeat(200) + '","bodyHi":"ब"}\n```', 160)?.body.length, 160, "clipped to the limit");
assert.equal(parsePopupDraft('{"title":"T","body":""}', 160), null);
assert.deepEqual(parsePopupTranslation('{"text":"नमस्ते"}', 70), { text: "नमस्ते" });
assert.equal(parsePopupTranslation("not json", 70), null);

// ── Wiring ─────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const save = read("../app/api/comms/app-popups/route.ts");
assert.ok(/const tooLong = textChanged \? popupTextTooLong\(popup\) : "";/.test(save), "the server refuses text that will not fit; stop/start of an old pop-up still works");
const route = read("../app/api/ai/app-popup-text/route.ts");
assert.ok(/requireStaffPermission\(req, "notices", "edit"\)/.test(route), "only those who may post pop-ups");
assert.ok(/route: "app-popup-text"/.test(read("aiLlm.server.ts")), "through the AI router (audited, budgeted)");
const panel = read("../components/comms/AppPopupsPanel.tsx");
assert.ok(/Write message with AI/.test(panel) && /onBlur: \(\) => void fillOther\(field, l\)/.test(panel), "AI write + fill the other language");
assert.ok(/if \(existing && !aiFilled\.has\(target\)\) return;/.test(panel), "a box written by hand is never overwritten");
assert.ok(/\{n\}\/\{max\}/.test(panel), "live counters");

console.log("appPopupText.selftest: all assertions passed");
