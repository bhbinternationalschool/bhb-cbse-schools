/**
 * A student's own WhatsApp number: what parents and students type, and the
 * one rule that makes it safe.
 *
 * Study help arrived household-scoped — the family's number talks to the
 * tutor — but the child doing the homework is often not holding that phone.
 * So a student gets their own number, granted by their parent.
 *
 * THE RULE: a linked student number may use study help and nothing else.
 * It cannot see fee dues, receipts, pay links, the household record or the
 * family's message history, and it cannot buy a pass. A child's phone is
 * lost, shared and borrowed far more often than a parent's, and none of
 * that should travel with it. `STUDENT_ALLOWED` below is the whole
 * permitted surface, and it is deliberately short.
 *
 * Pure: the parsing, the messages and the scope rule, none of which need a
 * database to be worth testing.
 */

/** How long a link code is good for. Long enough to hand a phone over. */
export const LINK_CODE_TTL_MS = 24 * 60 * 60_000;

/** Exactly what a student's own number may ask for. */
export const STUDENT_ALLOWED = new Set([
  "TUTOR",
  "HINT",
  "HINTS",
  "TEACH",
  "EXAMPLES",
  "EXAMPLE",
  "PRACTICE",
  "SCORE",
  "CHECK",
  "HOMEWORK",
  "HW",
  "EXAM",
  "LINK",
  "HELP",
  "MENU",
  "HI",
  "HELLO",
  "NAMASTE",
]);

/**
 * Words a student number must never be served, even though the parent bot
 * understands them. Listed explicitly rather than inferred, so that adding
 * a keyword to the parent bot cannot silently widen what a child's phone
 * can read.
 */
export const STUDENT_DENIED = new Set([
  "DUES",
  "PAY",
  "RECEIPTS",
  "RECEIPT",
  "PASS",
  "BUY",
  "KIDS",
  "COMPLAINT",
  "HUMAN",
  "INFO",
]);

export type StudentScopeVerdict =
  | { allowed: true }
  | { allowed: false; reason: "money" | "family_data" | "unknown" };

/**
 * May a student's own number ask this?
 *
 * Unknown words are ALLOWED, because inside study help an unknown word is
 * the child's question — refusing those would make the tutor unusable. The
 * denied list is what matters, and it is closed.
 */
export function studentScopeCheck(text: string): StudentScopeVerdict {
  const first = (text || "").trim().split(/\s+/)[0]?.toUpperCase() || "";
  if (!first) return { allowed: true };
  if (!STUDENT_DENIED.has(first)) return { allowed: true };
  return {
    allowed: false,
    reason:
      first === "PASS" || first === "BUY" || first === "PAY"
        ? "money"
        : "family_data",
  };
}

export type ParentLinkCommand =
  /** LINK — show the children and how to link one. */
  | { kind: "list" }
  /** LINK 2 9876543210 — start linking that number to the second child. */
  | { kind: "start"; index: number; mobile10: string }
  /** UNLINK 2 — take the number off that child. */
  | { kind: "revoke"; index: number }
  | { kind: "none" };

function tenDigits(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  const ten =
    d.length === 12 && d.startsWith("91")
      ? d.slice(2)
      : d.length === 11 && d.startsWith("0")
        ? d.slice(1)
        : d;
  return ten.length === 10 && /^[6-9]/.test(ten) ? ten : "";
}

/** What the PARENT typed, on their own number. */
export function parseParentLinkCommand(raw: string): ParentLinkCommand {
  const text = (raw || "").trim();
  if (!text) return { kind: "none" };
  const parts = text.split(/\s+/);
  const head = (parts[0] || "").toUpperCase();

  if (head === "UNLINK") {
    const n = Number(parts[1]);
    if (Number.isInteger(n) && n > 0) return { kind: "revoke", index: n };
    return { kind: "list" };
  }
  if (head !== "LINK" && head !== "LINKS") return { kind: "none" };
  if (parts.length === 1) return { kind: "list" };

  const n = Number(parts[1]);
  const mobile10 = tenDigits(parts.slice(2).join(""));
  if (Number.isInteger(n) && n > 0 && mobile10) {
    return { kind: "start", index: n, mobile10 };
  }
  return { kind: "list" };
}

