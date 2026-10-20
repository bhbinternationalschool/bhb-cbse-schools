/**
 * notify(event) — the one way anything in the ERP tells people that
 * something happened (director, 15 Oct 2026). Every event:
 *
 *   1. resolves its audience on the server (./audience.ts) from roles,
 *      grants and relationships — never from the client, never "everyone";
 *   2. is stored once per recipient by erp_notify_deliver (dedupe key per
 *      event; bursts with a group key fold into one unread row), which moves
 *      erp_versions "erp_notifications" — the ERP bell's versions poll shows
 *      it within ~20 s;
 *   3. goes to each recipient's phones (FCM, and browsers subscribed to Web
 *      Push) with the topic's spoken line, unless that person muted the
 *      topic, it is their quiet hours (9 pm – 7 am by default), the event was
 *      a duplicate, or it folded into a burst that already rang
 *      (./policy.ts). Urgent kinds ignore mute and quiet hours.
 *
 * Never throws and never blocks the action that raised it: an audience that
 * cannot be resolved (the roster or roles could not be read) or a failed
 * store is logged and returned as ok:false — nothing is guessed (R6).
 *
 * Dependencies are injected (./notifyDeps.server.ts has the real ones) so
 * the self-test drives it without a database or Firebase.
 */
import { resolveAudience, type AudienceContext, type AudienceRule } from "./audience";
import {
  DEFAULT_PREFS,
  NOTIFY_KINDS,
  recipientKey,
  type NotifyKind,
  type NotifyPrefs,
  type NotifyTopic,
  type Recipient,
} from "./kinds";
import { decidePush, type DeliverOutcome } from "./policy";

export type Text = { en: string; hi?: string };

export type NotifyEvent = {
  kind: NotifyKind;
  /** Stable id of this event, e.g. `staff_leave:<id>:requested`. The same key twice = stored once. */
  key: string;
  audience: readonly AudienceRule[];
  /** Never notify these (the person who did it). */
  exclude?: readonly Recipient[];
  title: Text;
  body?: Text;
  /** In-app route for the phone, e.g. "/leave-approvals". */
  link: string;
  /** The ERP page, e.g. "/staff?tab=leave". Defaults to `link`. */
  webLink?: string;
  /** String data forwarded to the app with the push. */
  data?: Record<string, string>;
  /** Display only: who did it. */
  actor?: string;
  /** Overrides the kind's default. */
  urgent?: boolean;
  /**
   * Fold a burst into one unread row per recipient (e.g. thirty receipts →
   * "30 fees received"). `title` may hold `{n}`, replaced by the count.
   */
  group?: { key: string; windowMinutes?: number; title: Text };
};

export type DeliverRow = {
  recipient_type: Recipient["type"];
  recipient_id: string;
  kind: string;
  topic: string;
  dedupe_key: string;
  title: string;
  body: string;
  title_hi: string;
  body_hi: string;
  link: string;
  web_link: string;
  payload: Record<string, string>;
  urgent: boolean;
  actor: string;
  group_key?: string;
  group_window_minutes?: number;
  group_title?: string;
  group_title_hi?: string;
};

export type DeliverResult = { recipient_type: Recipient["type"]; recipient_id: string; id: string; outcome: DeliverOutcome };

export type PushMessage = {
  topic: NotifyTopic;
  /** false = the phone's normal sound (the person turned voice off). */
  voice: boolean;
  title: Text;
  body: Text;
  url: string;
  data: Record<string, string>;
};

export type NotifyDeps = {
  /** The server's Masters (with roster) and roles; null = could not be read. */
  audienceContext: () => Promise<AudienceContext | null>;
  deliver: (rows: DeliverRow[]) => Promise<{ ok: true; results: DeliverResult[] } | { ok: false; error: string }>;
  /** Saved settings by recipientKey; a person with none is absent. null = could not be read. */
  prefsFor: (recipients: Recipient[]) => Promise<Map<string, NotifyPrefs> | null>;
  push: (to: Recipient, msg: PushMessage) => Promise<{ sent: number }>;
  now: () => number;
  log: (msg: string) => void;
};

export type NotifyResult =
  | {
      ok: true;
      recipients: number;
      inserted: number;
      grouped: number;
      duplicate: number;
      pushed: number;
      held: { muted: number; quiet: number };
    }
  | { ok: false; error: string };

const MAX_TITLE = 160;
const PUSH_BATCH = 8;
const MAX_BODY = 400;

