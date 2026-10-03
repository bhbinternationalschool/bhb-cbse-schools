/**
 * Meta's account-level WhatsApp alerts — pure rules.
 *
 * Four webhook fields the school's app subscribed to on 3 Oct 2026, each a
 * warning that used to reach nobody until it showed up on an invoice or as
 * messages that stopped going:
 *
 *   template_category_update     Meta moved a template to another category
 *                                (bhb_exam_tomorrow went UTILITY → MARKETING
 *                                and nobody knew for weeks), or is about to
 *   phone_number_quality_update  the number's messaging limit / throughput
 *                                changed
 *   account_alerts               limit increase refused, profile photo
 *                                removed, official-account decision
 *   account_update               restriction, violation, ban, deletion,
 *                                offboarding, pricing tier
 *
 * This file only turns a webhook body into notes for the director. Which
 * events deserve a note is decided here, so the selftest can pin it.
 */

export type WaMetaAccountAlert = {
  field: "template_category_update" | "phone_number_quality_update" | "account_alerts" | "account_update";
  /** Stable across Meta's re-deliveries of the same event — used to send once. */
  key: string;
  /** One-line summary for logs. */
  summary: string;
  /** The note for the director, or "" when the event is not worth one. */
  note: string;
  /** A template's category changed — the template registry should re-sync. */
  templateCategoryChanged?: boolean;
};

