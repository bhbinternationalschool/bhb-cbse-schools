import { getServerTenantContext } from "@/lib/serverTenant";
import { listWaHubThreads } from "@/lib/waChatHub.server";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import { bestStatus, mergeTimeline, renderTemplate, templateLabel, type TimelineMsg } from "@/lib/waTimeline";

/**
 * Everything the school and one number said to each other on WhatsApp, from
 * every store that holds a piece of it (see lib/waTimeline). Each read is
 * best effort: a store that cannot be read leaves its messages out and is
 * named in `gaps`, so the screen can say the view is partial rather than
 * pretend the conversation was shorter.
 */

const last10 = (raw: string) => String(raw ?? "").replace(/\D/g, "").slice(-10);

const blank = (over: Partial<TimelineMsg> & Pick<TimelineMsg, "id" | "direction" | "at" | "source">): TimelineMsg => ({
  text: "",
  label: "",
  kind: "text",
  waMessageId: "",
  status: "",
  replyToText: "",
  replyToWaMessageId: "",
  error: "",
  ...over,
});

const PURPOSE_LABEL: Record<string, string> = {
  fees: "Fees",
  fees_receipt: "Fee receipt",
  fees_soft_reminder: "Fees",
  fee_receipt: "Fee receipt",
  pay_link: "Fees",
  payment_proof_ack: "Fees",
  exam_eve: "Exams",
  homework_published: "Homework",
  homework: "Homework",
  parent_chat_close: "Bot",
  parent_bot_guide: "Bot",
  tutor_guide: "AI tutor",
  transport_pin_request: "Transport",
  transport: "Transport",
  daily_brief: "Daily brief",
  udise_nudge: "UDISE / APAAR",
  udise_doc_ack: "UDISE / APAAR",
  apaar_consent_ask: "UDISE / APAAR",
  apaar_parent_id_ask: "UDISE / APAAR",
  admissions: "Admissions",
  notice: "Notice",
  broadcast: "Notice",
  health: "Health",
  visitors: "Visitors",
  attendance: "Attendance",
};

function purposeLabel(purpose: string, template: string): string {
  const p = (purpose || "").toLowerCase();
  if (PURPOSE_LABEL[p]) return PURPOSE_LABEL[p]!;
  if (template) return templateLabel(template);
  return p ? p.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Automation";
}

/**
 * The automation log often kept only "Template: name" (its variables were
 * never stored). Show the template's own words with the blanks marked, so
 * the office reads what kind of message went, not a code name.
 */
function automationText(preview: string, template: string, bodies: Map<string, { body: string; vars: string[] }>): string {
  const bare = !preview || /^template:\s*/i.test(preview);
  const name = template || preview.replace(/^template:\s*/i, "").trim();
  const known = bodies.get(name);
  if (bare && known) return renderTemplate(known.body, [], known.vars);
  return preview || name;
}

export type WaTimelineResult = {
  mobile10: string;
  displayName: string;
  messages: TimelineMsg[];
  /** Stores that could not be read this time. */
  gaps: string[];
};

