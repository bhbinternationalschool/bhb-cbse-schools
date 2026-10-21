/**
 * The events the ERP raises, each as one builder: what it says (English for
 * staff; English + Hindi for a family), where it opens, its dedupe key, and
 * — the part that matters — who it reaches (lib/notify/audience.ts rules).
 * Pure; the call sites pass what they already know and `await notify(...)`.
 *
 * `link` is a route the apps' homes open (…?open=<link>); "/notifications"
 * opens the app's notifications list, for events with no screen of their own.
 *
 * The event → audience → channel table in the PR is this file.
 */
import type { NotifyEvent } from "./notify";

const range = (from: string, to?: string) => (to && to !== from ? `${from} to ${to}` : from);
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Leave ──────────────────────────────────────────────────────────────────

/** A member of staff applied → whoever decides staff leave (+ their named approvers), never the applicant. */
export function staffLeaveRequested(p: {
  requestId: string;
  staffId: string;
  staffName: string;
  typeCode: string;
  fromDate: string;
  toDate: string;
  reason: string;
  namedApproverIds: readonly string[];
}): NotifyEvent {
  return {
    kind: "staff_leave.requested",
    key: `staff_leave:${p.requestId}:requested`,
    audience: [{ staffLeaveApprovers: true }, { staff: p.namedApproverIds }],
    exclude: [{ type: "staff", id: p.staffId }],
    title: { en: `Leave request · ${p.staffName}` },
    body: { en: `${p.typeCode} ${range(p.fromDate, p.toDate)}${p.reason ? ` · ${short(p.reason, 80)}` : ""}` },
    link: "/leave-approvals",
    webLink: "/staff?tab=leave",
    data: { requestId: p.requestId },
    actor: p.staffName,
  };
}

/** A staff leave was decided → the applicant. */
export function staffLeaveDecided(p: {
  requestId: string;
  staffId: string;
  status: string;
  typeCode: string;
  fromDate: string;
  toDate: string;
  note?: string;
  decidedBy: string;
}): NotifyEvent {
  const title =
    p.status === "approved" ? "Leave approved" : p.status === "pending_l2" ? "Leave cleared at level 1" : "Leave not approved";
  return {
    kind: "staff_leave.decided",
    key: `staff_leave:${p.requestId}:${p.status}`,
    audience: [{ staff: [p.staffId] }],
    title: { en: title },
    body: { en: `${p.typeCode} ${range(p.fromDate, p.toDate)} · by ${p.decidedBy}${p.note ? ` · ${short(p.note, 80)}` : ""}` },
    link: "/leave",
    webLink: "/staff?tab=my",
    data: { requestId: p.requestId, status: p.status },
    actor: p.decidedBy,
  };
}

/**
 * A family asked leave for a child → the child's class teacher(s); and, for
 * a long / medical leave or a class with no teacher, the school-wide
 * approvers too (owner / principal / admin / office holding
 * student_leave.approve) — never every teacher, though every teacher holds
 * that grant for her own class.
 */
export function studentLeaveRequested(p: {
  requestId: string;
  studentId: string;
  studentName: string;
  classTeacherIds: readonly string[];
  /** Over 3 days, medical, long — the school-wide approvers decide it. */
  leadershipToo: boolean;
  typeLabel: string;
  fromDate: string;
  toDate: string;
  reason: string;
}): NotifyEvent {
  return {
    kind: "student_leave.requested",
    key: `student_leave:${p.requestId}:requested`,
    audience:
      p.leadershipToo || p.classTeacherIds.length === 0
        ? [{ staff: p.classTeacherIds }, { permission: "student_leave", action: "approve", schoolWide: true }]
        : [{ staff: p.classTeacherIds }],
    title: { en: `Leave request · ${p.studentName}` },
    body: { en: `${p.typeLabel} ${range(p.fromDate, p.toDate)}${p.reason ? ` · ${short(p.reason, 80)}` : ""}` },
    link: "/student-leave",
    webLink: "/student-leave",
    data: { requestId: p.requestId, studentId: p.studentId },
  };
}

/** The school decided a child's leave → that family. */
export function studentLeaveDecided(p: {
  requestId: string;
  householdId: string;
  studentName: string;
  status: string;
  fromDate: string;
  toDate?: string;
  decidedBy: string;
}): NotifyEvent {
  const approved = p.status === "approved";
  return {
    kind: "student_leave.decided",
    key: `student_leave:${p.requestId}:${p.status}`,
    audience: [{ households: [p.householdId] }],
    title: {
      en: `Leave ${approved ? "approved" : p.status} · ${p.studentName}`,
      hi: `${p.studentName} की छुट्टी ${approved ? "मंज़ूर" : p.status === "rejected" ? "नामंज़ूर" : p.status}`,
    },
    body: {
      en: `${range(p.fromDate, p.toDate)} — ${p.status} by ${p.decidedBy}.`,
      hi: `${range(p.fromDate, p.toDate)} — ${p.decidedBy}`,
    },
    link: "/leave",
    webLink: "/parent",
    data: { requestId: p.requestId, status: p.status },
    actor: p.decidedBy,
  };
}

