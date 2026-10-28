/**
 * notify — who receives each event (by role, grant and relationship), what
 * is stored, and what rings on a phone (channel, voice, mute, quiet hours).
 *
 *   npx tsx src/lib/notify/notify.selftest.ts   (npm run test:notify)
 *
 * The "old" lines prove what the code before 20 Oct 2026 did: approvers came
 * from designation regexes (leadershipStaffIds), so a member of staff the
 * school ASSIGNED the principal role in Masters → Roles never heard of a
 * leave request, and a grant every teacher holds (student_leave.approve)
 * would have reached every teacher.
 */
import assert from "node:assert/strict";
import { normalizeStaffRecord } from "@/lib/foundationMasters";
import { buildFcmMessage } from "@/lib/fcm.server";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { defaultRbacState, type RbacState } from "@/lib/rbac";
import { leadershipStaffIds } from "@/lib/staffHomeKind.server";
import { resolveAudience, type AudienceContext } from "./audience";
import { DEFAULT_PREFS, NOTIFY_KINDS, NOTIFY_TOPICS, prefsFrom, recipientKey, type NotifyPrefs, type Recipient } from "./kinds";
import { deliverRows, notifyWith, type DeliverRow, type NotifyDeps, type NotifyEvent, type PushMessage } from "./notify";
import { decidePush, inQuietHours, istMinutes } from "./policy";
import { messageRelayed, payoutHeld } from "./events";
import { isPushVoiceKind, pushVoiceChannel } from "@/lib/pushVoice";

console.log("notify.selftest.ts");

// ── A small school ─────────────────────────────────────────────────────────

const DES = [
  { id: "d_prin", code: "PRIN", name: "Principal", departmentId: null, isActive: true },
  { id: "d_op", code: "OP", name: "Computer Operator", departmentId: null, isActive: true },
  { id: "d_acc", code: "ACC", name: "Accountant", departmentId: null, isActive: true },
  { id: "d_prt", code: "PRT", name: "PRT Teacher", departmentId: null, isActive: true },
  { id: "d_peon", code: "PEON", name: "Peon", departmentId: null, isActive: true },
];

function staff(id: string, designationId: string, extra: Record<string, unknown> = {}) {
  return normalizeStaffRecord({
    id,
    empCode: id.toUpperCase(),
    fullName: `Person ${id}`,
    mobile: "9000000000",
    status: "active",
    stream: designationId === "d_prt" ? "teaching" : "non_teaching",
    designationId,
    departmentId: null,
    campusId: null,
    ...extra,
  });
}

const PRINCIPAL = "s_prin";
const OFFICE = "s_office"; // "Computer Operator", office role by ASSIGNMENT
const ACCOUNTS = "s_acc";
const TEACHER_A = "s_ta"; // raises the leave; class teacher of the child
const TEACHER_B = "s_tb"; // unrelated teacher
const VICE = "s_vice"; // a teacher the school ASSIGNED the principal role
const PEON = "s_peon";
const GONE = "s_gone"; // an inactive principal

const masters: MastersState = {
  ...emptyMastersShell(),
  designations: DES,
  departments: [],
  staff: [
    staff(PRINCIPAL, "d_prin"),
    staff(OFFICE, "d_op"),
    staff(ACCOUNTS, "d_acc"),
    staff(TEACHER_A, "d_prt"),
    staff(TEACHER_B, "d_prt"),
    staff(VICE, "d_prt"),
    staff(PEON, "d_peon"),
    staff(GONE, "d_prin", { status: "inactive" }),
  ],
} as MastersState;

