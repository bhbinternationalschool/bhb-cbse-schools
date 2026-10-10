import assert from "node:assert/strict";
import {
  composeAppDownloadReply,
  composeSchoolDayReply,
  detectAppDownloadQuestion,
  detectSchoolDayQuestion,
} from "./sisParentBotDayApp";

console.log("sisParentBotDayApp.selftest.ts");

const today = "2026-10-10";
// The two real messages of 10 Oct 2026 that the bot passed to the office.
assert.deepEqual(detectSchoolDayQuestion("आज छुट्टी है की नहीं", today), { which: "today", dateIso: "2026-10-10" });
assert.equal(detectAppDownloadQuestion("ap download Krna hai"), true);

// More ways parents ask.
for (const [t, which] of [
  ["aaj chutti hai kya", "today"],
  ["Kal school khulega?", "tomorrow"],
  ["kal school lagega kya", "tomorrow"],
  ["is school open today", "today"],
  ["school band hai?", "today"],
  ["परसों छुट्टी है?", "day_after"],
  ["Aaj holiday h", "today"],
] as const) {
  assert.equal(detectSchoolDayQuestion(t, today)?.which, which, t);
}
assert.equal(detectSchoolDayQuestion("kal", today)?.dateIso, undefined, "no holiday word, no school word");
for (const t of ["fees me chhoot milegi?", "bachche ko kal ki chhutti chahiye", "TUTOR", "aaj ka homework", "fees kitni hai"]) {
  assert.equal(detectSchoolDayQuestion(t, today), null, t);
}

for (const t of ["app ka link bhejo", "App kaise download kare", "how to install the app", "ऐप डाउनलोड करना है", "login nahi ho raha app me"]) {
  assert.equal(detectAppDownloadQuestion(t), true, t);
}
for (const t of ["aap kaise hain", "fees app se bharni hai kya", "TUTOR", "aaj chutti hai"]) {
  assert.equal(detectAppDownloadQuestion(t), false, t);
}

// Per child: 10 Oct is the Pre-Primary Saturday off, the rest of the school is open.
const reply = composeSchoolDayReply({
  q: { which: "today", dateIso: today },
  hindi: true,
  children: [
    { name: "MANYA", className: "UKG A", status: "holiday", title: "Pre-Primary Saturday off", nextWorkingIso: "2026-10-12" },
    { name: "RAHUL", className: "V A", status: "working", title: "", nextWorkingIso: "" },
  ],
});
assert.match(reply, /आज · शनिवार, 10 अक्टूबर/);
assert.match(reply, /MANYA\* \(UKG A\) — छुट्टी है \(Pre-Primary Saturday off\) · स्कूल सोमवार, 12 अक्टूबर को खुलेगा/);
assert.match(reply, /RAHUL\* \(V A\) — स्कूल खुला है/);
assert.match(composeSchoolDayReply({ q: { which: "tomorrow", dateIso: "2026-10-11" }, hindi: false, children: [{ name: "A", className: "I", status: "holiday", title: "Sunday Holiday", nextWorkingIso: "2026-10-12" }] }), /Tomorrow · Sunday, 11 Oct\n🏖️ \*A\* \(I\) — holiday \(Sunday Holiday\) · school reopens Monday, 12 Oct/);

assert.match(composeAppDownloadReply(true), /play\.google\.com\/store\/apps\/details\?id=school\.bhbinternational\.parent/);
assert.match(composeAppDownloadReply(false), /Add to Home Screen/);

console.log("sisParentBotDayApp.selftest: all assertions passed");