// ── Approvals ──────────────────────────────────────────────────────────────

/** A member of staff raised a request (Staff → Requests) → the people who manage them, never the raiser. */
export function staffRequestRaised(p: { requestId: string; staffId: string; staffName: string; typeLabel: string; subject: string }): NotifyEvent {
  return {
    kind: "staff_request.raised",
    key: `staff_request:${p.requestId}:raised`,
    audience: [{ staffLeaveApprovers: true }],
    exclude: [{ type: "staff", id: p.staffId }],
    title: { en: `Request · ${p.staffName}` },
    body: { en: `${p.typeLabel}: ${short(p.subject, 120)}` },
    link: "/notifications",
    webLink: "/staff?tab=requests",
    data: { requestId: p.requestId },
    actor: p.staffName,
  };
}

/** A request was assigned / its status changed → the person who raised it (and a new assignee). */
export function staffRequestUpdated(p: {
  requestId: string;
  rev: number;
  raisedByStaffId: string;
  assigneeStaffId?: string;
  byStaffId?: string;
  byName: string;
  subject: string;
  status: string;
}): NotifyEvent {
  const who = [p.raisedByStaffId, ...(p.assigneeStaffId ? [p.assigneeStaffId] : [])];
  return {
    kind: "staff_request.updated",
    key: `staff_request:${p.requestId}:rev${p.rev}`,
    audience: [{ staff: who }],
    exclude: p.byStaffId ? [{ type: "staff", id: p.byStaffId }] : [],
    title: { en: `Request ${p.status.replace("_", " ")}` },
    body: { en: `${short(p.subject, 120)} · ${p.byName}` },
    link: "/notifications",
    webLink: "/staff?tab=requests",
    data: { requestId: p.requestId, status: p.status },
    actor: p.byName,
  };
}

/** A class photo / video was held for review → whoever may edit the gallery school-wide. */
export function galleryHeld(p: { photoId: string; title: string; body: string }): NotifyEvent {
  return {
    kind: "gallery.held",
    key: `gallery:${p.photoId}:held`,
    audience: [{ permission: "gallery", action: "edit", schoolWide: true }],
    title: { en: p.title },
    body: { en: p.body },
    link: "/notifications",
    webLink: "/comms?tab=gallery",
    data: { id: p.photoId },
  };
}

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * A family sent a document (UDISE+ over WhatsApp, a profile upload) → the
 * office people the intake already picked (`staffIds`), plus whoever may
 * edit student records school-wide.
 */
export function documentReceived(p: { refId: string; staffIds: readonly string[]; title: string; body: string; webLink: string }): NotifyEvent {
  return {
    kind: "document.received",
    key: `document:${p.refId}:received`,
    audience: [{ staff: p.staffIds }, { permission: "students", action: "edit", schoolWide: true }],
    title: { en: p.title },
    body: { en: p.body },
    link: "/documents",
    webLink: p.webLink,
    data: { id: p.refId },
  };
}

/** A parent-uploaded document was verified / rejected → that family. */
export function documentReviewed(p: {
  studentId: string;
  householdId: string;
  docKey: string;
  docLabel: string;
  studentName: string;
  verdict: "verified" | "rejected";
  note: string;
  at: string;
}): NotifyEvent {
  const ok = p.verdict === "verified";
  return {
    kind: "document.reviewed",
    key: `document:${p.studentId}:${p.docKey}:${p.verdict}:${p.at}`,
    audience: [{ households: [p.householdId] }],
    title: {
      en: ok ? `${p.docLabel} verified` : `${p.docLabel} needs another upload`,
      hi: ok ? `${p.docLabel} जाँच लिया गया` : `${p.docLabel} दोबारा भेजें`,
    },
    body: {
      en: ok ? `${p.studentName}'s ${p.docLabel.toLowerCase()} has been checked and accepted.` : `${p.studentName}: ${p.note}`,
      hi: ok ? `${p.studentName} का ${p.docLabel} स्वीकार हो गया।` : `${p.studentName}: ${p.note}`,
    },
    link: `/profile?studentId=${encodeURIComponent(p.studentId)}`,
    webLink: "/parent",
    data: { studentId: p.studentId, key: p.docKey, verdict: p.verdict },
  };
}

// ── Messages ───────────────────────────────────────────────────────────────

