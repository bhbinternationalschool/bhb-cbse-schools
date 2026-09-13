/**
 * The office relay: a message the bot could not answer goes to an office
 * phone, and the office answers from that phone.
 *
 * WHY
 * Until 2026-09-13 nothing told anyone when the bot gave up. A parent who
 * typed HUMAN, said "I have already paid", sent a voice note the bot could not
 * hear, or asked something it had no answer to was marked "needs_staff" inside
 * a jsonb blob — and a person saw it only if they happened to open the inbox.
 * Ten of the twenty-six live parent conversations were sitting in that state.
 *
 * HOW
 *   1. The bot gives up on a message. It is recorded with a short code (#K7Q2)
 *      and forwarded to every office number that has taken that category.
 *   2. The office swipes-to-reply on the forward, or starts a message with the
 *      code. Either identifies the original sender.
 *   3. The reply goes back to that sender FROM THE SCHOOL NUMBER. The parent
 *      never sees the office phone's number.
 *   4. Every forward and every reply is kept.
 *
 * This file is pure: categories, routing and code parsing. Sending and storage
 * live in waRelay.server.ts.
 */

export type RelayCategory =
  | "parent"
  | "fee_enquiry"
  | "complaint"
  | "transport"
  | "admission_enquiry"
  | "job_enquiry"
  | "vendor_enquiry"
  | "meeting"
  | "staff"
  | "general";

export const RELAY_CATEGORIES: {
  id: RelayCategory;
  label: string;
  hint: string;
}[] = [
  { id: "parent", label: "Parent messages", hint: "Enrolled families — anything the parent bot could not answer" },
  { id: "fee_enquiry", label: "Fees", hint: "Already paid, need more time, a promise to pay, fee questions" },
  { id: "complaint", label: "Complaints", hint: "Complaint forms submitted over WhatsApp" },
  { id: "transport", label: "Transport", hint: "Bus problems, drivers, transport enquiries" },
  { id: "admission_enquiry", label: "Admission enquiries", hint: "New families asking about admission" },
  { id: "job_enquiry", label: "Job applications", hint: "People asking for a job or sending a CV" },
  { id: "vendor_enquiry", label: "Vendors", hint: "Suppliers and service providers" },
  { id: "meeting", label: "Meeting requests", hint: "Someone asking to meet the school" },
  { id: "staff", label: "Staff messages", hint: "Teachers and office staff the staff bot could not help" },
  {
    id: "general",
    label: "General (catch-all)",
    hint: "Unknown numbers, and ANY category no other number has taken",
  },
];

export function isRelayCategory(v: unknown): v is RelayCategory {
  return RELAY_CATEGORIES.some((c) => c.id === v);
}

export function relayCategoryLabel(id: string): string {
  return RELAY_CATEGORIES.find((c) => c.id === id)?.label ?? "General";
}

/** One office phone and the kinds of message it takes. */
export type RelayRoute = {
  id: string;
  name: string;
  /** Ten digits. */
  mobile10: string;
  categories: RelayCategory[];
  active: boolean;
};

/** Indian mobile → ten digits, or "" when it is not a usable mobile. */
export function relayMobile10(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
}

export function normalizeRelayRoute(raw: unknown): RelayRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mobile10 = relayMobile10(r.mobile10 ?? r.mobile);
  if (!mobile10) return null;
  const categories = Array.isArray(r.categories)
    ? [...new Set(r.categories.filter(isRelayCategory))]
    : [];
  return {
    id: String(r.id || `rr_${mobile10}`),
    name: String(r.name ?? "").trim().slice(0, 60) || "Office",
    mobile10,
    categories,
    active: r.active !== false,
  };
}

/**
 * Which office phones receive a message of this category.
 *
 * Every active route that has taken the category — two people can share
 * fees, and whoever answers first answers. If nobody has taken it, the
 * "general" routes receive it, so no category can fall silently on the floor
 * just because the office has not set a number for it yet.
 *
 * Returns nothing only when no active route exists at all; the caller records
 * the message as undelivered rather than pretending it went somewhere.
 */
export function routesFor(
  category: RelayCategory,
  routes: RelayRoute[],
): RelayRoute[] {
  const active = routes.filter((r) => r.active && r.categories.length > 0);
  const direct = active.filter((r) => r.categories.includes(category));
  if (direct.length > 0) return dedupeByMobile(direct);
  return dedupeByMobile(active.filter((r) => r.categories.includes("general")));
}

function dedupeByMobile(routes: RelayRoute[]): RelayRoute[] {
  const seen = new Set<string>();
  return routes.filter((r) => (seen.has(r.mobile10) ? false : (seen.add(r.mobile10), true)));
}

