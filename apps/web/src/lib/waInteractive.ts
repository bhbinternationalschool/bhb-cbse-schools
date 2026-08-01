/**
 * WhatsApp interactive messages — reply buttons & list rows (Meta Cloud API).
 */

import {
  sendWhatsAppText,
  waDigitsToE164India,
} from "@/lib/waSend";

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

export type WaReplyButton = {
  id: string;
  title: string;
};

export type WaListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WaListSection = {
  title: string;
  rows: WaListRow[];
};

export type WaInteractiveMenu =
  | {
      kind: "buttons";
      body: string;
      footer?: string;
      buttons: WaReplyButton[];
    }
  | {
      kind: "list";
      body: string;
      footer?: string;
      buttonText: string;
      sections: WaListSection[];
    };

async function metaPost(body: Record<string, unknown>): Promise<{
  ok: boolean;
  providerId?: string;
  error?: string;
}> {
  const phoneNumberId = metaPhoneNumberId();
  const metaToken = metaAccessToken();
  if (!phoneNumberId || !metaToken) {
    return { ok: false, error: "WhatsApp API not configured" };
  }
  const version = metaGraphVersion();
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${metaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `Meta HTTP ${res.status}`,
      };
    }
    return { ok: true, providerId: json.messages?.[0]?.id || "ok" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta send failed",
    };
  }
}

export async function sendWhatsAppReplyButtons(opts: {
  toMobile: string;
  body: string;
  footer?: string;
  buttons: WaReplyButton[];
}): Promise<{ ok: boolean; mode: string; error?: string; providerId?: string }> {
  const to = waDigitsToE164India(opts.toMobile);
  const buttons = opts.buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: {
      id: b.id.slice(0, 256),
      title: b.title.slice(0, 20),
    },
  }));
  if (!buttons.length) {
    return { ok: false, mode: "meta", error: "No buttons" };
  }
  const r = await metaPost({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: opts.body.slice(0, 1024) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: { buttons },
    },
  });
  return { ...r, mode: "meta" };
}

export async function sendWhatsAppListMessage(opts: {
  toMobile: string;
  body: string;
  footer?: string;
  buttonText: string;
  sections: WaListSection[];
}): Promise<{ ok: boolean; mode: string; error?: string; providerId?: string }> {
  const to = waDigitsToE164India(opts.toMobile);
  const sections = opts.sections.map((s) => ({
    title: s.title.slice(0, 24),
    rows: s.rows.slice(0, 10).map((row) => ({
      id: row.id.slice(0, 200),
      title: row.title.slice(0, 24),
      ...(row.description
        ? { description: row.description.slice(0, 72) }
        : {}),
    })),
  }));
  const r = await metaPost({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: opts.body.slice(0, 1024) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: {
        button: opts.buttonText.slice(0, 20),
        sections,
      },
    },
  });
  return { ...r, mode: "meta" };
}

/** Send interactive menu; fall back to plain text listing options. */
export async function sendWhatsAppInteractive(opts: {
  toMobile: string;
  menu: WaInteractiveMenu;
  textFallback: string;
}): Promise<{
  ok: boolean;
  mode: string;
  usedInteractive: boolean;
  error?: string;
}> {
  const { menu, toMobile, textFallback } = opts;
  if (menu.kind === "buttons" && menu.buttons.length) {
    const r = await sendWhatsAppReplyButtons({
      toMobile,
      body: menu.body,
      footer: menu.footer,
      buttons: menu.buttons,
    });
    if (r.ok) {
      return { ok: true, mode: r.mode, usedInteractive: true };
    }
  }
  if (menu.kind === "list" && menu.sections.some((s) => s.rows.length)) {
    const r = await sendWhatsAppListMessage({
      toMobile,
      body: menu.body,
      footer: menu.footer,
      buttonText: menu.buttonText,
      sections: menu.sections,
    });
    if (r.ok) {
      return { ok: true, mode: r.mode, usedInteractive: true };
    }
  }
  const { sendWhatsAppText } = await import("@/lib/waSend");
  const r = await sendWhatsAppText({ toMobile, body: textFallback });
  return {
    ok: r.ok,
    mode: r.mode,
    usedInteractive: false,
    error: r.error,
  };
}
