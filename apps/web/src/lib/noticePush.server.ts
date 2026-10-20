import "server-only";

import type { SchoolNotice } from "@/lib/schoolComms";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * A phone notification when a notice is published (director, 13 Oct 2026).
 *
 * Called from every path that publishes: the ERP screen (via the comms desk
 * save), the 10-minute scheduled-publish job and WhatsApp class-channel
 * drafts. Each notice is pushed at most ONCE, whichever path gets there
 * first: the notice id is claimed in a log before anything is sent, so two
 * paths racing — or "Show again" on an archived notice — never notify twice.
 *
 * Who: staff for "staff", families for "parents", both for "all". "students"
 * notices are not in the apps' feed, so nobody is notified for them.
 * Tapping opens that notice (url /notices?notice=<id>).
 */

const LOG_KEY = "notice_push_log";
const KEEP = 500;

type PushLog = { version: 1; pushed: Record<string, string> };

/** Claim the notice for pushing. false = already pushed (or the log could not be read — unknown is not "new"). */
async function claimNotice(noticeId: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ctx.sb
      .from("module_local_state")
      .select("state, updated_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("module_key", LOG_KEY)
      .maybeSingle();
    if (error) return false;
    const log: PushLog = data?.state && typeof data.state === "object" ? { version: 1, pushed: { ...((data.state as PushLog).pushed || {}) } } : { version: 1, pushed: {} };
    if (log.pushed[noticeId]) return false;
    log.pushed[noticeId] = new Date().toISOString();
    const ids = Object.entries(log.pushed).sort((a, b) => b[1].localeCompare(a[1])).slice(0, KEEP);
    const next: PushLog = { version: 1, pushed: Object.fromEntries(ids) };
    const now = new Date().toISOString();
    if (data) {
      const r = await ctx.sb
        .from("module_local_state")
        .update({ state: next, updated_at: now })
        .eq("tenant_id", ctx.tenantId)
        .eq("module_key", LOG_KEY)
        .eq("updated_at", String(data.updated_at))
        .select("module_key");
      if (r.error) return false;
      if (r.data?.length) return true;
    } else {
      const r = await ctx.sb.from("module_local_state").insert({ tenant_id: ctx.tenantId, module_key: LOG_KEY, state: next, updated_at: now });
      if (!r.error) return true;
      if (!/duplicate|unique/i.test(r.error.message)) return false;
    }
  }
  return false;
}

async function recipients(audience: SchoolNotice["audience"]): Promise<{ staff: string[]; parents: string[] }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { staff: [], parents: [] };
  const wantStaff = audience === "all" || audience === "staff";
  const wantParents = audience === "all" || audience === "parents";
  const [staff, families] = await Promise.all([
    wantStaff ? ctx.sb.from("sis_staff").select("id").eq("tenant_id", ctx.tenantId).eq("status", "active") : Promise.resolve({ data: [] as { id: string }[] }),
    wantParents ? ctx.sb.from("sis_households").select("id").eq("tenant_id", ctx.tenantId) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  return {
    staff: ((staff.data ?? []) as { id: string }[]).map((r) => r.id),
    parents: ((families.data ?? []) as { id: string }[]).map((r) => r.id),
  };
}

export type NoticePushResult = { pushed: boolean; reason?: string; sent: number; failed: number };

export function noticePushPayload(n: Pick<SchoolNotice, "id" | "title" | "body">) {
  const body = n.body.replace(/\s+/g, " ").trim();
  return {
    title: `📢 ${n.title}`.slice(0, 120),
    body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
    url: `/notices?notice=${encodeURIComponent(n.id)}`,
    data: { kind: "notice", noticeId: n.id },
  };
}

/** Push a just-published notice to its audience's phones, once. Never throws. */
export async function pushPublishedNotice(n: SchoolNotice): Promise<NoticePushResult> {
  try {
    if (n.status !== "published") return { pushed: false, reason: "not published", sent: 0, failed: 0 };
    if (n.audience === "students") return { pushed: false, reason: "students notices are not in the apps", sent: 0, failed: 0 };
    // Only a notice published in the last day: the first save after this went
    // live must not ring every phone for every notice the school ever posted.
    const at = n.publishedAt ? Date.parse(n.publishedAt) : NaN;
    if (!Number.isFinite(at) || Date.now() - at > 24 * 3600 * 1000) return { pushed: false, reason: "published earlier", sent: 0, failed: 0 };
    if (!(await claimNotice(n.id))) return { pushed: false, reason: "already pushed", sent: 0, failed: 0 };
    const who = await recipients(n.audience);
    // The ERP bell + the apps (lib/notify): one row per person in the notice's
    // audience, chosen by the publisher; the push rings with the notice voice.
    const [{ notify }, { noticePublished }] = await Promise.all([
      import("@/lib/notify/notify.server"),
      import("@/lib/notify/events"),
    ]);
    const payload = noticePushPayload(n);
    const r = await notify(
      noticePublished({ noticeId: n.id, title: payload.title, body: payload.body, link: payload.url, staffIds: who.staff, householdIds: who.parents }),
    );
    return r.ok
      ? { pushed: true, sent: r.pushed, failed: 0 }
      : { pushed: false, reason: r.error, sent: 0, failed: who.staff.length + who.parents.length };
  } catch (e) {
    console.warn("[notice-push] failed:", e instanceof Error ? e.message : e);
    return { pushed: false, reason: "error", sent: 0, failed: 0 };
  }
}