/** Is this number one of the office relay phones? */
export function isRelayOfficeNumber(mobile: string, routes: RelayRoute[]): boolean {
  const m = relayMobile10(mobile);
  return !!m && routes.some((r) => r.active && r.mobile10 === m);
}

/* ── codes ─────────────────────────────────────────────────────── */

// No 0/O, 1/I/L: a code is read off a phone screen and typed with a thumb.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function makeRelayCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * "#K7Q2 your fees are cleared" → { code: "K7Q2", body: "your fees are cleared" }.
 *
 * Case-insensitive, tolerant of a space after the hash ("# k7q2") and of a
 * colon or dash after the code, because that is how people type on a phone.
 * A message that does not START with a code is not a coded reply — "#1 in
 * class" in the middle of a sentence must not be mistaken for one.
 */
export function parseRelayReplyCode(
  text: string,
): { code: string; body: string } | null {
  const m = /^\s*#\s*([23456789A-HJ-NP-Za-hj-np-z]{4})\b[\s:,\-–—]*([\s\S]*)$/.exec(text || "");
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  if (![...code].every((ch) => CODE_ALPHABET.includes(ch))) return null;
  return { code, body: (m[2] || "").trim() };
}

/* ── what the office receives ─────────────────────────────────── */

export type RelayForwardFacts = {
  code: string;
  category: RelayCategory;
  senderName: string;
  senderMobile10: string;
  /** "AARAV SHARMA · V-A", or "" when not a family. */
  context: string;
  text: string;
  /** "🎤 voice note", "📷 photo" … when media arrived. */
  mediaNote: string;
  /** Why the bot handed it over, in words. */
  reason: string;
};

/** The forward as free text, sent while the office phone's 24h window is open. */
export function formatRelayForward(f: RelayForwardFacts): string {
  const lines = [
    `📨 *${relayCategoryLabel(f.category)}* · #${f.code}`,
    `From: *${f.senderName || "Unknown"}* (${f.senderMobile10 || "—"})`,
    f.context ? `Re: ${f.context}` : "",
    f.reason ? `Why you got this: ${f.reason}` : "",
    "",
    f.text ? `"${f.text.slice(0, 1500)}"` : "",
    f.mediaNote ? f.mediaNote : "",
    "",
    `↩️ Swipe right on this message and reply — or start your message with #${f.code}. Your answer goes to them from the school number.`,
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

/**
 * Template parameters cannot carry newlines, tabs or more than four spaces in
 * a row — Meta refuses the whole send. Collapse them.
 */
export function templateSafe(text: string, max = 900): string {
  return (text || "")
    .replace(/[\r\n\t]+/g, " / ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, max) || "—";
}

/**
 * Map what the bot reported to a relay category.
 *
 * `audience` is the unified bot's name for the flow that handled the message;
 * `roleKinds` are what the sender's number resolved to; `feeReply` is whether
 * the text reads as a fee reply ("jama kar diya", "thoda samay chahiye").
 */
export function relayCategoryFor(input: {
  audience: string;
  roleKinds: string[];
  feeReply: boolean;
}): RelayCategory {
  const a = input.audience || "";
  const isParent = input.roleKinds.includes("parent");
  const isStaff = input.roleKinds.some((k) => k === "staff" || k === "teacher" || k === "owner");

  if (a === "sis_parent" || (a === "voice_note_handoff" && isParent)) {
    return input.feeReply ? "fee_enquiry" : "parent";
  }
  if (a === "crm_admission_parent") return "admission_enquiry";
  if (a === "visitor_fee") return "fee_enquiry";
  if (a === "visitor_job") return "job_enquiry";
  if (a === "vendor") return "vendor_enquiry";
  if (a === "visitor_transport" || a === "transport_driver") return "transport";
  if (
    a.startsWith("staff_") ||
    a === "class_channel_teacher" ||
    a === "survey_agent" ||
    (a === "voice_note_handoff" && isStaff)
  ) {
    return "staff";
  }
  if (isParent) return input.feeReply ? "fee_enquiry" : "parent";
  if (isStaff) return "staff";
  return "general";
}

/** A human line for the office: why this was handed over. */
export function relayReasonFor(audience: string, hasMedia: boolean): string {
  if (audience === "voice_note_handoff") return "voice note the bot could not understand";
  if (audience.startsWith("visitor")) return "number not on the school's records";
  if (hasMedia) return "sent a file the bot cannot act on";
  return "the bot could not answer";
}