function assign(state: RbacState, staffId: string, code: string): RbacState {
  const role = state.roles.find((r) => r.code === code);
  assert.ok(role, `built-in role ${code}`);
  return {
    ...state,
    assignments: [
      ...state.assignments,
      { id: `a_${staffId}`, staffId, roleId: role.id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" },
    ],
  };
}

let rbac = defaultRbacState();
rbac = assign(rbac, OFFICE, "office");
rbac = assign(rbac, VICE, "principal");

const DIRECTOR = "director@bhbinternational.school";
const ctx: AudienceContext = { masters, rbac, superAdminEmails: [DIRECTOR] };
const ids = (rs: Recipient[]) => rs.map(recipientKey);
const has = (rs: Recipient[], type: Recipient["type"], id: string) => ids(rs).includes(`${type}:${id}`);

// ── Audience: a teacher's leave request ────────────────────────────────────

{
  const to = resolveAudience([{ staffLeaveApprovers: true }], ctx, [{ type: "staff", id: TEACHER_A }]);
  assert.ok(has(to, "staff", PRINCIPAL), "the principal (by designation) decides staff leave");
  assert.ok(has(to, "staff", OFFICE), "the office (by assignment) holds staff.edit");
  assert.ok(has(to, "staff", VICE), "a teacher assigned the principal role is an approver");
  assert.ok(has(to, "staff", DIRECTOR), "the director's login (no roster row) hears it");
  assert.ok(!has(to, "staff", TEACHER_A), "never the person who applied");
  assert.ok(!has(to, "staff", TEACHER_B), "never an unrelated teacher");
  assert.ok(!has(to, "staff", PEON), "never support staff");
  assert.ok(!has(to, "staff", GONE), "never someone who has left");
  // Old: designation regexes only.
  assert.ok(!leadershipStaffIds(masters).includes(VICE), "old: the assigned principal was missed");
}

// ── Audience: a parent's fee payment ───────────────────────────────────────

{
  const to = resolveAudience([{ permission: "fees", action: "edit" }, { households: ["hh_1"] }], ctx);
  for (const id of [PRINCIPAL, OFFICE, ACCOUNTS, VICE]) assert.ok(has(to, "staff", id), `fees holder ${id} hears a payment`);
  assert.ok(has(to, "parent", "hh_1"), "the family that paid hears it");
  assert.ok(!has(to, "parent", "hh_2"), "no other family");
  for (const id of [TEACHER_A, TEACHER_B, PEON]) assert.ok(!has(to, "staff", id), `${id} (no fees grant) does not`);

  // A personal deny of fees takes the office person out.
  const denied: RbacState = {
    ...rbac,
    userGrants: [
      { id: "g1", staffId: OFFICE, denyModule: "fees", effect: "deny", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" },
    ],
  };
  const to2 = resolveAudience([{ permission: "fees", action: "edit" }], { ...ctx, rbac: denied });
  assert.ok(!has(to2, "staff", OFFICE), "a personal deny wins over the role");
  assert.ok(has(to2, "staff", ACCOUNTS), "…and nobody else is affected");
}

// ── Audience: a parent's leave request for a child ─────────────────────────

{
  const rules = [{ staff: [TEACHER_A] }, { permission: "student_leave" as const, action: "approve" as const, schoolWide: true }];
  const to = resolveAudience(rules, ctx);
  assert.ok(has(to, "staff", TEACHER_A), "the class teacher");
  assert.ok(has(to, "staff", PRINCIPAL) && has(to, "staff", OFFICE), "and school-wide approvers");
  assert.ok(!has(to, "staff", TEACHER_B), "not another class's teacher");
  // Old / naive: by the grant alone, every teacher holds student_leave.approve.
  const naive = resolveAudience([{ permission: "student_leave", action: "approve" }], ctx);
  assert.ok(has(naive, "staff", TEACHER_B), "old/naive: the grant alone reached every teacher");
}

// ── Audience: rules that name people check they still work here ────────────

{
  const to = resolveAudience([{ staff: [GONE, "nobody", TEACHER_B] }, { households: ["", "hh_9"] }], ctx);
  assert.deepEqual(ids(to), ["parent:hh_9", `staff:${TEACHER_B}`], "inactive / unknown staff and blank families dropped");
  assert.deepEqual(resolveAudience([], ctx), [], "no rule, nobody — there is no 'everyone'");
}

// ── Audience: only the owner approves a held payout ────────────────────────

{
  const onRoster: MastersState = {
    ...masters,
    staff: [...masters.staff, staff("s_dir", "d_prin", { email: "Director@BHBInternational.school" })],
  } as MastersState;
  const to = resolveAudience(payoutHeld({ requestId: "p1", payeeName: "Vendor", amountLabel: "₹5,000", reason: "", requestedBy: "Accounts" }).audience, {
    ...ctx,
    masters: onRoster,
  });
  assert.deepEqual(ids(to), ["staff:s_dir"], "the owner's roster row only — not the principal, not accounts");
  const off = resolveAudience([{ owners: true }], ctx);
  assert.deepEqual(ids(off), [`staff:${DIRECTOR}`], "an owner login with no roster row, by email");
}

// ── Audience: a WhatsApp message handed to the office ──────────────────────

{
  const routed = resolveAudience(messageRelayed({ relayId: "r1", code: "A1", categoryLabel: "Fees", senderName: "X", text: "", routeStaffIds: [ACCOUNTS] }).audience, ctx);
  assert.deepEqual(ids(routed), [`staff:${ACCOUNTS}`], "the relay route's own people");
  const fallback = resolveAudience(messageRelayed({ relayId: "r2", code: "A2", categoryLabel: "Fees", senderName: "X", text: "", routeStaffIds: [] }).audience, ctx);
  assert.ok(has(fallback, "staff", OFFICE) && has(fallback, "staff", PRINCIPAL), "no route on the roster → school-wide WhatsApp desk");
  assert.ok(!has(fallback, "staff", TEACHER_B), "never a teacher");
}

// ── Kinds and voices ───────────────────────────────────────────────────────

for (const [k, def] of Object.entries(NOTIFY_KINDS)) {
  assert.ok(NOTIFY_TOPICS.includes(def.topic), `${k}: topic ${def.topic} is a known topic`);
  assert.ok(isPushVoiceKind(def.topic), `${k}: topic ${def.topic} has a spoken line`);
}

// ── Policy: mute, quiet hours (9 pm – 7 am IST), voice ─────────────────────

const at = (hhmmIst: string) => {
  const [h, m] = hhmmIst.split(":").map(Number);
  return Date.UTC(2026, 9, 20, h!, m!) - 330 * 60_000;
};
assert.equal(istMinutes(at("21:30")), 21 * 60 + 30);
assert.ok(inQuietHours(DEFAULT_PREFS, at("21:00")), "9 pm is quiet");
assert.ok(inQuietHours(DEFAULT_PREFS, at("02:15")), "2 am is quiet");
assert.ok(!inQuietHours(DEFAULT_PREFS, at("07:00")), "7 am is not");
assert.ok(!inQuietHours(DEFAULT_PREFS, at("13:00")), "1 pm is not");
assert.ok(!inQuietHours({ ...DEFAULT_PREFS, quietEnabled: false }, at("23:00")), "quiet hours can be turned off");
assert.ok(inQuietHours({ ...DEFAULT_PREFS, quietStart: "13:00", quietEnd: "14:00" }, at("13:30")), "a window inside one day");

const base = { outcome: "inserted" as const, topic: "fees" as const, urgent: false, prefs: DEFAULT_PREFS, nowMs: at("11:00") };
assert.deepEqual(decidePush(base), { push: true, voice: true });
assert.deepEqual(decidePush({ ...base, outcome: "grouped" }), { push: false, reason: "grouped" }, "a burst rings once");
assert.deepEqual(decidePush({ ...base, outcome: "duplicate" }), { push: false, reason: "duplicate" });
assert.deepEqual(decidePush({ ...base, prefs: { ...DEFAULT_PREFS, mutedTopics: ["fees"] } }), { push: false, reason: "muted" });
assert.deepEqual(decidePush({ ...base, nowMs: at("22:30") }), { push: false, reason: "quiet" });
assert.deepEqual(decidePush({ ...base, nowMs: at("22:30"), urgent: true }), { push: true, voice: true }, "urgent rings in quiet hours");
assert.deepEqual(decidePush({ ...base, prefs: { ...DEFAULT_PREFS, voice: false } }), { push: true, voice: false });

assert.deepEqual(prefsFrom({ muted_topics: ["fees", "bogus"], voice: false, quiet_start: "25:00" }), {
  ...DEFAULT_PREFS,
  mutedTopics: ["fees"],
  voice: false,
}, "stored settings: unknown topics dropped, a bad time defaulted");

// ── FCM: the channel a push rings on ───────────────────────────────────────

{
  // 21 Oct 2026: approval/document ring on `_v2` channels for apps that have
  // them (build ≥ 35); the clip (sound) keeps its name.
  const voiced = buildFcmMessage("tok", { title: "Leave request", body: "CL", url: "/leave-approvals", voiceTopic: "approval" }, "en", "1.0.34+35");
  assert.equal(voiced.message.android.notification.channel_id, "bhb_voice_approval_en_v2");
  assert.equal(voiced.message.android.notification.sound, "bhb_voice_approval_en");
  assert.equal(voiced.message.data.voice, "bhb_voice_approval_en_v2", "the app's foreground notification uses the same line");
  const doc = buildFcmMessage("tok", { title: "x", body: "y", voiceTopic: "document" }, "hi", "1.0.40+41");
  assert.equal(doc.message.android.notification.channel_id, "bhb_voice_document_hi_v2");
  assert.equal(doc.message.android.notification.sound, "bhb_voice_document_hi");
  // An app older than the v2 release keeps the channel it has.
  for (const old of ["1.0.33+34", "1.0.25+26", "", undefined, null, "garbage"]) {
    const m = buildFcmMessage("tok", { title: "x", body: "y", voiceTopic: "approval" }, "en", old);
    assert.equal(m.message.android.notification.channel_id, "bhb_voice_approval_en", `old app ${old}`);
    assert.equal(m.message.data.voice, "bhb_voice_approval_en", `old app ${old}`);
  }
  // Other topics are unchanged on every app.
  for (const v of ["1.0.34+35", "1.0.33+34"]) {
    const m = buildFcmMessage("tok", { title: "x", body: "y", voiceTopic: "fees" }, "hi", v);
    assert.equal(m.message.android.notification.channel_id, "bhb_voice_fees_hi");
    assert.equal(m.message.android.notification.sound, "bhb_voice_fees_hi");
  }
  const plain = buildFcmMessage("tok", { title: "x", body: "y", url: "/fees", channel: "bhb_default" }, "hi", "1.0.34+35");
  assert.equal(plain.message.android.notification.channel_id, "bhb_default", "voice off = the normal channel");
  assert.equal(plain.message.android.notification.sound, "default");
  assert.equal(plain.message.data.voice, "");
  const legacy = buildFcmMessage("tok", { title: "x", body: "y", url: "/homework" }, "hi", "1.0.34+35");
  assert.equal(legacy.message.android.notification.channel_id, "bhb_voice_homework_hi", "older send sites keep their inferred clip");
  assert.equal(pushVoiceChannel("document", "hi"), "bhb_voice_document_hi_v2");
}

// ── notify(): stored once per recipient, pushed per settings ───────────────

function fakeDeps(over: Partial<NotifyDeps> & { outcomes?: Record<string, "inserted" | "grouped" | "duplicate">; prefs?: Map<string, NotifyPrefs> | null } = {}) {
  const delivered: DeliverRow[][] = [];
  const pushed: { to: Recipient; msg: PushMessage }[] = [];
  const logs: string[] = [];
  const deps: NotifyDeps = {
    audienceContext: async () => ctx,
    deliver: async (rows) => {
      delivered.push(rows);
      return {
        ok: true,
        results: rows.map((r) => ({
          recipient_type: r.recipient_type,
          recipient_id: r.recipient_id,
          id: `nf_${r.recipient_id}`,
          outcome: over.outcomes?.[`${r.recipient_type}:${r.recipient_id}`] ?? "inserted",
        })),
      };
    },
    prefsFor: async () => (over.prefs === undefined ? new Map() : over.prefs),
    push: async (to, msg) => {
      pushed.push({ to, msg });
      return { sent: 1 };
    },
    now: () => at("10:00"),
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, delivered, pushed, logs };
}

const steps: (() => Promise<void>)[] = [];

const leaveEvent: NotifyEvent = {
  kind: "staff_leave.requested",
  key: "staff_leave:L1:requested",
  audience: [{ staffLeaveApprovers: true }],
  exclude: [{ type: "staff", id: TEACHER_A }],
  title: { en: "Leave request · Person s_ta" },
  body: { en: "CL 21 Oct" },
  link: "/leave-approvals",
  webLink: "/staff?tab=leave",
  data: { requestId: "L1" },
  actor: "Person s_ta",
};

steps.push(async () => {
  const f = fakeDeps({
    prefs: new Map([
      [`staff:${OFFICE}`, { ...DEFAULT_PREFS, voice: false }],
      [`staff:${VICE}`, { ...DEFAULT_PREFS, mutedTopics: ["leave"] }],
    ]),
  });
  const r = await notifyWith(f.deps, leaveEvent);
  assert.ok(r.ok);
  assert.equal(f.delivered.length, 1, "one deliver call for the whole audience");
  const rows = f.delivered[0]!;
  assert.ok(rows.every((x) => x.dedupe_key === "staff_leave:L1:requested" && x.topic === "leave" && x.kind === "staff_leave.requested"));
  assert.ok(!rows.some((x) => x.recipient_id === TEACHER_A || x.recipient_id === TEACHER_B), "stored only for approvers");
  assert.equal(r.recipients, rows.length);
  const byId = new Map(f.pushed.map((p) => [p.to.id, p.msg]));
  assert.equal(byId.get(PRINCIPAL)?.voice, true, "the principal hears the spoken line");
  assert.equal(byId.get(PRINCIPAL)?.topic, "leave");
  assert.equal(byId.get(PRINCIPAL)?.data.kind, "staff_leave.requested");
  assert.equal(byId.get(PRINCIPAL)?.data.notificationId, `nf_${PRINCIPAL}`);
  assert.equal(byId.get(OFFICE)?.voice, false, "voice off → normal sound");
  assert.ok(!byId.has(VICE), "muted topic → no push (still stored)");
  assert.ok(rows.some((x) => x.recipient_id === VICE), "…but in the bell");
  assert.ok(r.ok && r.held.muted === 1);
});

steps.push(async () => {
  // A re-raised event and a folded burst do not ring.
  const f = fakeDeps({ outcomes: { [`staff:${PRINCIPAL}`]: "duplicate", [`staff:${OFFICE}`]: "grouped" } });
  const r = await notifyWith(f.deps, leaveEvent);
  assert.ok(r.ok && r.duplicate === 1 && r.grouped === 1);
  assert.ok(!f.pushed.some((p) => p.to.id === PRINCIPAL || p.to.id === OFFICE), "duplicate and grouped stay silent");
});

steps.push(async () => {
  // Quiet hours: stored, not pushed; urgent pushes.
  const f = fakeDeps({ now: () => at("23:00") });
  const r = await notifyWith(f.deps, leaveEvent);
  assert.ok(r.ok && r.pushed === 0 && r.held.quiet === r.inserted);
  const g = fakeDeps({ now: () => at("23:00") });
  const u = await notifyWith(g.deps, { ...leaveEvent, urgent: true });
  assert.ok(u.ok && u.pushed === u.inserted && u.pushed > 0, "urgent rings at night");
});

steps.push(async () => {
  // Unknown audience = nobody, and nothing stored (R6).
  const f = fakeDeps({ audienceContext: async () => null });
  const r = await notifyWith(f.deps, leaveEvent);
  assert.equal(r.ok, false);
  assert.equal(f.delivered.length, 0);
  assert.ok(f.logs.some((l) => l.includes("could not be read")));
  // A failed store is reported, and nothing is pushed.
  const g = fakeDeps({ deliver: async () => ({ ok: false, error: "42883 function missing" }) });
  const s = await notifyWith(g.deps, leaveEvent);
  assert.equal(s.ok, false);
  assert.equal(g.pushed.length, 0, "never a push for something not stored");
  // A throwing dependency never escapes.
  const h = fakeDeps({ deliver: async () => { throw new Error("boom"); } });
  assert.equal((await notifyWith(h.deps, leaveEvent)).ok, false);
  // Settings unreadable → the defaults (pushed in the day).
  const k = fakeDeps({ prefs: null });
  const kr = await notifyWith(k.deps, leaveEvent);
  assert.ok(kr.ok && kr.pushed === kr.inserted);
});

// Burst rows carry the group.
{
  const rows = deliverRows(
    {
      kind: "fees.received",
      key: "fee:V1",
      audience: [],
      title: { en: "Fee received · ₹1,000" },
      link: "/fees",
      group: { key: "fees.received:2026-10-20", title: { en: "{n} fees received today", hi: "आज {n} फीस जमा" } },
    },
    [{ type: "staff", id: ACCOUNTS }],
  );
  assert.equal(rows[0]!.group_key, "fees.received:2026-10-20");
  assert.equal(rows[0]!.group_title, "{n} fees received today");
  assert.equal(rows[0]!.group_window_minutes, 180);
  assert.equal(rows[0]!.web_link, "/fees", "the ERP page defaults to the app link");
}

void (async () => {
  for (const step of steps) await step();
  console.log("notify.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