function clip(s: string | undefined, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The rows erp_notify_deliver stores for an event's resolved audience. */
export function deliverRows(ev: NotifyEvent, recipients: readonly Recipient[]): DeliverRow[] {
  const def = NOTIFY_KINDS[ev.kind];
  const urgent = ev.urgent ?? def.urgent;
  return recipients.map((r) => ({
    recipient_type: r.type,
    recipient_id: r.id,
    kind: ev.kind,
    topic: def.topic,
    dedupe_key: ev.key,
    title: clip(ev.title.en, MAX_TITLE),
    body: clip(ev.body?.en, MAX_BODY),
    title_hi: clip(ev.title.hi, MAX_TITLE),
    body_hi: clip(ev.body?.hi, MAX_BODY),
    link: ev.link,
    web_link: ev.webLink ?? ev.link,
    payload: { ...(ev.data ?? {}) },
    urgent,
    actor: clip(ev.actor, 120),
    ...(ev.group
      ? {
          group_key: ev.group.key,
          group_window_minutes: ev.group.windowMinutes ?? 180,
          group_title: clip(ev.group.title.en, MAX_TITLE),
          group_title_hi: clip(ev.group.title.hi, MAX_TITLE),
        }
      : {}),
  }));
}

export async function notifyWith(deps: NotifyDeps, ev: NotifyEvent): Promise<NotifyResult> {
  const tag = `[notify] ${ev.kind} ${ev.key}`;
  try {
    if (!ev.key.trim() || !ev.title.en.trim()) return { ok: false, error: "an event needs a key and a title" };
    const ctx = await deps.audienceContext();
    if (!ctx) {
      deps.log(`${tag}: the roster or roles could not be read — nobody notified`);
      return { ok: false, error: "audience unknown" };
    }
    const recipients = resolveAudience(ev.audience, ctx, ev.exclude ?? []);
    const zero = { ok: true as const, recipients: 0, inserted: 0, grouped: 0, duplicate: 0, pushed: 0, held: { muted: 0, quiet: 0 } };
    if (recipients.length === 0) return zero;

    const stored = await deps.deliver(deliverRows(ev, recipients));
    if (!stored.ok) {
      deps.log(`${tag}: not stored — ${stored.error}`);
      return { ok: false, error: stored.error };
    }
    const out = { ...zero, recipients: recipients.length, held: { muted: 0, quiet: 0 } };
    for (const r of stored.results) {
      if (r.outcome === "inserted") out.inserted += 1;
      else if (r.outcome === "grouped") out.grouped += 1;
      else out.duplicate += 1;
    }

    const fresh = stored.results.filter((r) => r.outcome === "inserted");
    if (fresh.length === 0) return out;
    const freshRecipients = fresh.map((r) => ({ type: r.recipient_type, id: r.recipient_id }));
    const prefs = await deps.prefsFor(freshRecipients);
    if (!prefs) deps.log(`${tag}: settings could not be read — the defaults apply`);

    const def = NOTIFY_KINDS[ev.kind];
    const urgent = ev.urgent ?? def.urgent;
    const nowMs = deps.now();
    const msgBase = {
      topic: def.topic,
      title: { en: clip(ev.title.en, MAX_TITLE), hi: ev.title.hi ? clip(ev.title.hi, MAX_TITLE) : undefined },
      body: { en: clip(ev.body?.en, 200), hi: ev.body?.hi ? clip(ev.body.hi, 200) : undefined },
      url: ev.link,
    };
    // Phones in small parallel batches: a notice to every family is ~1,000.
    const plans: { to: Recipient; voice: boolean; id: string }[] = [];
    for (const r of fresh) {
      const to: Recipient = { type: r.recipient_type, id: r.recipient_id };
      const p = prefs?.get(recipientKey(to)) ?? DEFAULT_PREFS;
      const d = decidePush({ outcome: r.outcome, topic: def.topic, urgent, prefs: p, nowMs });
      if (d.push) plans.push({ to, voice: d.voice, id: r.id });
      else if (d.reason === "muted") out.held.muted += 1;
      else if (d.reason === "quiet") out.held.quiet += 1;
    }
    for (let i = 0; i < plans.length; i += PUSH_BATCH) {
      const sent = await Promise.all(
        plans.slice(i, i + PUSH_BATCH).map(async (pl) => {
          try {
            const res = await deps.push(pl.to, {
              ...msgBase,
              voice: pl.voice,
              data: { ...(ev.data ?? {}), kind: ev.kind, topic: def.topic, notificationId: pl.id },
            });
            return res.sent;
          } catch (e) {
            deps.log(`${tag}: push to ${recipientKey(pl.to)} failed — ${(e as Error)?.message ?? e}`);
            return 0;
          }
        }),
      );
      out.pushed += sent.reduce((a, b) => a + b, 0);
    }
    return out;
  } catch (e) {
    deps.log(`${tag}: ${(e as Error)?.message ?? e}`);
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
