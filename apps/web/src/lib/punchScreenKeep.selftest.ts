/**
 * The office tablet stays ONE screen (director, 14 Oct 2026): its QR-screen
 * key survives every login, and old same-named screens are told apart from
 * real ones. Run: npx tsx src/lib/punchScreenKeep.selftest.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { clearedOnLogin, PUNCH_SCREEN_TOKEN_KEY } from "./deviceLocalStorage";
import { isOldScreen, sameLabelOnSwitchOn, splitScreens, type PunchScreenRow } from "./punchScreens";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

// ── 1. A login never wipes this device's own keys ──────────────────────
expect("punch screen key value", PUNCH_SCREEN_TOKEN_KEY, "bhb_punch_screen_token");
expect("punch screen key survives login", clearedOnLogin(PUNCH_SCREEN_TOKEN_KEY), false);
expect("desk copy is wiped", clearedOnLogin("bhb_sis_v1"), true);
expect("fees desk is wiped", clearedOnLogin("bhb_fees_v1"), true);
expect("pending deletes kept", clearedOnLogin("bhb_sis_pending_deletes_v1"), false);
expect("pwa dismiss prefix kept", clearedOnLogin("bhb_pwa_dismiss_parent"), false);
expect("non-bhb key untouched", clearedOnLogin("bhb-workspace-last-activity"), false);

// Each device key, read from the file that writes it — a renamed key would
// silently fall back into the wipe.
const deviceKeys: [string, RegExp][] = [
  ["components/staff/PunchScreen.tsx", /PUNCH_SCREEN_TOKEN_KEY/],
  ["components/field/SurveyAgentApp.tsx", /const LOCAL_MEMBER_KEY = "([^"]+)"/],
  ["lib/fieldSurvey.ts", /const OFFLINE_KEY = "([^"]+)"/],
  ["components/visitors/VisitorSelfServiceApp.tsx", /const LANG_KEY = "([^"]+)"/],
  ["components/visitors/VisitorsWorkspace.tsx", /const LANG_KEY = "([^"]+)"/],
  ["components/visitors/GateQrPanel.tsx", /const WA_KEY = "([^"]+)"/],
  ["lib/chatAlerts.ts", /const PREF_KEY = "([^"]+)"/],
];
for (const [file, re] of deviceKeys) {
  const m = src(file).match(re);
  if (!m) {
    failed += 1;
    console.error(`FAIL ${file}: device key not found (${re})`);
    continue;
  }
  if (m[1]) expect(`${file} key ${m[1]} survives login`, clearedOnLogin(m[1]), false);
}
// The screen and the panel both use the one shared constant.
expect(
  "PunchScreen imports the key",
  /import \{ PUNCH_SCREEN_TOKEN_KEY \} from "@\/lib\/deviceLocalStorage"/.test(src("components/staff/PunchScreen.tsx")),
  true,
);
expect(
  "login clean-up uses clearedOnLogin",
  /clearedOnLogin\(key\)/.test(src("lib/workspaceClientSession.ts")),
  true,
);
// /punch-screen runs on its own key, never behind a staff login.
const mw = src("middleware.ts");
expect("punch-screen not login-gated", /"\/punch-screen/.test(mw) || /"\/punch"/.test(mw), false);

// ── 2. Old screens vs real ones ────────────────────────────────────────
const H = 60 * 60_000;
const now = Date.parse("2026-10-14T08:10:00.000Z"); // 13:40 IST
const at = (hoursAgo: number) => new Date(now - hoursAgo * H).toISOString();
const row = (id: string, made: number, seen: number | null, label = "Office tablet"): PunchScreenRow => ({
  id,
  label,
  created_at: at(made),
  last_seen_at: seen === null ? null : at(seen),
});
const rows = [
  row("today-pm", 0.4, 0.1),
  row("today-am", 5.8, 5.3),
  row("yesterday", 24.4, 24.2),
  row("never-seen", 125, null),
  row("gate", 200, 0.2, "Gate phone"),
  row("lone-old", 200, 190, "Staff room"),
  row("lone-week", 200, 150, "Library"),
];
expect("seen in the last hour is in use", isOldScreen(rows[0], rows, now), false);
expect("seen this morning is never old", isOldScreen(rows[1], rows, now), false);
expect("yesterday's, replaced since → old", isOldScreen(rows[2], rows, now), true);
expect("never seen, replaced since → old", isOldScreen(rows[3], rows, now), true);
expect("other name in use", isOldScreen(rows[4], rows, now), false);
expect("unused 7+ days → old", isOldScreen(rows[5], rows, now), true);
expect("alone, unseen < 7 days → kept", isOldScreen(rows[6], rows, now), false);
const split = splitScreens(rows, now);
expect("in use", split.inUse.map((r) => r.id), ["today-pm", "gate", "today-am", "lone-week"]);
expect("old", split.old.map((r) => r.id), ["yesterday", "never-seen", "lone-old"]);

const on = sameLabelOnSwitchOn(rows, "office TABLET ", "today-pm", now);
expect("switch-on replaces day-old same name", on.replace.map((r) => r.id), ["yesterday", "never-seen"]);
expect("switch-on only reports today's", on.seenToday.map((r) => r.id), ["today-am"]);

if (failed) {
  console.error(`punchScreenKeep: ${failed} failed`);
  process.exit(1);
}
console.log("punchScreenKeep: ok");
