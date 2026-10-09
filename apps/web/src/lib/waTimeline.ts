/**
 * One number's whole WhatsApp conversation, as the family saw it (director,
 * 9 Oct 2026: "show all communication like the actual WhatsApp app").
 *
 * The messages come from several stores — the full log (wa_messages, from
 * 9 Oct), the bot and staff threads, household_message_log (automation),
 * the office relay — and the same message is often in two of them. Merge
 * here: one bubble per message, in time order, labelled with what sent it.
 * Pure.
 */

export type TimelineStatus = "" | "sent" | "delivered" | "read" | "failed";

export type TimelineMsg = {
  id: string;
  direction: "in" | "out";
  /** ISO time (UTC). Shown in IST by the screen. */
  at: string;
  text: string;
  /** What sent it: "Bot", a staff name, "Homework", "Fee receipt", "Office relay"… */
  label: string;
  kind: string;
  waMessageId: string;
  status: TimelineStatus;
  /** For an inbound reply: the text of the school message it answered. */
  replyToText: string;
  replyToWaMessageId: string;
  error: string;
  /** Which store it came from — the richer copy wins when two agree. */
  source: "log" | "thread" | "automation" | "relay";
};

const RANK: Record<TimelineMsg["source"], number> = { thread: 3, automation: 2, relay: 2, log: 1 };

const norm = (t: string) => t.toLowerCase().replace(/[*_~]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);

/** Same message in two stores? Same WhatsApp id, or same words the same way within two minutes. */
function same(a: TimelineMsg, b: TimelineMsg): boolean {
  if (a.waMessageId && b.waMessageId) return a.waMessageId === b.waMessageId;
  if (a.direction !== b.direction) return false;
  if (Math.abs(Date.parse(a.at) - Date.parse(b.at)) > 120_000) return false;
  const x = norm(a.text);
  const y = norm(b.text);
  return !!x && !!y && (x === y || x.startsWith(y.slice(0, 80)) || y.startsWith(x.slice(0, 80)));
}

function mergeTwo(a: TimelineMsg, b: TimelineMsg): TimelineMsg {
  const [hi, lo] = RANK[a.source] >= RANK[b.source] ? [a, b] : [b, a];
  return {
    ...hi,
    text: hi.text || lo.text,
    label: hi.label && hi.label !== "School" ? hi.label : lo.label || hi.label,
    waMessageId: hi.waMessageId || lo.waMessageId,
    status: hi.status || lo.status,
    replyToText: hi.replyToText || lo.replyToText,
    replyToWaMessageId: hi.replyToWaMessageId || lo.replyToWaMessageId,
    error: hi.error || lo.error,
    // The earliest time either store recorded.
    at: Date.parse(lo.at) < Date.parse(hi.at) ? lo.at : hi.at,
  };
}

export function mergeTimeline(lists: TimelineMsg[][]): TimelineMsg[] {
  const all = lists.flat().filter((m) => m.at && !Number.isNaN(Date.parse(m.at)));
  all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: TimelineMsg[] = [];
  for (const m of all) {
    // Look back over the last few bubbles only — duplicates sit close together.
    let merged = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 12; i--) {
      if (same(out[i]!, m)) {
        out[i] = mergeTwo(out[i]!, m);
        merged = true;
        break;
      }
    }
    if (!merged) out.push(m);
  }
  // Fill "replying to" from the message it points at.
  const byId = new Map(out.filter((m) => m.waMessageId).map((m) => [m.waMessageId, m]));
  return out.map((m) => (m.replyToWaMessageId && !m.replyToText ? { ...m, replyToText: byId.get(m.replyToWaMessageId)?.text.slice(0, 160) || "" } : m));
}

/** A friendly name for an automation template. */
export function templateLabel(name: string): string {
  const n = name.toLowerCase();
  const rules: [RegExp, string][] = [
    [/homework/, "Homework"],
    [/receipt/, "Fee receipt"],
    [/fee|dues|pay/, "Fees"],
    [/attend|absent/, "Attendance"],
    [/transport|bus|fleet/, "Transport"],
    [/brief|digest/, "Daily brief"],
    [/otp|login|code/, "Login code"],
    [/birthday/, "Birthday"],
    [/exam|result|datesheet/, "Exams"],
    [/ptm/, "PTM"],
    [/holiday|notice|circular|broadcast|announce/, "Notice"],
    [/apaar|udise|aadhaar/, "UDISE / APAAR"],
    [/leave/, "Leave"],
  ];
  for (const [re, label] of rules) if (re.test(n)) return label;
  return "Automation";
}

/**
 * Fill a template body with the values sent. Blanks are {{1}}, {{2}}… or
 * named ({{childName}}); named ones take the values in `variables` order
 * (else order of first appearance). A blank with no value shows as "…".
 */
export function renderTemplate(body: string, params: string[], variables: string[] = []): string {
  const order = [...variables];
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!/^\d+$/.test(m[1]!) && !order.includes(m[1]!)) order.push(m[1]!);
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const i = /^\d+$/.test(k) ? Number(k) - 1 : order.indexOf(k);
    const v = i >= 0 ? params[i] : undefined;
    return v === undefined || v === "" ? "…" : v;
  });
}

/** Meta's statuses, best last: a read message was also delivered and sent. */
export function bestStatus(statuses: string[]): TimelineStatus {
  const order: TimelineStatus[] = ["sent", "delivered", "read"];
  if (statuses.includes("failed") && !statuses.some((s) => s === "delivered" || s === "read")) return "failed";
  let best: TimelineStatus = "";
  for (const s of statuses) if (order.indexOf(s as TimelineStatus) > order.indexOf(best)) best = s as TimelineStatus;
  return best;
}

/** "9 Oct 2026, 3:50 pm" in India time, whatever the browser's zone. */
export function istTime(iso: string, withDate = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    ...(withDate ? { day: "numeric", month: "short", year: "numeric" } : {}),
  });
}

/** The IST calendar day of a time, for date separators: "2026-10-09". */
export function istDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
