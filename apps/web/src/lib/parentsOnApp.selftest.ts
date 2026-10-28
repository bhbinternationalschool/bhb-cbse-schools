import assert from "node:assert/strict";
import {
  APP_INVITE_BODY,
  APP_INVITE_BODY_RAW,
  APP_INVITE_FITS,
  APP_INVITE_TEMPLATE_FAMILY,
  appInviteClaimKey,
  inviteLogStatusFor,
  liveInviteConfirmError,
  realInviteNumbers,
} from "./parentAppInvite";
import { claimMayBeTakenOver, SEND_CLAIM_STALE_MS } from "./waSendClaimPolicy";
import { PARENT_APP_URL } from "./classGroupMoveNotice";
import {
  adoptionStatus,
  buildOfVersion,
  buildParentsOnApp,
  familyContacts,
  invitedRecently,
  lastSeenLabel,
  pickInviteFamilies,
  sessionChildren,
  type RosterChild,
} from "./parentsOnApp";
import type { SisStudent } from "./sis";

console.log("parentsOnApp.selftest.ts");

const now = new Date("2026-10-09T14:30:00.000Z"); // 8:00 pm IST
const kid = (householdId: string, studentId: string, classId: string, classSort: number, sectionId = "a"): RosterChild => ({
  householdId,
  studentId,
  name: studentId.toUpperCase(),
  classId,
  className: classId.toUpperCase(),
  classSort,
  sectionId,
  section: sectionId.toUpperCase(),
});

const r = buildParentsOnApp({
  now,
  families: [
    { householdId: "h1", guardianName: "ANIL", whatsappMobile: "9876500001" },
    { householdId: "h2", guardianName: "BINA", mobile: "0000000000" }, // placeholder only
    { householdId: "h3", guardianName: "CHETAN", mobile: "+91 98765 00003" },
    { householdId: "h4", guardianName: "NO KIDS ON ROLL", mobile: "9876500004" },
    { householdId: "h5", guardianName: "DEEPA", mobile: "9999999999", altMobile: "9876500005" },
    { householdId: "h6", guardianName: "ESHA", mobile: "9876500006" },
  ],
  children: [
    kid("h1", "a1", "ii", 2),
    kid("h1", "a2", "v", 5),
    kid("h2", "b1", "ii", 2),
    kid("h3", "c1", "v", 5),
    kid("h5", "d1", "ii", 2, "b"),
    kid("h6", "e1", "ii", 2),
  ],
  devices: [
    // h1: two phones, notifications on, opened an hour ago.
    { householdId: "h1", appVersion: "1.0.19+20", createdAt: "2026-10-08T14:00:00Z", lastSeenAt: "2026-10-09T13:00:00Z" },
    { householdId: "h1", appVersion: "1.0.25+26", createdAt: "2026-10-08T15:00:00Z", lastSeenAt: "2026-10-08T15:00:00Z" },
    // h3: notifications on, last launch 14 days ago.
    { householdId: "h3", appVersion: "1.0.19+20", createdAt: "2026-09-20T10:00:00Z", lastSeenAt: "2026-09-25T10:00:00Z" },
    // A phone of a family not on roll is never counted.
    { householdId: "h4", appVersion: "1.0.19+20", createdAt: "2026-10-08T15:00:00Z", lastSeenAt: "2026-10-09T10:00:00Z" },
  ],
  logins: [
    { householdId: "h1", at: "2026-10-08T14:00:00Z" },
    { householdId: "h3", at: "2026-09-20T10:00:00Z" },
    // h5 signed in once in August, denied notifications, never opened since.
    { householdId: "h5", at: "2026-08-20T10:00:00Z" },
    { householdId: "hx", at: "2026-10-09T10:00:00Z" },
  ],
  presence: [
    // h6 never registered a token (notifications off) but opens the app daily
    // — the stamp alone proves it, without a sign-in row in range.
    { householdId: "h6", firstSeenAt: "2026-10-01T05:00:00Z", lastSeenAt: "2026-10-09T05:00:00Z", appBuild: 26 },
  ],
});

// Families counted once each; h4 (no child on roll) and hx (unknown) excluded.
assert.deepEqual(r.summary, {
  families: 5,
  signedIn: 4,
  never: 1,
  neverNoContact: 1, // h2: only a placeholder number
  active7: 2, // h1, h6
  active30: 3, // + h3
  pushEnabled: 2, // h1, h3
  phones: 3,
});

