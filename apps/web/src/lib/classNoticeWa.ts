/**
 * A teacher's class notice on its way to parents — pure.
 *
 * WhatsApp delivers free text only to a number that wrote to the school in
 * the last 24 hours (19 of 179 on 30 Sep 2026). Everything else must be an
 * approved template, so a teacher's notice goes inside the approved
 * "School notice broadcast" template (bhb_school_notice), in each family's
 * language, with the teacher's own words as the notice. The director's
 * brief, 30 Sep 2026: parent WhatsApp groups can go only once a teacher's
 * message reaches every family through the school number.
 *
 * Meta refuses a template parameter holding a new line, a tab or more than
 * four spaces in a row — one such notice failed for every family — so the
 * words are joined into one line here first.
 */

import { formatIstWhen } from "@/lib/waTemplateAutopilot";

/** Meta's limit for one body parameter; kept under it with room to spare. */
export const TEMPLATE_PARAM_MAX = 1000;

/**
 * One line Meta will accept as a template parameter: line breaks become
 * " · ", runs of spaces become one, and it is cut to TEMPLATE_PARAM_MAX.
 */
export function flattenTemplateParam(text: string, max = TEMPLATE_PARAM_MAX): string {
  const lines = (text || "")
    .replace(/\t/g, " ")
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let out = lines
    .map((l, i) => (i < lines.length - 1 && !/[.!?।:;·,]$/.test(l) ? `${l} ·` : l))
    .join(" ")
    .trim();
  if (out.length > max) out = `${out.slice(0, max - 1).trimEnd()}…`;
  return out;
}

/**
 * Blanks left to fill in: "kal bachchon ko ........ sath me lana hai",
 * "____", "…………". A single "…" at the end of a sentence is only style.
 */
export function hasUnfilledBlank(text: string): boolean {
  const t = text || "";
  return (
    /(?:\.\s?){4,}/.test(t) ||
    /…\s*…/.test(t) ||
    /…\s*\.{2,}|\.{2,}\s*…/.test(t) ||
    /_{3,}/.test(t) ||
    /(?:^|\s)-{4,}(?:\s|$)/.test(t) ||
    /\[\s*(?:date|time|name|item|x+)\s*\]/i.test(t)
  );
}

export function composeFillBlanksReply(text: string): string {
  const shown = text.length > 200 ? `${text.slice(0, 197)}…` : text;
  return [
    "✏️ This message still has blanks (……) to fill in:",
    "",
    `_${shown}_`,
    "",
    "Please send it again with the blanks filled in — parents will read it exactly as you write it. Nothing was sent.",
  ].join("\n");
}

/** What the teacher reads before YES: the parents' message, exactly. */
export function composeNoticeParentPreview(opts: {
  kindLabel: string;
  classLabel: string;
  rendered: string;
  families: number;
  languages: string;
  /** Languages whose template WhatsApp has not approved yet. */
  waiting?: { lang: string; families: number }[];
}): string {
  const waiting = (opts.waiting ?? []).filter((w) => w.families > 0);
  return [
    `Draft · ${opts.kindLabel} · ${opts.classLabel}`,
    "",
    `*Parents will receive:*`,
    "━━━━━━━━━━━━",
    opts.rendered,
    "━━━━━━━━━━━━",
    "",
    opts.families
      ? `To *${opts.families}* ${opts.families === 1 ? "family" : "families"} of ${opts.classLabel}${opts.languages ? ` (${opts.languages})` : ""}, as the school's approved notice — it reaches every family, not only those who wrote in today.`
      : `⚠️ No parent WhatsApp numbers are on record for ${opts.classLabel}. It will be saved in the ERP only.`,
    ...(waiting.length && opts.families
      ? [
          "",
          `⏳ WhatsApp has not approved the ${waiting.map((w) => w.lang).join(" and ")} notice yet, so ${waiting.map((w) => `${w.families} ${w.lang}`).join(" and ")} ${waiting.reduce((n, w) => n + w.families, 0) === 1 ? "family" : "families"} will get it automatically the moment it is approved — nothing for you to do.`,
        ]
      : []),
    "",
    "Reply *YES* to send, or *NO* to cancel.",
  ].join("\n");
}

/** The teacher's receipt after YES: what really happened, family by family. */
export function composeNoticeSentReceipt(opts: {
  classLabel: string;
  families: number;
  sent: number;
  failed: number;
  optedOut: number;
  /** "template" = every family; "text" = only those who wrote in within 24 h. */
  mode: "template" | "text" | "none";
  erpLine: string;
  /** Families held for their language's template, and until when. */
  held?: number;
  heldUntil?: string;
}): string {
  const lines: string[] = [];
  const held = opts.held ?? 0;
  if (opts.mode === "none") {
    lines.push(`No parent WhatsApp numbers on record for ${opts.classLabel}, so no family was messaged.`);
  } else if (held) {
    const bits = [`${opts.sent ? "✅" : "⏳"} Sent to ${opts.sent} of ${opts.families} ${opts.families === 1 ? "family" : "families"} of ${opts.classLabel}`];
    if (opts.failed) bits.push(`${opts.failed} failed`);
    if (opts.optedOut) bits.push(`${opts.optedOut} opted out`);
    lines.push(`${bits.join(" · ")}.`);
    lines.push(
      `⏳ ${held} more will get it *automatically* the moment WhatsApp approves the notice template — nothing for you to do.${opts.heldUntil ? ` If it is not approved by ${formatIstWhen(opts.heldUntil)}, it is dropped and you'll be told.` : ""}`,
    );
  } else if (opts.mode === "text") {
    lines.push(
      `⚠️ The notice template is not approved yet, so this went as plain text: ${opts.sent} of ${opts.families} families got it (WhatsApp delivers plain text only to those who wrote to the school in the last 24 hours). Ask the office to approve *School notice broadcast* in Masters → WhatsApp templates.`,
    );
  } else {
    const bits = [`✅ Sent to ${opts.sent} of ${opts.families} ${opts.families === 1 ? "family" : "families"} of ${opts.classLabel}`];
    if (opts.failed) bits.push(`${opts.failed} failed`);
    if (opts.optedOut) bits.push(`${opts.optedOut} opted out`);
    lines.push(`${bits.join(" · ")}.`);
  }
  if (opts.erpLine) lines.push(opts.erpLine);
  lines.push("Parents' replies land in the ERP: Comms → WhatsApp inbox.");
  return lines.join("\n");
}
