/**
 * WhatsApp Business send helpers — Meta Cloud API and/or generic BSP URL.
 */

import { isOptedOut, isWithin24HourWindow } from "@/lib/waContactState.server";

export function waDigitsToE164India(mobile: string): string {
  const d = (mobile || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.startsWith("91") && d.length === 12) return d;
  return d;
}

export function waNormalizeLocal10(from: string): string {
  const d = (from || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d.slice(-10);
}

function metaAccessToken(): string {
  return (
    process.env.WA_META_ACCESS_TOKEN ||
    process.env.WHATSAPP_TOKEN ||
    ""
  );
}

function metaPhoneNumberId(): string {
  return (
    process.env.WA_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_ID ||
    ""
  );
}

function metaGraphVersion(): string {
  return (
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

export function waOutboundConfigured(): boolean {
  if (metaAccessToken() && metaPhoneNumberId()) return true;
  return !!(process.env.WA_BSP_TOKEN && process.env.WA_BSP_URL);
}

export async function sendWhatsAppText(opts: {
  toMobile: string;
  body: string;
  clientMessageId?: string;
}): Promise<{ ok: boolean; providerId?: string; error?: string; mode: string }> {
  const to = waDigitsToE164India(opts.toMobile);
  const text = (opts.body || "").slice(0, 4096);
  if (!to || to.length < 10) {
    return { ok: false, error: "Invalid destination", mode: "none" };
  }
  if (!text) {
    return { ok: false, error: "Empty body", mode: "none" };
  }
  if (await isOptedOut(to)) {
    return { ok: false, error: "Contact has opted out (STOP)", mode: "none" };
  }
  if (!(await isWithin24HourWindow(to))) {
    return {
      ok: false,
      error: "Outside Meta's 24h session window — send an approved template instead",
      mode: "none",
    };
  }

  const phoneNumberId = metaPhoneNumberId();
  const metaToken = metaAccessToken();
  if (phoneNumberId && metaToken) {
    const version = metaGraphVersion();
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${metaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: true, body: text },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          mode: "meta",
          error: json.error?.message || `Meta HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        mode: "meta",
        providerId: json.messages?.[0]?.id || "ok",
      };
    } catch (e) {
      return {
        ok: false,
        mode: "meta",
        error: e instanceof Error ? e.message : "Meta send failed",
      };
    }
  }

  const bspUrl = process.env.WA_BSP_URL;
  const bspToken = process.env.WA_BSP_TOKEN;
  if (bspUrl && bspToken) {
    try {
      const res = await fetch(bspUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bspToken}`,
        },
        body: JSON.stringify({
          to,
          type: "text",
          text: { body: text },
          clientMessageId: opts.clientMessageId,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          mode: "bsp",
          error: `BSP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        messageId?: string;
      };
      return {
        ok: true,
        mode: "bsp",
        providerId: json.id || json.messageId || "ok",
      };
    } catch (e) {
      return {
        ok: false,
        mode: "bsp",
        error: e instanceof Error ? e.message : "BSP send failed",
      };
    }
  }

  return {
    ok: false,
    mode: "stub",
    error:
      "Configure WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (or WA_BSP_URL + WA_BSP_TOKEN)",
  };
}

export type WaTemplateComponent = {
  type: "header" | "body" | "button" | "carousel";
  sub_type?: string;
  index?: number;
  parameters?: {
    type: "text" | "image" | "document" | "video" | "payload" | "coupon_code";
    text?: string;
    image?: { link: string };
    document?: { link: string; filename?: string };
    video?: { link: string };
    payload?: string;
    coupon_code?: string;
  }[];
  cards?: {
    card_index: number;
    components: WaTemplateComponent[];
  }[];
};

/**
 * Send a Meta-approved WhatsApp template (incl. media header / carousel components).
 */
export async function sendWhatsAppTemplate(opts: {
  toMobile: string;
  name: string;
  language: string;
  components?: WaTemplateComponent[];
  clientMessageId?: string;
}): Promise<{ ok: boolean; providerId?: string; error?: string; mode: string }> {
  const to = waDigitsToE164India(opts.toMobile);
  if (!to || to.length < 10) {
    return { ok: false, error: "Invalid destination", mode: "none" };
  }
  if (!opts.name) {
    return { ok: false, error: "Missing template name", mode: "none" };
  }
  if (await isOptedOut(to)) {
    return { ok: false, error: "Contact has opted out (STOP)", mode: "none" };
  }

  const phoneNumberId = metaPhoneNumberId();
  const metaToken = metaAccessToken();
  const languageCode = (opts.language || "en").slice(0, 5);

  if (phoneNumberId && metaToken) {
    const version = metaGraphVersion();
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${metaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: opts.name,
            language: { code: languageCode },
            components: opts.components || [],
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          mode: "meta",
          error: json.error?.message || `Meta HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        mode: "meta",
        providerId: json.messages?.[0]?.id || "ok",
      };
    } catch (e) {
      return {
        ok: false,
        mode: "meta",
        error: e instanceof Error ? e.message : "Meta template send failed",
      };
    }
  }

  const bspUrl = process.env.WA_BSP_URL;
  const bspToken = process.env.WA_BSP_TOKEN;
  if (bspUrl && bspToken) {
    try {
      const res = await fetch(bspUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bspToken}`,
        },
        body: JSON.stringify({
          to,
          type: "template",
          template: {
            name: opts.name,
            language: { code: languageCode },
            components: opts.components || [],
          },
          clientMessageId: opts.clientMessageId,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          mode: "bsp",
          error: `BSP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        messageId?: string;
      };
      return {
        ok: true,
        mode: "bsp",
        providerId: json.id || json.messageId || "ok",
      };
    } catch (e) {
      return {
        ok: false,
        mode: "bsp",
        error: e instanceof Error ? e.message : "BSP template send failed",
      };
    }
  }

  return {
    ok: false,
    mode: "stub",
    error:
      "Configure WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (or WA_BSP_URL + WA_BSP_TOKEN)",
  };
}

/** Build Meta body component from named vars + ordered variable keys. */
export function buildWaTemplateBodyComponent(
  variableKeys: string[],
  vars: Record<string, string>,
): WaTemplateComponent {
  return {
    type: "body",
    parameters: variableKeys.map((key) => ({
      type: "text" as const,
      text: String(vars[key] ?? "").slice(0, 1024) || "—",
    })),
  };
}

/** Build the mandatory OTP copy-code button component for an AUTHENTICATION
 * template send — required whenever the template was created with the OTP
 * COPY_CODE button (Meta rejects the send otherwise: "template has buttons
 * but request doesn't include them"). */
export function buildWaOtpCopyCodeButtonComponent(code: string): WaTemplateComponent {
  return {
    type: "button",
    sub_type: "copy_code",
    index: 0,
    parameters: [{ type: "coupon_code", coupon_code: code.slice(0, 15) }],
  };
}

export function buildWaTemplateMediaHeader(
  format: "IMAGE" | "VIDEO" | "DOCUMENT",
  link: string,
  filename?: string,
): WaTemplateComponent {
  if (format === "VIDEO") {
    return { type: "header", parameters: [{ type: "video", video: { link } }] };
  }
  if (format === "DOCUMENT") {
    return {
      type: "header",
      parameters: [
        { type: "document", document: { link, filename: filename || "file.pdf" } },
      ],
    };
  }
  return { type: "header", parameters: [{ type: "image", image: { link } }] };
}

export type WaContactCheckStatus =
  | "on_whatsapp"
  | "not_on_whatsapp"
  | "unknown"
  | "invalid_format";

export type WaContactCheckResult = {
  input: string;
  local10: string;
  e164: string;
  status: WaContactCheckStatus;
  waId?: string;
  /** Display name when the provider returns one (rare on Meta Cloud) */
  profileName?: string;
  detail?: string;
};

/**
 * When live WhatsApp Business is configured, ask the provider whether numbers
 * are on WhatsApp. Meta Cloud: POST /{phone-number-id}/contacts (returns
 * status valid/invalid + wa_id). Offline / unconfigured → caller should skip.
 */
export async function checkWhatsAppContacts(
  mobiles: string[],
): Promise<{
  ok: boolean;
  mode: string;
  results: WaContactCheckResult[];
  error?: string;
}> {
  const unique = [
    ...new Set(
      mobiles
        .map((m) => waNormalizeLocal10(m))
        .filter((m) => m.length === 10),
    ),
  ].slice(0, 100); // safety cap per request

  if (!unique.length) {
    return { ok: false, mode: "none", results: [], error: "No valid 10-digit mobiles" };
  }

  const phoneNumberId = metaPhoneNumberId();
  const metaToken = metaAccessToken();

  if (phoneNumberId && metaToken) {
    const version = metaGraphVersion();
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/contacts`;
    const contacts = unique.map((m) => `+91${m}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${metaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          contacts,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        contacts?: {
          input?: string;
          status?: string;
          wa_id?: string;
        }[];
        error?: { message?: string; code?: number };
      };

      if (!res.ok) {
        // Cloud API may reject contacts lookup on some WABAs — surface clearly
        return {
          ok: false,
          mode: "meta",
          results: [],
          error:
            json.error?.message ||
            `Meta contacts HTTP ${res.status} — send-path error 131026 can still prove “not on WhatsApp” after go-live`,
        };
      }

      const byInput = new Map(
        (json.contacts || []).map((c) => [
          waNormalizeLocal10(c.input || c.wa_id || ""),
          c,
        ]),
      );

      const results: WaContactCheckResult[] = unique.map((local10) => {
        const hit = byInput.get(local10) as
          | {
              input?: string;
              status?: string;
              wa_id?: string;
              profile?: { name?: string };
              name?: string;
            }
          | undefined;
        const e164 = `91${local10}`;
        const profileName =
          (hit?.profile?.name || hit?.name || "").trim() || undefined;
        if (!hit) {
          return {
            input: local10,
            local10,
            e164,
            status: "unknown",
            detail: "No row returned for this number",
          };
        }
        const statusRaw = (hit.status || "").toLowerCase();
        if (statusRaw === "valid" || hit.wa_id) {
          return {
            input: local10,
            local10,
            e164,
            status: "on_whatsapp",
            waId: hit.wa_id || e164,
            profileName,
            detail: profileName
              ? `WA name: ${profileName}`
              : hit.wa_id
                ? `wa_id ${hit.wa_id} (no profile name from Meta — name fills after first reply or via BSP)`
                : "valid",
          };
        }
        if (statusRaw === "invalid") {
          return {
            input: local10,
            local10,
            e164,
            status: "not_on_whatsapp",
            detail: "Meta: not registered on WhatsApp",
          };
        }
        return {
          input: local10,
          local10,
          e164,
          status: "unknown",
          detail: hit.status || "unrecognised status",
          profileName,
        };
      });

      return { ok: true, mode: "meta", results };
    } catch (e) {
      return {
        ok: false,
        mode: "meta",
        results: [],
        error: e instanceof Error ? e.message : "Meta contacts check failed",
      };
    }
  }

  // Optional BSP contacts check hook
  const bspCheckUrl = process.env.WA_BSP_CONTACTS_URL;
  const bspToken = process.env.WA_BSP_TOKEN;
  if (bspCheckUrl && bspToken) {
    try {
      const res = await fetch(bspCheckUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bspToken}`,
        },
        body: JSON.stringify({
          contacts: unique.map((m) => `91${m}`),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: {
          phone?: string;
          exists?: boolean;
          wa_id?: string;
          name?: string;
        }[];
        error?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          mode: "bsp",
          results: [],
          error: json.error || `BSP contacts HTTP ${res.status}`,
        };
      }
      const byPhone = new Map(
        (json.results || []).map((r) => [
          waNormalizeLocal10(r.phone || r.wa_id || ""),
          r,
        ]),
      );
      const results: WaContactCheckResult[] = unique.map((local10) => {
        const hit = byPhone.get(local10);
        const e164 = `91${local10}`;
        if (!hit) {
          return {
            input: local10,
            local10,
            e164,
            status: "unknown",
            detail: "No BSP row",
          };
        }
        if (hit.exists === false) {
          return {
            input: local10,
            local10,
            e164,
            status: "not_on_whatsapp",
            detail: "BSP: not on WhatsApp",
          };
        }
        if (hit.exists === true || hit.wa_id) {
          return {
            input: local10,
            local10,
            e164,
            status: "on_whatsapp",
            waId: hit.wa_id || e164,
            profileName: hit.name,
            detail: hit.name ? `WA name: ${hit.name}` : "on WhatsApp",
          };
        }
        return {
          input: local10,
          local10,
          e164,
          status: "unknown",
          detail: "BSP inconclusive",
        };
      });
      return { ok: true, mode: "bsp", results };
    } catch (e) {
      return {
        ok: false,
        mode: "bsp",
        results: [],
        error: e instanceof Error ? e.message : "BSP contacts check failed",
      };
    }
  }

  return {
    ok: false,
    mode: "stub",
    results: unique.map((local10) => ({
      input: local10,
      local10,
      e164: `91${local10}`,
      status: "unknown" as const,
      detail: "WhatsApp API not configured — format check only",
    })),
    error:
      "Offline / stub: set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (or WA_BSP_CONTACTS_URL) to verify numbers on go-live",
  };
}
