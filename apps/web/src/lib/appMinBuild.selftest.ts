/**
 * Run: npx tsx src/lib/appMinBuild.selftest.ts
 *
 * The update gate must stop a known-old staff app and never stop anything
 * it cannot identify — the website and pre-3-Oct apps send no build.
 */
import assert from "node:assert/strict";
import { APP_MIN_BUILD, appBuildFromHeaders, appBuildTooOld, cleanBuild, requestNeedsAppUpdate } from "./appMinBuild";

const min = APP_MIN_BUILD.staff;
assert.ok(min >= 14, "the QR-signing build is the floor");
assert.equal(appBuildTooOld("staff", min - 1), true);
assert.equal(appBuildTooOld("staff", min), false);
assert.equal(appBuildTooOld("staff", min + 5), false);

// unknown is not old
assert.equal(appBuildTooOld("staff", null), false, "no build header — never refused");
assert.equal(appBuildTooOld(null, 1), false, "no flavour — never refused");
assert.equal(appBuildTooOld("parent", 1), APP_MIN_BUILD.parent > 1);

// garbled builds count as unknown
for (const bad of ["", "abc", "1.0.13", "-3", "0", "14x", "1234567890"]) {
  assert.equal(cleanBuild(bad), null, `"${bad}" is not a build`);
}
assert.equal(cleanBuild(" 15 "), 15);

// headers, case-insensitively
const h = new Headers({ "X-App-Flavor": "Staff", "X-App-Build": String(min - 1) });
assert.deepEqual(appBuildFromHeaders(h), { flavor: "staff", build: min - 1 });
assert.equal(requestNeedsAppUpdate(new Request("https://x/api", { headers: h })), true);
assert.equal(requestNeedsAppUpdate(new Request("https://x/api")), false, "website request");
assert.equal(
  requestNeedsAppUpdate(new Request("https://x/api", { headers: { "X-App-Flavor": "staff", "X-App-Build": String(min) } })),
  false,
);

console.log("OK — appMinBuild.selftest.ts");