const fam = (id: string) => r.families.find((f) => f.householdId === id)!;
assert.equal(fam("h1").status, "active7");
assert.equal(fam("h1").lastSeenAt, "2026-10-09T13:00:00Z");
assert.deepEqual(fam("h1").versions, ["1.0.25", "1.0.19"], "newest build first");
assert.equal(fam("h1").firstSignInAt, "2026-10-08T14:00:00Z");
assert.equal(fam("h3").status, "active30");
assert.equal(fam("h5").status, "dormant");
assert.equal(fam("h5").pushEnabled, false);
assert.equal(fam("h6").status, "active7");
assert.deepEqual(fam("h6").versions, ["build 26"]);
assert.equal(fam("h2").status, "never");
assert.deepEqual(fam("h2").contacts, [], "0000000000 is not a contact");
assert.deepEqual(fam("h5").contacts.map((c) => c.mobile10), ["9876500005"], "9999999999 is not a contact");
assert.deepEqual(fam("h3").contacts.map((c) => c.mobile10), ["9876500003"]);
// Never-signed-in families first, for chasing.
assert.equal(r.families[0]!.householdId, "h2");
// Every on-roll child id is kept, for the invite audience.
assert.deepEqual(fam("h1").children.map((c) => c.studentId), ["a1", "a2"]);

// By class and section: a family with children in two classes counts in both.
assert.deepEqual(
  r.classes.map((c) => [c.label, c.families, c.signedIn, c.active7, c.active30, c.pushEnabled, c.never]),
  [
    ["II A", 3, 2, 2, 2, 1, 1], // h1, h2, h6
    ["II B", 1, 1, 0, 0, 0, 0], // h5
    ["V A", 2, 2, 1, 2, 2, 0], // h1, h3
  ],
);

// Two children in the same class and section: the family counts once there.
const twins = buildParentsOnApp({
  now,
  families: [{ householdId: "t", guardianName: "T", mobile: "9876500009" }],
  children: [kid("t", "t1", "i", 1), kid("t", "t2", "i", 1)],
  devices: [],
  logins: [],
  presence: [],
});
assert.equal(twins.classes[0]!.families, 1);
assert.equal(twins.summary.families, 1);

// Helpers.
assert.equal(buildOfVersion("1.0.25+26"), 26);
assert.equal(buildOfVersion("1.0.25"), null);
assert.equal(adoptionStatus(false, "2026-10-09T13:00:00Z", now), "never", "no sign-in evidence → never");
assert.equal(adoptionStatus(true, "", now), "dormant", "signed in, no time known — not active");
assert.deepEqual(familyContacts({ householdId: "x", guardianName: "", mobile: "1234567890" }, []), []);

assert.equal(lastSeenLabel("", now), "—");
assert.equal(lastSeenLabel("2026-10-09T14:00:00Z", now), "30 min ago");
assert.equal(lastSeenLabel("2026-10-09T10:00:00Z", now), "5 h ago");
assert.equal(lastSeenLabel("2026-10-08T15:00:00Z", now), "yesterday");
assert.equal(lastSeenLabel("2026-10-05T10:00:00Z", now), "4 days ago");
assert.match(lastSeenLabel("2026-08-01T10:00:00Z", now), /Aug 2026/);

// The invite: one approved template, Hindi first, the Play link, fits a param.
assert.equal(APP_INVITE_TEMPLATE_FAMILY, "comms_notice");
assert.ok(APP_INVITE_FITS, `invite is ${APP_INVITE_BODY_RAW.length} chars — over the template limit`);
assert.ok(APP_INVITE_BODY.includes(PARENT_APP_URL));
assert.ok(!/\n/.test(APP_INVITE_BODY));
assert.ok(/[ऀ-ॿ]/.test(APP_INVITE_BODY.slice(0, 20)), "Hindi comes first");
assert.ok(APP_INVITE_BODY.indexOf("Dear parent") > APP_INVITE_BODY.indexOf("प्रिय अभिभावक"));

// 1. Only THIS session's year counts. SIS leaves older-year rows "active", so
// a family whose only rows are from last year has left: not counted, never
// invited. An inactive row this year is not rescued by an active older row.
const row = (id: string, householdId: string, ay: string, status: "active" | "inactive", admissionNo = id) =>
  ({ id, householdId, admissionNo, academicYearCode: ay, status, fullName: id.toUpperCase(), classId: "c", sectionId: "s" }) as unknown as SisStudent;
const roll = sessionChildren(
  [
    row("s1-old", "hA", "2025-26", "active", "A1"),
    row("s1", "hA", "2026-27", "active", "A1"), // on roll — once, this year's row
    row("s2-old", "hLeft", "2025-26", "active", "L1"), // left: no 2026-27 row
    row("s3-old", "hOff", "2025-26", "active", "O1"),
    row("s3", "hOff", "2026-27", "inactive", "O1"), // made inactive this year
  ],
  "2026-27",
);
assert.deepEqual(roll.map((s) => s.id), ["s1"]);
assert.deepEqual(sessionChildren([row("x", "h", "2026-27", "active")], ""), [], "no session year → nobody, never every year");