/**
 * What the STUDENT typed. Only one thing matters before they are linked:
 * the code their parent gave them.
 */
export function parseStudentLinkCode(raw: string): string {
  const text = (raw || "").trim();
  const m = text.match(/^(?:LINK\s+)?(\d{6})$/i);
  return m ? m[1]! : "";
}

export function composeLinkMenu(opts: {
  children: { name: string; classLabel: string; linkedMobile10?: string }[];
}): string {
  if (!opts.children.length) {
    return "No enrolled child is on this number. Please ask the school office to check the record.";
  }
  const lines = [
    "*Your child's own WhatsApp* 📱",
    "",
    "Give a child their own number for study help. They will be able to use study help only — never fees, receipts or payments, and they cannot buy a pass.",
    "",
  ];
  opts.children.forEach((c, i) => {
    const state = c.linkedMobile10
      ? `linked to ${c.linkedMobile10.slice(0, 5)} ${c.linkedMobile10.slice(5)}`
      : "not linked";
    lines.push(`${i + 1}. *${c.name}* (${c.classLabel}) — ${state}`);
  });
  lines.push("");
  lines.push("To link, reply like this:");
  lines.push("*LINK 1 9876543210*");
  lines.push("");
  lines.push("To remove one: *UNLINK 1*");
  return lines.join("\n");
}

export function composeLinkCodeText(opts: {
  code: string;
  childName: string;
  mobile10: string;
}): string {
  return [
    `*Code for ${opts.childName}: ${opts.code}*`,
    "",
    `Give this code to ${opts.childName}. From their own phone (${opts.mobile10.slice(0, 5)} ${opts.mobile10.slice(5)}) they should message this school number and send just:`,
    "",
    opts.code,
    "",
    "The code lasts 24 hours and works once. You can remove the link any time with *UNLINK*.",
  ].join("\n");
}

export function composeStudentWelcome(opts: {
  studentName: string;
  classLabel: string;
}): string {
  return [
    `Welcome, *${opts.studentName}* 👋`,
    "",
    `This is study help for Class ${opts.classLabel}.`,
    "",
    "• *HINT* — a nudge, free",
    "• *TEACH* a topic · *EXAMPLES* · *PRACTICE*",
    "• *SCORE* — check your answer · *HOMEWORK* · *EXAM*",
    "",
    "Just type your question any time.",
    "",
    "Fees and school messages stay with your parent's number.",
  ].join("\n");
}

/**
 * The refusal a student sees.
 *
 * It names the parent's number as the place that can do it, so the child is
 * pointed somewhere real rather than simply blocked. Money is separated
 * from family data because they are different conversations to have at
 * home.
 */
export function composeStudentRefusal(
  reason: "money" | "family_data" | "unknown",
): string {
  if (reason === "money") {
    return [
      "Study passes are bought by a parent, not from here.",
      "",
      "Ask a parent to reply *PASS* on their own WhatsApp — the one the school messages about fees.",
    ].join("\n");
  }
  return [
    "This number is for study help only.",
    "",
    "Fees, receipts and school messages are on your parent's WhatsApp. Ask them to check there.",
  ].join("\n");
}

/** A code has to be used once, before it expires, or not at all. */
export function linkCodeUsable(opts: {
  expiresAt: string;
  usedAt?: string | null;
  now?: Date;
}): { ok: boolean; reason?: string } {
  if (opts.usedAt) {
    return { ok: false, reason: "That code has already been used. Ask your parent for a new one." };
  }
  const exp = Date.parse(opts.expiresAt || "");
  if (!Number.isFinite(exp)) {
    return { ok: false, reason: "That code is not valid. Ask your parent for a new one." };
  }
  if ((opts.now?.getTime() ?? Date.now()) > exp) {
    return { ok: false, reason: "That code has expired. Ask your parent for a new one." };
  }
  return { ok: true };
}