/** A chat message about a child → the other side: the class teacher(s), or the family. */
export function chatMessage(p: {
  messageId: string;
  studentId: string;
  studentName: string;
  fromParent: boolean;
  senderName: string;
  teacherStaffIds: readonly string[];
  householdId: string;
  senderStaffId?: string;
  preview: string;
}): NotifyEvent {
  const url = `/chat?studentId=${encodeURIComponent(p.studentId)}`;
  return {
    kind: "message.chat",
    key: `chat:${p.messageId}`,
    audience: p.fromParent ? [{ staff: p.teacherStaffIds }] : [{ households: [p.householdId] }],
    exclude: p.senderStaffId ? [{ type: "staff", id: p.senderStaffId }] : [],
    title: p.fromParent
      ? { en: `${p.senderName} · ${p.studentName}` }
      : { en: `${p.senderName} (class teacher)`, hi: `${p.senderName} (कक्षा अध्यापक)` },
    body: { en: p.preview, hi: p.preview },
    link: url,
    webLink: p.fromParent ? `/my-class?chat=${encodeURIComponent(p.studentId)}` : "/parent",
    data: { studentId: p.studentId },
    actor: p.senderName,
    // A chat is a conversation: an unread run from one thread folds into one row.
    group: {
      key: `chat:${p.studentId}`,
      windowMinutes: 120,
      title: p.fromParent
        ? { en: `{n} messages · ${p.studentName}` }
        : { en: `{n} messages from ${p.senderName}`, hi: `${p.senderName} के {n} संदेश` },
    },
  };
}

/** A family raised a complaint → the class teacher(s) and whoever handles complaints school-wide. */
export function complaintCreated(p: { ticketId: string; categoryLabel: string; subject: string; studentName?: string; classTeacherIds: readonly string[] }): NotifyEvent {
  return {
    kind: "complaint.created",
    key: `complaint:${p.ticketId}:created`,
    audience: [{ staff: p.classTeacherIds }, { permission: "complaints", action: "approve", schoolWide: true }],
    title: { en: `New complaint · ${p.categoryLabel}` },
    body: { en: `${short(p.subject, 120)}${p.studentName ? ` · ${p.studentName}` : ""}` },
    link: "/complaints",
    webLink: "/complaints",
    data: { ticketId: p.ticketId },
  };
}

// ── Fees ───────────────────────────────────────────────────────────────────

const who = (p: { studentName: string; classLabel: string }) => (p.classLabel ? `${p.studentName} (${p.classLabel})` : p.studentName);

/** A fee was received → the family (their receipt). */
export function feeReceipt(p: { voucherId: string; householdId: string; receiptNo: string; amountLabel: string; studentName: string; classLabel: string }): NotifyEvent {
  return {
    kind: "fees.receipt",
    key: `fee:${p.voucherId}:receipt`,
    audience: [{ households: [p.householdId] }],
    title: { en: `Fee received · ${p.amountLabel}`, hi: `फीस प्राप्त · ${p.amountLabel}` },
    body: {
      en: `Receipt ${p.receiptNo} for ${who(p)}. Thank you.`,
      hi: `${who(p)} की रसीद ${p.receiptNo}। धन्यवाद।`,
    },
    link: "/fees",
    webLink: "/parent",
    data: { receiptNo: p.receiptNo },
  };
}

/**
 * A fee was received → whoever may edit fees (office, accounts, principal,
 * owner) — never a teacher. A day's receipts fold into one unread row per
 * person ("12 fees received today") and ring once.
 */
export function feeReceivedForOffice(p: {
  voucherId: string;
  receiptNo: string;
  amountLabel: string;
  studentName: string;
  classLabel: string;
  mode: string;
  collectedByStaffId?: string;
  istDate: string;
}): NotifyEvent {
  return {
    kind: "fees.received",
    key: `fee:${p.voucherId}:received`,
    audience: [{ permission: "fees", action: "edit" }],
    exclude: p.collectedByStaffId ? [{ type: "staff", id: p.collectedByStaffId }] : [],
    title: { en: `Fee received · ${p.amountLabel}` },
    body: { en: `${who(p)} · ${p.mode} · receipt ${p.receiptNo}` },
    link: "/notifications",
    webLink: "/fees?tab=receipts",
    data: { receiptNo: p.receiptNo },
    group: { key: `fees.received:${p.istDate}`, windowMinutes: 720, title: { en: "{n} fees received today" } },
  };
}

// ── Notices ────────────────────────────────────────────────────────────────

/**
 * A notice was published → the audience its publisher chose (staff, families
 * or both — lib/noticePush.server.ts resolves the ids; the publisher holds
 * the comms grant to address them).
 */