const FIELDS = new Set<WaMetaAccountAlert["field"]>([
  "template_category_update",
  "phone_number_quality_update",
  "account_alerts",
  "account_update",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** Deterministic JSON, so the same event always yields the same key. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Short non-cryptographic hash (FNV-1a) — a key, not a secret. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** "MARKETING" → "Marketing". */
function cat(c: string): string {
  const s = c.toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "?";
}

/** Unix seconds → "Sat 4 Oct" in IST. */
function istDay(unixSeconds: unknown): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000 + 330 * 60_000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

const TIERS: Record<string, string> = {
  TIER_50: "50 a day",
  TIER_250: "250 a day",
  TIER_1K: "1,000 a day",
  TIER_2K: "2,000 a day",
  TIER_10K: "10,000 a day",
  TIER_100K: "100,000 a day",
  TIER_UNLIMITED: "unlimited",
  TIER_NOT_SET: "not set yet",
  UNLIMITED: "unlimited",
};

function tier(t: string): string {
  return TIERS[t.toUpperCase()] ?? (/^\d+$/.test(t) ? `${Number(t).toLocaleString("en-IN")} a day` : t);
}

const HEAD = "⚠️ *WhatsApp account — Meta alert*";

function templateCategoryNote(v: Record<string, unknown>): { summary: string; note: string; changed: boolean } {
  const name = str(v.message_template_name) || "a template";
  const lang = str(v.message_template_language);
  const label = lang ? `${name} (${lang})` : name;
  const prev = str(v.previous_category);
  const now = str(v.new_category);
  const correct = str(v.correct_category);
  if (prev && now && prev.toUpperCase() !== now.toUpperCase()) {
    const dearer = now.toUpperCase() === "MARKETING";
    return {
      summary: `template ${label}: ${prev} → ${now}`,
      changed: true,
      note: [
        HEAD,
        "",
        `Meta has moved the template *${label}* from ${cat(prev)} to *${cat(now)}*.`,
        dearer
          ? "Every message sent with it is now billed at the marketing rate (about 7× a utility message). Reword it as a plain notice and submit it under a new name — an approved template's category cannot be changed back."
          : "Its messages are now billed at the new category's rate.",
      ].join("\n"),
    };
  }
  if (correct && now && correct.toUpperCase() !== now.toUpperCase()) {
    const when = istDay(v.category_update_timestamp);
    return {
      summary: `template ${label}: ${now} → ${correct} scheduled`,
      changed: false,
      note: [
        HEAD,
        "",
        `Meta will move the template *${label}* from ${cat(now)} to *${cat(correct)}*${when ? ` on ${when}` : " within 24 hours"}.`,
        correct.toUpperCase() === "MARKETING"
          ? "Messages sent with it will then cost the marketing rate. To keep it as utility, ask Meta for a category review in WhatsApp Manager before then, or submit a reworded copy under a new name."
          : "Nothing to do unless that category is wrong.",
      ].join("\n"),
    };
  }
  return { summary: `template ${label}: category unchanged`, changed: false, note: "" };
}

function qualityNote(v: Record<string, unknown>): { summary: string; note: string } {
  const event = str(v.event).toUpperCase();
  const number = str(v.display_phone_number);
  const limit = str(v.max_daily_conversations_per_business) || str(v.current_limit);
  const old = str(v.old_limit);
  const summary = `number ${number}: ${event} ${old ? `${old} → ` : ""}${limit}`;
  if (!event || event === "ONBOARDING") return { summary, note: "" };
  const down = /DOWNGRADE|FLAGGED/.test(event);
  const up = /UPGRADE|UNFLAGGED/.test(event);
  const lines = [HEAD, ""];
  if (down) {
    lines.push(
      `The school's WhatsApp number${number ? ` (${number})` : ""} has been *${event === "FLAGGED" ? "flagged for low quality" : "downgraded"}* by Meta.`,
    );
    if (limit) lines.push(`Messages to new people are now limited to *${tier(limit)}*${old ? ` (was ${tier(old)})` : ""}.`);
    lines.push("Usually caused by parents blocking or reporting messages. Pause any bulk sends and check Masters → WhatsApp templates for low-quality templates.");
  } else if (up) {
    lines.push(`Good news: Meta raised the school number's limit${limit ? ` to *${tier(limit)}*` : ""}.`);
  } else {
    lines.push(`Meta changed the school number's messaging limit (${event.toLowerCase()})${limit ? `: now ${tier(limit)}` : ""}.`);
  }
  return { summary, note: lines.join("\n") };
}

function accountAlertNote(v: Record<string, unknown>): { summary: string; note: string } {
  const info = (v.alert_info && typeof v.alert_info === "object" ? v.alert_info : {}) as Record<string, unknown>;
  const status = str(info.alert_status).toUpperCase();
  const type = str(info.alert_type);
  const severity = str(info.alert_severity).toUpperCase();
  const desc = str(info.alert_description);
  const summary = `alert ${type} ${severity} ${status}`;
  // Meta also reports an alert being resolved; only a live one needs a person.
  if (status && status !== "ACTIVE") return { summary, note: "" };
  return {
    summary,
    note: [HEAD, "", desc || type.replace(/_/g, " ").toLowerCase(), "", `(${[severity, type].filter(Boolean).join(" · ")})`].join("\n"),
  };
}

/** account_update events that need the director. Others are routine. */
const ACCOUNT_EVENTS: Record<string, string> = {
  ACCOUNT_DELETED: "The school's WhatsApp Business Account has been *deleted*. All WhatsApp sending has stopped.",
  ACCOUNT_RESTRICTION: "Meta has *restricted* the school's WhatsApp account.",
  ACCOUNT_VIOLATION: "Meta says the school's WhatsApp account *violated a policy*.",
  DISABLED_UPDATE: "Meta has changed the school WhatsApp account's *ban status*.",
  ACCOUNT_OFFBOARDED: "The school's WhatsApp account was *disconnected* (device change or number re-registration). Sending will stop until it is reconnected.",
  ACCOUNT_RECONNECTED: "The school's WhatsApp account has been *reconnected*.",
  PARTNER_REMOVED: "The school's WhatsApp account was *unshared* from an app or partner.",
  PARTNER_APP_UNINSTALLED: "An app's access to the school's WhatsApp account was *removed*. If it was the ERP's, messages will stop.",
  VOLUME_BASED_PRICING_TIER_UPDATE: "Meta changed the school's WhatsApp *volume pricing tier*.",
};

function accountUpdateNote(v: Record<string, unknown>): { summary: string; note: string } {
  const event = str(v.event).toUpperCase();
  const summary = `account ${event}`;
  const lead = ACCOUNT_EVENTS[event];
  if (!lead) return { summary, note: "" };
  const lines = [HEAD, "", lead];
  const violation = (v.violation_info && typeof v.violation_info === "object" ? v.violation_info : null) as Record<string, unknown> | null;
  if (violation && str(violation.violation_type)) lines.push(`Reason given: ${str(violation.violation_type).replace(/_/g, " ").toLowerCase()}.`);
  const ban = (v.ban_info && typeof v.ban_info === "object" ? v.ban_info : null) as Record<string, unknown> | null;
  if (ban && str(ban.waba_ban_state)) {
    lines.push(`Ban state: ${str(ban.waba_ban_state).toLowerCase()}${str(ban.waba_ban_date) ? ` (${str(ban.waba_ban_date)})` : ""}.`);
  }
  if (Array.isArray(v.restriction_info)) {
    for (const r of v.restriction_info as Record<string, unknown>[]) {
      const t = str(r?.restriction_type).replace(/^RESTRICTED_/, "").replace(/_/g, " ").toLowerCase();
      const until = istDay(r?.expiration);
      if (t) lines.push(`• ${t}${until ? ` until ${until}` : ""}`);
    }
  }
  const tierInfo = (v.volume_tier_info && typeof v.volume_tier_info === "object" ? v.volume_tier_info : null) as Record<string, unknown> | null;
  if (tierInfo) {
    lines.push(
      [str(tierInfo.pricing_category), str(tierInfo.tier) && `tier ${str(tierInfo.tier)}`, str(tierInfo.effective_month) && `from ${str(tierInfo.effective_month)}`]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (/RESTRICTION|VIOLATION|DISABLED|DELETED/.test(event)) {
    lines.push("", "Check WhatsApp Manager → Account quality (business.facebook.com) for details and the appeal option.");
  }
  return { summary, note: lines.join("\n") };
}

/** Every account-level alert in a webhook body, in order. */
export function parseMetaAccountAlerts(body: unknown): WaMetaAccountAlert[] {
  const out: WaMetaAccountAlert[] = [];
  if (!body || typeof body !== "object") return out;
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries as Record<string, unknown>[]) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes as Record<string, unknown>[]) {
      const field = str(ch?.field) as WaMetaAccountAlert["field"];
      if (!FIELDS.has(field)) continue;
      const value = (ch.value && typeof ch.value === "object" ? ch.value : {}) as Record<string, unknown>;
      const key = `wa-meta:${field}:${str(entry.id)}:${str(entry.time)}:${hash(stableJson(value))}`;
      if (field === "template_category_update") {
        const r = templateCategoryNote(value);
        out.push({ field, key, summary: r.summary, note: r.note, templateCategoryChanged: r.changed });
      } else if (field === "phone_number_quality_update") {
        out.push({ field, key, ...qualityNote(value) });
      } else if (field === "account_alerts") {
        out.push({ field, key, ...accountAlertNote(value) });
      } else {
        out.push({ field, key, ...accountUpdateNote(value) });
      }
    }
  }
  return out;
}