// 2. Invites: never signed in, not invited in the last 7 days, a real phone.
const inv = buildParentsOnApp({
  now,
  families: [
    { householdId: "n1", guardianName: "NEW", mobile: "9876500011" },
    { householdId: "n2", guardianName: "INVITED 3 DAYS AGO", mobile: "9876500012" },
    { householdId: "n3", guardianName: "INVITED 10 DAYS AGO", mobile: "9876500013" },
    { householdId: "n4", guardianName: "NO PHONE", mobile: "0000000000" },
    { householdId: "n5", guardianName: "ON APP", mobile: "9876500015" },
  ],
  children: ["n1", "n2", "n3", "n4", "n5"].map((h) => kid(h, `${h}k`, "i", 1)),
  devices: [],
  logins: [{ householdId: "n5", at: "2026-10-08T10:00:00Z" }],
  presence: [],
  invites: [
    { householdId: "n2", invitedAt: "2026-10-06T10:00:00Z" },
    { householdId: "n3", invitedAt: "2026-09-29T10:00:00Z" },
    { householdId: "n3", invitedAt: "2026-09-20T10:00:00Z" }, // the latest wins
  ],
});
const invFam = (id: string) => inv.families.find((f) => f.householdId === id)!;
assert.equal(invFam("n2").invitedAt, "2026-10-06T10:00:00Z");
assert.equal(invFam("n3").invitedAt, "2026-09-29T10:00:00Z");
assert.equal(invFam("n1").invitedAt, "");
assert.ok(invitedRecently("2026-10-06T10:00:00Z", now));
assert.ok(!invitedRecently("2026-09-29T10:00:00Z", now));
assert.ok(!invitedRecently("", now));
const picked = pickInviteFamilies(inv.families, ["n1", "n2", "n3", "n4", "n5", "gone", "n1"], now);
assert.deepEqual(picked.invite.map((f) => f.householdId).sort(), ["n1", "n3"]);
assert.deepEqual(
  { signedIn: picked.signedIn, recentlyInvited: picked.recentlyInvited, noPhone: picked.noPhone, notOnRoll: picked.notOnRoll },
  { signedIn: 1, recentlyInvited: 1, noPhone: 1, notOnRoll: 1 },
);
assert.equal(appInviteClaimKey("n1", "2026-10-09"), "app_invite:n1:2026-10-09");

// 4. The send path never messages a placeholder number.
assert.deepEqual(realInviteNumbers({ mobile: "9876500011" }), { mobile: "9876500011" });
assert.deepEqual(realInviteNumbers({ mobile: "0000000000", fallbackMobile: "9876500012" }), { mobile: "9876500012" });
assert.deepEqual(realInviteNumbers({ mobile: "919999999999", fallbackMobile: "1234567890" }), null);
assert.deepEqual(realInviteNumbers({ mobile: "9876500011", fallbackMobile: "9999999999" }), { mobile: "9876500011" });
assert.deepEqual(realInviteNumbers({ mobile: "9876500011", fallbackMobile: "9876500012" }), { mobile: "9876500011", fallbackMobile: "9876500012" });

// The day's invite claim is never taken over, however old; other claims keep
// the 10-minute takeover from a dead caller.
const old = new Date(now.getTime() - 6 * 3_600_000).toISOString();
const fresh = new Date(now.getTime() - 60_000).toISOString();
assert.equal(claimMayBeTakenOver(old, now), true, "default: a stale claim may be taken over");
assert.equal(claimMayBeTakenOver(fresh, now), false);
assert.equal(claimMayBeTakenOver(new Date(now.getTime() - SEND_CLAIM_STALE_MS).toISOString(), now), true);
assert.equal(claimMayBeTakenOver(old, now, { neverStale: true }), false, "app_invite: held whatever its age");
assert.equal(claimMayBeTakenOver("", now, { neverStale: true }), false);

// A send, or a dispatch that threw (may have gone), is logged and keeps the
// claim; an explicit non-send releases it.
assert.equal(inviteLogStatusFor("sent"), "sent");
assert.equal(inviteLogStatusFor("unknown"), "unknown");
for (const st of ["failed", "deferred", "queued_stub", ""]) assert.equal(inviteLogStatusFor(st), null, st);

// A live invite must carry the approved count.
assert.match(liveInviteConfirmError(undefined, 5)!, /Check who gets it first/);
assert.match(liveInviteConfirmError("5", 5)!, /Check who gets it first/);
assert.match(liveInviteConfirmError(4, 5)!, /now 5, you approved 4/);
assert.equal(liveInviteConfirmError(5, 5), null);

console.log("parentsOnApp.selftest.ts: ok");
