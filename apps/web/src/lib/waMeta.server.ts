/**
 * Meta WhatsApp Cloud API — WABA discovery, health, webhook subscription.
 * Server-only.
 */

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

export function metaWabaIdFromEnv(): string {
  return (
    process.env.WA_BUSINESS_ACCOUNT_ID ||
    process.env.WHATSAPP_WABA_ID ||
    ""
  );
}

export type WhatsAppPhoneHealth = {
  displayNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  accountMode: string | null;
  codeVerificationStatus: string | null;
  canSendMessage: boolean;
  wabaId: string | null;
  businessId: string | null;
  appId: string | null;
};

/** Resolve WABA id from env or Meta phone health_status.entities. */
export async function resolveWhatsAppWabaId(): Promise<string> {
  const fromEnv = metaWabaIdFromEnv();
  if (fromEnv) return fromEnv;
  const health = await fetchWhatsAppPhoneHealth();
  return health.wabaId || "";
}

export async function fetchWhatsAppPhoneHealth(): Promise<WhatsAppPhoneHealth> {
  const empty: WhatsAppPhoneHealth = {
    displayNumber: null,
    verifiedName: null,
    status: null,
    accountMode: null,
    codeVerificationStatus: null,
    canSendMessage: false,
    wabaId: null,
    businessId: null,
    appId: null,
  };
  const token = metaAccessToken();
  const phoneId = metaPhoneNumberId();
  if (!token || !phoneId) return empty;

  const version = metaGraphVersion();
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${phoneId}?fields=display_phone_number,verified_name,status,account_mode,code_verification_status,health_status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      status?: string;
      account_mode?: string;
      code_verification_status?: string;
      health_status?: {
        can_send_message?: string;
        entities?: {
          entity_type?: string;
          id?: string;
          can_send_message?: string;
        }[];
      };
    };
    if (!res.ok) return empty;

    const entities = json.health_status?.entities || [];
    const waba = entities.find((e) => e.entity_type === "WABA")?.id || null;
    const business =
      entities.find((e) => e.entity_type === "BUSINESS")?.id || null;
    const app = entities.find((e) => e.entity_type === "APP")?.id || null;
    const canSend =
      json.health_status?.can_send_message === "AVAILABLE" ||
      entities.some((e) => e.can_send_message === "AVAILABLE");

    return {
      displayNumber: json.display_phone_number || null,
      verifiedName: json.verified_name || null,
      status: json.status || null,
      accountMode: json.account_mode || null,
      codeVerificationStatus: json.code_verification_status || null,
      canSendMessage: canSend,
      wabaId: waba,
      businessId: business,
      appId: app,
    };
  } catch {
    return empty;
  }
}

export async function listWabaSubscribedApps(
  wabaId: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const token = metaAccessToken();
  if (!token || !wabaId) {
    return { ok: false, count: 0, error: "Missing token or WABA id" };
  }
  const version = metaGraphVersion();
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json().catch(() => ({}))) as {
      data?: unknown[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        count: 0,
        error: json.error?.message || `Meta HTTP ${res.status}`,
      };
    }
    return { ok: true, count: (json.data || []).length };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      error: e instanceof Error ? e.message : "Subscribe list failed",
    };
  }
}

