/**
 * ERP command desk — the director's daily digest.
 *
 * Reads the day's `erp_commands` audit rows (every command from every
 * channel lands there with its outcome), composes one WhatsApp-sized
 * report, and sends it to every active owner-designated staff member:
 * free text on WhatsApp when their 24-hour window is open, an approved
 * template with a one-line summary when it is not and one is configured,
 * and a phone push alongside either way. Idempotent per IST date via the
 * command store, so an hourly tick is safe.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { inferStaffIsOwner } from "@/lib/waRoleResolver";
import { sendWaWithFailover, buildWaTemplateBodyComponent } from "@/lib/waSend";
import { sendPushToSubject } from "@/lib/webPush.server";
import {
  formatCommandDigest,
  formatCommandDigestOneLine,
  summarizeCommandAudit,
  type CommandAuditRow,
  type CommandDigestStats,
} from "@/lib/erpCommands";
import { markCommandDigestSent, readCommandDeskState } from "@/lib/erpCommands.server";

const IST_OFFSET_MIN = 330;

/** [start, end) in UTC for one IST calendar date. */
export function istDayBoundsUtc(date: string): { sinceIso: string; untilIso: string } {
  const startUtcMs = Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MIN * 60_000;
  return {
    sinceIso: new Date(startUtcMs).toISOString(),
    untilIso: new Date(startUtcMs + 24 * 60 * 60_000).toISOString(),
  };
}

export async function readCommandAuditRows(opts: {
  sinceIso: string;
  untilIso: string;
}): Promise<CommandAuditRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("audit_events")
    .select("actor_name, actor_email, action, entity_id, summary, after_state, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module", "erp_commands")
    .gte("created_at", opts.sinceIso)
    .lt("created_at", opts.untilIso)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) {
    console.warn("[erpCommandsDigest] audit read failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    actorName: String(r.actor_name ?? ""),
    actorEmail: (r.actor_email as string | null) ?? null,
    action: String(r.action ?? ""),
    entityId: String(r.entity_id ?? ""),
    summary: String(r.summary ?? ""),
    after:
      r.after_state && typeof r.after_state === "object"
        ? (r.after_state as Record<string, unknown>)
        : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

export async function composeCommandDigestForDate(
  date: string,
): Promise<{ text: string; oneLine: string; stats: CommandDigestStats }> {
  const [rows, state] = await Promise.all([
    readCommandAuditRows(istDayBoundsUtc(date)),
    readCommandDeskState(),
  ]);
  const stats = summarizeCommandAudit(rows);
  return {
    text: formatCommandDigest(stats, { date, paused: state.paused, pausedBy: state.pausedBy }),
    oneLine: formatCommandDigestOneLine(stats, date),
    stats,
  };
}

export type CommandDigestRunResult = {
  date: string;
  skipped?: string;
  total: number;
  recipients: { name: string; mobile: string; wa: string; push: number }[];
  text: string;
};

/**
 * Send today's digest to the owners once. `dryRun` composes and lists the
 * recipients without sending or marking; `force` re-sends on a date that
 * already went out.
 */
export async function runCommandDigest(opts: {
  date: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<CommandDigestRunResult> {
  const state = await readCommandDeskState();
  if (state.digestSentFor === opts.date && !opts.force && !opts.dryRun) {
    return { date: opts.date, skipped: "already sent today", total: 0, recipients: [], text: "" };
  }
  const digest = await composeCommandDigestForDate(opts.date);
  if (digest.stats.total === 0 && !opts.force) {
    // Nothing to report — and nothing marked, so a later tick still sends
    // if the desk is used after this one.
    return { date: opts.date, skipped: "no commands today", total: 0, recipients: [], text: digest.text };
  }

  const masters = await loadServerMasters();
  const designations = masters.designations ?? [];
  const owners = (masters.staff ?? []).filter(
    (s) => s.status === "active" && inferStaffIsOwner(s, designations),
  );
  const templateName = (process.env.ERP_COMMANDS_DIGEST_TEMPLATE || "").trim();
  const templateLang = (process.env.ERP_COMMANDS_DIGEST_TEMPLATE_LANG || "en").trim();

  const recipients: CommandDigestRunResult["recipients"] = [];
  for (const s of owners) {
    const mobile = (s.mobile || "").trim();
    let wa = "skipped";
    let push = 0;
    if (!opts.dryRun) {
      if (mobile) {
        const r = await sendWaWithFailover({
          primaryMobile: mobile,
          body: digest.text,
          clientMessageId: `cmd_digest_${opts.date}_${s.id}`,
        });
        if (r.ok) wa = "text";
        else if (templateName && /24h|window/i.test(r.error || "")) {
          const t = await sendWaWithFailover({
            primaryMobile: mobile,
            template: {
              name: templateName,
              language: templateLang,
              components: [
                buildWaTemplateBodyComponent(["summary"], { summary: digest.oneLine }),
              ],
            },
            clientMessageId: `cmd_digest_${opts.date}_${s.id}_t`,
          });
          wa = t.ok ? "template" : `failed: ${t.error || "template send failed"}`;
        } else {
          wa = `failed: ${r.error || "send failed"}`;
        }
      } else {
        wa = "no mobile";
      }
      const p = await sendPushToSubject("staff", s.id, {
        title: "ERP commands today",
        body: digest.oneLine,
        url: "/",
        data: { kind: "erp_commands_digest" },
      }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
      push = p.sent;
    } else {
      wa = mobile ? "dry run" : "no mobile";
    }
    recipients.push({ name: s.fullName, mobile: mobile ? `${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)}` : "", wa, push });
  }

  if (!opts.dryRun) await markCommandDigestSent(opts.date);
  return { date: opts.date, total: digest.stats.total, recipients, text: digest.text };
}