export function noticePublished(p: {
  noticeId: string;
  title: string;
  body: string;
  link: string;
  staffIds: readonly string[];
  householdIds: readonly string[];
}): NotifyEvent {
  return {
    kind: "notice.published",
    key: `notice:${p.noticeId}:published`,
    audience: [{ staff: p.staffIds }, { households: p.householdIds }],
    title: { en: p.title },
    body: { en: p.body },
    link: p.link,
    webLink: `/comms?tab=notices&notice=${encodeURIComponent(p.noticeId)}`,
    data: { noticeId: p.noticeId },
  };
}

// ── More messages and approvals (follow-up, 20 Oct 2026) ───────────────────

/**
 * A WhatsApp message the bot handed to the office (lib/waRelay.server.ts) →
 * the staff whose phones are the relay route for its category; with no such
 * person on the roster, the school-wide office (notices.edit — the inbox is
 * the office's: lib/apiRouteAuth requireWaStaffApi).
 */
export function messageRelayed(p: { relayId: string; code: string; categoryLabel: string; senderName: string; text: string; routeStaffIds: readonly string[] }): NotifyEvent {
  return {
    kind: "message.relayed",
    key: `relay:${p.relayId}`,
    audience: p.routeStaffIds.length ? [{ staff: p.routeStaffIds }] : [{ permission: "notices", action: "edit", schoolWide: true }],
    title: { en: `WhatsApp · ${p.categoryLabel} · ${p.senderName || "Unknown"}` },
    body: { en: `${short(p.text || "(attachment)", 140)} · code ${p.code}` },
    link: "/notifications",
    webLink: "/comms?tab=whatsapp",
    data: { relayId: p.relayId, code: p.code },
    actor: p.senderName,
  };
}

/** A message in the ERP's own chat (staff ↔ staff, staff ↔ family, class announcements) → the thread's other members. */
export function erpChatMessage(p: {
  messageId: string;
  threadId: string;
  threadTitle: string;
  senderName: string;
  senderStaffId?: string;
  senderHouseholdId?: string;
  staffIds: readonly string[];
  householdIds: readonly string[];
  text: string;
}): NotifyEvent {
  return {
    kind: "message.staff_chat",
    key: `erp_chat:${p.messageId}`,
    audience: [{ staff: p.staffIds }, { households: p.householdIds }],
    exclude: [
      ...(p.senderStaffId ? [{ type: "staff" as const, id: p.senderStaffId }] : []),
      ...(p.senderHouseholdId ? [{ type: "parent" as const, id: p.senderHouseholdId }] : []),
    ],
    title: { en: `${p.senderName} · ${p.threadTitle}`, hi: `${p.senderName} · ${p.threadTitle}` },
    body: { en: short(p.text, 140), hi: short(p.text, 140) },
    link: "/notifications",
    webLink: "/home",
    data: { threadId: p.threadId },
    actor: p.senderName,
    group: { key: `erp_chat:${p.threadId}`, windowMinutes: 120, title: { en: `{n} messages · ${p.threadTitle}`, hi: `{n} संदेश · ${p.threadTitle}` } },
  };
}

/** A payout (vendor bill, voucher, visiting fee) was held for the owner → the owner's logins only. */
export function payoutHeld(p: { requestId: string; payeeName: string; amountLabel: string; reason: string; requestedBy: string }): NotifyEvent {
  return {
    kind: "payout.held",
    key: `payout:${p.requestId}:held`,
    audience: [{ owners: true }],
    title: { en: `Payment to approve · ${p.amountLabel}` },
    body: { en: `${p.payeeName}${p.reason ? ` · ${short(p.reason, 80)}` : ""} · asked by ${p.requestedBy}` },
    link: "/notifications",
    webLink: "/accounts?tab=payouts",
    data: { requestId: p.requestId },
    actor: p.requestedBy,
  };
}

/** The owner approved / turned down a held payout → whoever approves accounts school-wide (the people who asked). */
export function payoutDecided(p: { requestId: string; payeeName: string; amountLabel: string; approved: boolean; decidedBy: string; decidedByStaffId?: string; note?: string }): NotifyEvent {
  return {
    kind: "payout.decided",
    key: `payout:${p.requestId}:${p.approved ? "approved" : "rejected"}`,
    audience: [{ permission: "accounts", action: "approve", schoolWide: true }],
    exclude: p.decidedByStaffId ? [{ type: "staff", id: p.decidedByStaffId }] : [],
    title: { en: `Payment ${p.approved ? "approved" : "turned down"} · ${p.amountLabel}` },
    body: { en: `${p.payeeName} · by ${p.decidedBy}${p.note ? ` · ${short(p.note, 80)}` : ""}` },
    link: "/notifications",
    webLink: "/accounts?tab=payouts",
    data: { requestId: p.requestId },
    actor: p.decidedBy,
  };
}