/** Subscribe this Meta app to receive WABA webhooks (required for inbound). */
export async function ensureWabaWebhookSubscription(
  wabaId?: string,
): Promise<{ ok: boolean; subscribed: boolean; error?: string }> {
  const waba = wabaId || (await resolveWhatsAppWabaId());
  if (!waba) {
    return {
      ok: false,
      subscribed: false,
      error: "Could not resolve WHATSAPP_WABA_ID",
    };
  }
  const before = await listWabaSubscribedApps(waba);
  if (before.ok && before.count > 0) {
    return { ok: true, subscribed: true };
  }

  const token = metaAccessToken();
  if (!token) {
    return { ok: false, subscribed: false, error: "Missing WHATSAPP_TOKEN" };
  }
  const version = metaGraphVersion();
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${waba}/subscribed_apps`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string };
    };
    if (!res.ok || !json.success) {
      return {
        ok: false,
        subscribed: false,
        error: json.error?.message || `Subscribe HTTP ${res.status}`,
      };
    }
    return { ok: true, subscribed: true };
  } catch (e) {
    return {
      ok: false,
      subscribed: false,
      error: e instanceof Error ? e.message : "Subscribe failed",
    };
  }
}

export type WhatsAppSetupReport = {
  outboundConfigured: boolean;
  wabaId: string | null;
  wabaFromEnv: boolean;
  phoneHealth: WhatsAppPhoneHealth;
  subscribedApps: number;
  webhookVerifyConfigured: boolean;
  webhookUrls: string[];
  approvedTemplateCount: number | null;
  issues: string[];
  fixes: string[];
};

export async function getWhatsAppSetupReport(): Promise<WhatsAppSetupReport> {
  const token = metaAccessToken();
  const phoneId = metaPhoneNumberId();
  const verify =
    process.env.WA_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    "";
  const outboundConfigured = !!(token && phoneId);
  const wabaFromEnv = !!metaWabaIdFromEnv();
  const phoneHealth = outboundConfigured
    ? await fetchWhatsAppPhoneHealth()
    : await Promise.resolve({
        displayNumber: null,
        verifiedName: null,
        status: null,
        accountMode: null,
        codeVerificationStatus: null,
        canSendMessage: false,
        wabaId: null,
        businessId: null,
        appId: null,
      } satisfies WhatsAppPhoneHealth);
  const wabaId = metaWabaIdFromEnv() || phoneHealth.wabaId;
  const subs = wabaId
    ? await listWabaSubscribedApps(wabaId)
    : { ok: false, count: 0 };

  let approvedTemplateCount: number | null = null;
  if (wabaId && token) {
    const version = metaGraphVersion();
    try {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/message_templates?limit=100&fields=name,status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: { status?: string }[];
      };
      if (res.ok && Array.isArray(json.data)) {
        approvedTemplateCount = json.data.filter(
          (t) => t.status === "APPROVED",
        ).length;
      }
    } catch {
      approvedTemplateCount = null;
    }
  }

  const issues: string[] = [];
  const fixes: string[] = [];
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://bhbinternational.school";
  const webhookUrls = [
    `${appUrl.replace(/\/$/, "")}/api/wa/webhook`,
    `${appUrl.replace(/\/$/, "")}/api/whatsapp/webhook`,
  ];

  if (!outboundConfigured) {
    issues.push("WHATSAPP_TOKEN or WHATSAPP_PHONE_ID missing on server.");
    fixes.push("Set both in apps/web/.env.local and redeploy.");
  }
  if (!verify) {
    issues.push("WHATSAPP_VERIFY_TOKEN missing — Meta webhook verify will fail.");
    fixes.push("Set WHATSAPP_VERIFY_TOKEN and paste the same value in Meta → WhatsApp → Configuration.");
  }
  if (outboundConfigured && subs.count === 0) {
    issues.push(
      "Meta app is not subscribed to your WABA — inbound messages never reach the ERP.",
    );
    fixes.push(
      "POST /api/wa/setup with { \"action\": \"subscribe\" } or re-run deploy (bootstrap subscribes automatically).",
    );
  }
  if (phoneHealth.codeVerificationStatus === "EXPIRED" && !phoneHealth.canSendMessage) {
    issues.push(
      "Phone number OTP verification is EXPIRED in Meta (may affect registration).",
    );
    fixes.push(
      "Meta Business Suite → WhatsApp Manager → Phone numbers → re-verify +91 94519 38805.",
    );
  }
  if (approvedTemplateCount === 0) {
    issues.push(
      "No approved message templates in Meta — cold outbound (campaigns outside 24h) will not deliver.",
    );
    fixes.push(
      "Create & approve templates in Meta Business Suite → WhatsApp Manager, then Masters → WhatsApp templates → Sync from Meta.",
    );
  }
  if (!wabaFromEnv && wabaId) {
    fixes.push(`Add WHATSAPP_WABA_ID=${wabaId} to .env.local for faster template sync.`);
  }

  return {
    outboundConfigured,
    wabaId: wabaId || null,
    wabaFromEnv,
    phoneHealth,
    subscribedApps: subs.count,
    webhookVerifyConfigured: !!verify,
    webhookUrls,
    approvedTemplateCount,
    issues,
    fixes,
  };
}
