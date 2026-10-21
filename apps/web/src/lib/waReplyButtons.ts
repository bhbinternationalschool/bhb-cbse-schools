/**
 * WhatsApp reply buttons on the dispatch route — the pure part.
 *
 * A job (the n8n staff room, a cron) may hand `POST /api/wa/dispatch` a
 * message with up to three `buttons: [{ id, title }]`. Meta renders them as
 * tappable reply buttons under the text; a tap comes back through the
 * webhook as an `interactive.button_reply` with the same `id` and `title`.
 *
 * Why the office approval buttons are shaped the way they are: the staff
 * room's poller reads `wa_messages` and matches the director's reply with
 * /^(approve|reject|…)…(\d+)/. The webhook logs a tap with the TITLE as its
 * body (what the director saw) and the ID in `button_id`; both must carry
 * the verb and the draft number so either column decides the draft.
 *
 * Meta's limits (Cloud API, interactive "button"): 1–3 buttons, title ≤ 20
 * characters, id ≤ 256 characters with no leading/trailing spaces, ids
 * unique within one message, body ≤ 1024, footer ≤ 60.
 *
 * See waReplyButtons.selftest.ts.
 */

export type WaDispatchButton = { id: string; title: string };

export const WA_REPLY_BUTTON_MAX = 3;
export const WA_REPLY_BUTTON_TITLE_MAX = 20;
export const WA_REPLY_BUTTON_ID_MAX = 256;
export const WA_INTERACTIVE_BODY_MAX = 1024;
export const WA_INTERACTIVE_FOOTER_MAX = 60;

/**
 * A stable id derived from a title when the caller gave none: a Latin slug
 * ("Approve 9" → "approve-9"), else — a Hindi label, an emoji — the title's
 * code points in hex, so two different labels never share an id and no
 * label ever yields the empty id Meta rejects.
 */
export function buttonIdFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug.slice(0, WA_REPLY_BUTTON_ID_MAX);
  const hex = Array.from(title.trim())
    .map((ch) => (ch.codePointAt(0) ?? 0).toString(16))
    .join("");
  return `b-${hex}`.slice(0, WA_REPLY_BUTTON_ID_MAX);
}

/**
 * The request's `buttons` as Meta will accept them, or the one reason it
 * cannot be sent. Nothing is silently trimmed: a title over 20 characters
 * is an error, not a cut — a cut title could lose the draft number the
 * poller needs.
 */
export function normalizeReplyButtons(
  raw: unknown,
): { ok: true; buttons: WaDispatchButton[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "buttons must be a non-empty array" };
  }
  if (raw.length > WA_REPLY_BUTTON_MAX) {
    return { ok: false, error: `Meta allows at most ${WA_REPLY_BUTTON_MAX} reply buttons per message` };
  }
  const buttons: WaDispatchButton[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const b = (item && typeof item === "object" ? item : {}) as { id?: unknown; title?: unknown };
    const title = String(b.title ?? "").trim();
    if (!title) return { ok: false, error: `buttons[${i}].title is required` };
    if (title.length > WA_REPLY_BUTTON_TITLE_MAX) {
      return {
        ok: false,
        error: `buttons[${i}].title "${title}" is ${title.length} characters; Meta allows ${WA_REPLY_BUTTON_TITLE_MAX}`,
      };
    }
    const id = String(b.id ?? "").trim() || buttonIdFromTitle(title);
    if (!id) return { ok: false, error: `buttons[${i}].id is required` };
    if (id.length > WA_REPLY_BUTTON_ID_MAX) {
      return { ok: false, error: `buttons[${i}].id is longer than ${WA_REPLY_BUTTON_ID_MAX} characters` };
    }
    if (seen.has(id)) return { ok: false, error: `buttons[${i}].id "${id}" repeats an earlier button` };
    seen.add(id);
    buttons.push({ id, title });
  }
  return { ok: true, buttons };
}

/** The exact Cloud API message for reply buttons — what goes to Meta. */
export function buildReplyButtonsMessage(opts: {
  to: string;
  body: string;
  footer?: string;
  buttons: WaDispatchButton[];
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: opts.body.slice(0, WA_INTERACTIVE_BODY_MAX) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, WA_INTERACTIVE_FOOTER_MAX) } } : {}),
      action: {
        buttons: opts.buttons.slice(0, WA_REPLY_BUTTON_MAX).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };
}

/**
 * The staff room's approval pair for draft `n`. Title "Approve 9" is what
 * the director reads and what the chat view keeps; id "approve-9" is what
 * the webhook stores in `button_id`. Both match the poller's regex.
 */
export function officeApprovalButtons(draftId: number | string): WaDispatchButton[] {
  const n = String(draftId).replace(/\D/g, "");
  return [
    { id: `approve-${n}`, title: `Approve ${n}` },
    { id: `reject-${n}`, title: `Reject ${n}` },
  ];
}

/**
 * Quick-reply payloads for a TEMPLATE send. A tap on a template's quick
 * reply arrives as a `button` message whose `payload` is what was passed
 * here (and whose `text` is the button's label), so the draft number rides
 * in the payload while the label stays "✅ Approve".
 */
export function buildTemplateQuickReplyComponents(payloads: string[]): {
  type: "button";
  sub_type: "quick_reply";
  index: string;
  parameters: { type: "payload"; payload: string }[];
}[] {
  return payloads
    .slice(0, WA_REPLY_BUTTON_MAX)
    .map((payload, index) => ({
      type: "button" as const,
      sub_type: "quick_reply" as const,
      index: String(index),
      parameters: [{ type: "payload" as const, payload: String(payload).slice(0, 128) }],
    }))
    .filter((c) => c.parameters[0].payload.length > 0);
}

/**
 * Whether a send failed because Meta's 24-hour customer-service window is
 * closed — the one failure a caller can mend by sending a template instead.
 */
export function isWindowClosedError(error: string | undefined): boolean {
  const e = String(error || "");
  return /24h session window|24-hour window|re-engagement message|#131047/i.test(e);
}