export async function buildWaTimeline(mobileRaw: string, opts?: { days?: number }): Promise<WaTimelineResult> {
  const mobile10 = last10(mobileRaw);
  const days = Math.min(Math.max(opts?.days ?? 60, 1), 400);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const gaps: string[] = [];
  const lists: TimelineMsg[][] = [];
  let displayName = "";

  const ctx = await getServerTenantContext();
  if (!ctx) return { mobile10, displayName, messages: [], gaps: ["database"] };
  const { sb, tenantId } = ctx;
  const e164 = `91${mobile10}`;

  // Template bodies, so an automation shows the words the family read.
  const bodies = new Map<string, { body: string; vars: string[] }>();
  try {
    const t = await loadWaTemplatesServer();
    for (const tpl of t.templates) if (tpl.metaName && tpl.body) bodies.set(tpl.metaName, { body: tpl.body, vars: Array.isArray(tpl.variables) ? tpl.variables : [] });
  } catch {
    gaps.push("templates");
  }

  const [logRes, hmlRes, relayRes] = await Promise.all([
    sb
      .from("wa_messages")
      .select("id, direction, kind, body, template_name, template_params, wa_message_id, reply_to_wa_message_id, ok, error, created_at")
      .eq("tenant_id", tenantId)
      .eq("mobile10", mobile10)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    sb
      .from("household_message_log")
      .select("id, channel, direction, purpose, via, template_name, preview, status, error, wa_message_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("mobile_e164", e164)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    sb
      .from("wa_relay_messages")
      .select("id, code, inbound_text, media_note, inbound_wa_message_id, sender_name, created_at")
      .eq("tenant_id", tenantId)
      .eq("sender_mobile10", mobile10)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  if (logRes.error) gaps.push("message log");
  else
    lists.push(
      (logRes.data ?? []).map((r) => {
        const tpl = String(r.template_name ?? "");
        const params = Array.isArray(r.template_params) ? (r.template_params as unknown[]).map(String) : [];
        const body = String(r.body ?? "");
        const known = bodies.get(tpl);
        const text = tpl ? (known ? renderTemplate(known.body, params, known.vars) : body || `${tpl}: ${params.join(" · ")}`) : body;
        return blank({
          id: `log-${r.id}`,
          source: "log",
          direction: r.direction === "in" ? "in" : "out",
          at: String(r.created_at),
          text,
          kind: String(r.kind ?? "text"),
          label: r.direction === "in" ? "" : tpl ? templateLabel(tpl) : "School",
          waMessageId: String(r.wa_message_id ?? ""),
          replyToWaMessageId: String(r.reply_to_wa_message_id ?? ""),
          status: r.ok === false ? "failed" : "",
          error: String(r.error ?? ""),
        });
      }),
    );

  if (hmlRes.error) gaps.push("automation log");
  else
    lists.push(
      (hmlRes.data ?? [])
        .filter((r) => !r.channel || String(r.channel).toLowerCase().includes("wa") || String(r.channel).toLowerCase().includes("whatsapp"))
        .map((r) =>
          blank({
            id: `hml-${r.id}`,
            source: "automation",
            direction: r.direction === "in" || r.direction === "inbound" ? "in" : "out",
            at: String(r.created_at),
            text: automationText(String(r.preview ?? ""), String(r.template_name ?? ""), bodies),
            kind: r.template_name ? "template" : "text",
            label: purposeLabel(String(r.purpose ?? ""), String(r.template_name ?? "")),
            waMessageId: String(r.wa_message_id ?? ""),
            status: r.status === "failed" ? "failed" : "",
            error: String(r.error ?? ""),
          }),
        ),
    );

  if (relayRes.error) gaps.push("office relay");
  else {
    const relays = relayRes.data ?? [];
    lists.push(
      relays.map((r) =>
        blank({
          id: `relay-${r.id}`,
          source: "relay",
          direction: "in",
          at: String(r.created_at),
          text: String(r.inbound_text ?? "") || String(r.media_note ?? ""),
          label: `Sent to office #${r.code}`,
          waMessageId: String(r.inbound_wa_message_id ?? ""),
        }),
      ),
    );
    if (!displayName) displayName = String(relays[0]?.sender_name ?? "");
    const ids = relays.map((r) => r.id);
    if (ids.length) {
      const rep = await sb
        .from("wa_relay_replies")
        .select("id, office_name, body, delivered_wa_message_id, status, error, created_at")
        .eq("tenant_id", tenantId)
        .in("relay_id", ids);
      if (rep.error) gaps.push("office replies");
      else
        lists.push(
          (rep.data ?? []).map((r) =>
            blank({
              id: `reply-${r.id}`,
              source: "relay",
              direction: "out",
              at: String(r.created_at),
              text: String(r.body ?? ""),
              label: r.office_name ? `Office · ${r.office_name}` : "Office",
              waMessageId: String(r.delivered_wa_message_id ?? ""),
              status: r.status === "failed" ? "failed" : "",
              error: String(r.error ?? ""),
            }),
          ),
        );
    }
  }

  // The bot and staff threads (parent, admissions, survey, hub…).
  try {
    const { threads } = await listWaHubThreads({ category: "all", limit: 5000 });
    const mine = threads.filter((t) => last10(t.mobile) === mobile10);
    for (const t of mine) {
      if (!displayName && t.displayName) displayName = t.displayName;
      lists.push(
        t.messages
          .filter((m) => m.at >= since)
          .map((m) =>
            blank({
              id: `thr-${t.id}-${m.id}`,
              source: "thread",
              direction: m.direction,
              at: m.at,
              text: m.text,
              label: m.direction === "in" ? "" : m.role === "staff" ? m.by || "Staff" : "Bot",
              waMessageId: m.waMessageId || "",
            }),
          ),
      );
    }
  } catch {
    gaps.push("bot chats");
  }

  let messages = mergeTimeline(lists);

  // Ticks: the best status Meta reported for each message we sent.
  const ids = [...new Set(messages.filter((m) => m.direction === "out" && m.waMessageId).map((m) => m.waMessageId))];
  const statusById = new Map<string, string[]>();
  const errById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from("wa_message_delivery")
      .select("wa_message_id, status, error_message")
      .eq("tenant_id", tenantId)
      .in("wa_message_id", ids.slice(i, i + 200));
    if (error) {
      gaps.push("delivery ticks");
      break;
    }
    for (const r of data ?? []) {
      const id = String(r.wa_message_id);
      statusById.set(id, [...(statusById.get(id) ?? []), String(r.status)]);
      if (r.error_message) errById.set(id, String(r.error_message));
    }
  }
  messages = messages.map((m) => {
    if (m.direction !== "out") return m;
    const s = statusById.get(m.waMessageId);
    if (!s) return m.status || !m.waMessageId ? m : { ...m, status: "sent" };
    const status = bestStatus(s);
    return { ...m, status: m.status === "failed" && !status ? "failed" : status || m.status, error: m.error || errById.get(m.waMessageId) || "" };
  });

  return { mobile10, displayName, messages, gaps };
}
