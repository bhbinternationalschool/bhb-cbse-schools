/**
 * Social credentials — ERP-stored per tenant (server blob) with env fallback.
 * Secrets never returned in full to the browser.
 */

import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import type { MetaOAuthPage } from "@/lib/metaOAuth.server";
import { metaOAuthConfigured } from "@/lib/metaOAuth.server";

export type MetaPendingPage = {
  id: string;
  name: string;
  accessToken: string;
  instagramBusinessId: string;
  instagramUsername: string;
};

export type SocialIntegrationsState = {
  version: 1;
  metaAccessToken: string;
  facebookPageId: string;
  facebookPageName: string;
  instagramBusinessId: string;
  telegramBotToken: string;
  telegramChannelId: string;
  telegramChannelUsername: string;
  defaultImageUrl: string;
  crossPostEnabled: boolean;
  metaConnectedVia: "" | "oauth" | "manual";
  pendingMetaPages: MetaPendingPage[];
  updatedAt: string;
  updatedBy: string;
};

export type SocialIntegrationsPublic = {
  configuredInErp: boolean;
  credentialSource: "erp" | "env" | "mixed" | "none";
  crossPostEnabled: boolean;
  metaOAuthAvailable: boolean;
  metaConnectedVia: "" | "oauth" | "manual";
  facebookPageName: string;
  pendingPages: { id: string; name: string; instagramUsername: string }[];
  metaTokenSet: boolean;
  metaTokenHint: string;
  facebookPageId: string;
  instagramBusinessId: string;
  telegramBotTokenSet: boolean;
  telegramBotTokenHint: string;
  telegramChannelId: string;
  telegramChannelUsername: string;
  defaultImageUrl: string;
  updatedAt: string;
  updatedBy: string;
};

export type ResolvedSocialSecrets = {
  metaAccessToken: string;
  facebookPageId: string;
  instagramBusinessId: string;
  telegramBotToken: string;
  telegramChannelId: string;
  telegramChannelUsername: string;
  defaultImageUrl: string;
  crossPostEnabled: boolean;
  credentialSource: SocialIntegrationsPublic["credentialSource"];
};

export type SaveSocialIntegrationsInput = {
  metaAccessToken?: string;
  facebookPageId?: string;
  instagramBusinessId?: string;
  telegramBotToken?: string;
  telegramChannelId?: string;
  telegramChannelUsername?: string;
  defaultImageUrl?: string;
  crossPostEnabled?: boolean;
};

function emptyState(): SocialIntegrationsState {
  return {
    version: 1,
    metaAccessToken: "",
    facebookPageId: "",
    facebookPageName: "",
    instagramBusinessId: "",
    telegramBotToken: "",
    telegramChannelId: "",
    telegramChannelUsername: "",
    defaultImageUrl: "",
    crossPostEnabled: true,
    metaConnectedVia: "",
    pendingMetaPages: [],
    updatedAt: "",
    updatedBy: "",
  };
}

function normalizeState(raw: Partial<SocialIntegrationsState> | null): SocialIntegrationsState {
  const base = emptyState();
  if (!raw) return base;
  return {
    version: 1,
    metaAccessToken: String(raw.metaAccessToken ?? ""),
    facebookPageId: String(raw.facebookPageId ?? ""),
    facebookPageName: String(raw.facebookPageName ?? ""),
    instagramBusinessId: String(raw.instagramBusinessId ?? ""),
    telegramBotToken: String(raw.telegramBotToken ?? ""),
    telegramChannelId: String(raw.telegramChannelId ?? ""),
    telegramChannelUsername: String(raw.telegramChannelUsername ?? ""),
    defaultImageUrl: String(raw.defaultImageUrl ?? ""),
    crossPostEnabled: raw.crossPostEnabled !== false,
    metaConnectedVia:
      raw.metaConnectedVia === "oauth" || raw.metaConnectedVia === "manual"
        ? raw.metaConnectedVia
        : "",
    pendingMetaPages: Array.isArray(raw.pendingMetaPages)
      ? (raw.pendingMetaPages as MetaPendingPage[])
      : [],
    updatedAt: String(raw.updatedAt ?? ""),
    updatedBy: String(raw.updatedBy ?? ""),
  };
}

function secretHint(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function envSecrets(): ResolvedSocialSecrets {
  const envDisabled =
    process.env.SOCIAL_CROSS_POST_ENABLED === "false" ||
    process.env.SOCIAL_CROSS_POST_ENABLED === "0";
  return {
    metaAccessToken:
      process.env.SOCIAL_META_ACCESS_TOKEN ||
      process.env.WA_META_ACCESS_TOKEN ||
      process.env.WHATSAPP_TOKEN ||
      "",
    facebookPageId:
      process.env.SOCIAL_FACEBOOK_PAGE_ID || process.env.FACEBOOK_PAGE_ID || "",
    instagramBusinessId:
      process.env.SOCIAL_INSTAGRAM_BUSINESS_ID ||
      process.env.INSTAGRAM_BUSINESS_ID ||
      "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChannelId: process.env.TELEGRAM_CHANNEL_ID || "",
    telegramChannelUsername: process.env.TELEGRAM_CHANNEL_USERNAME || "",
    defaultImageUrl:
      process.env.SOCIAL_DEFAULT_IMAGE_URL ||
      process.env.NEXT_PUBLIC_SCHOOL_LOGO_URL ||
      "",
    crossPostEnabled: !envDisabled,
    credentialSource: "env",
  };
}

function pick(
  erp: string,
  env: string,
): { value: string; from: "erp" | "env" | "" } {
  if (erp.trim()) return { value: erp.trim(), from: "erp" };
  if (env.trim()) return { value: env.trim(), from: "env" };
  return { value: "", from: "" };
}

let secretsCache: { at: number; value: ResolvedSocialSecrets } | null = null;
const CACHE_MS = 15_000;

export function clearSocialIntegrationsCache(): void {
  secretsCache = null;
}

export async function loadSocialIntegrationsState(): Promise<SocialIntegrationsState> {
  const { state } = await fetchServerBlob<SocialIntegrationsState>(
    "social_integrations_state",
  );
  return normalizeState(state);
}

export async function resolveSocialSecrets(): Promise<ResolvedSocialSecrets> {
  if (secretsCache && Date.now() - secretsCache.at < CACHE_MS) {
    return secretsCache.value;
  }

  const erp = await loadSocialIntegrationsState();
  const env = envSecrets();

  const meta = pick(erp.metaAccessToken, env.metaAccessToken);
  const page = pick(erp.facebookPageId, env.facebookPageId);
  const ig = pick(erp.instagramBusinessId, env.instagramBusinessId);
  const tgToken = pick(erp.telegramBotToken, env.telegramBotToken);
  const tgChannel = pick(erp.telegramChannelId, env.telegramChannelId);
  const tgUser = pick(erp.telegramChannelUsername, env.telegramChannelUsername);
  const image = pick(erp.defaultImageUrl, env.defaultImageUrl);

  const sources = [meta.from, page.from, ig.from, tgToken.from, tgChannel.from].filter(
    Boolean,
  ) as ("erp" | "env")[];
  const credentialSource: SocialIntegrationsPublic["credentialSource"] =
    sources.length === 0
      ? "none"
      : sources.every((s) => s === "erp")
        ? "erp"
        : sources.every((s) => s === "env")
          ? "env"
          : "mixed";

  const envDisabled =
    process.env.SOCIAL_CROSS_POST_ENABLED === "false" ||
    process.env.SOCIAL_CROSS_POST_ENABLED === "0";
  const crossPostEnabled = erp.updatedAt
    ? erp.crossPostEnabled
    : env.crossPostEnabled && !envDisabled;

  const value: ResolvedSocialSecrets = {
    metaAccessToken: meta.value,
    facebookPageId: page.value,
    instagramBusinessId: ig.value,
    telegramBotToken: tgToken.value,
    telegramChannelId: tgChannel.value,
    telegramChannelUsername: tgUser.value,
    defaultImageUrl: image.value,
    crossPostEnabled,
    credentialSource,
  };

  secretsCache = { at: Date.now(), value };
  return value;
}

export async function getSocialIntegrationsPublic(): Promise<SocialIntegrationsPublic> {
  const erp = await loadSocialIntegrationsState();
  const resolved = await resolveSocialSecrets();

  return {
    configuredInErp: !!erp.updatedAt,
    credentialSource: resolved.credentialSource,
    crossPostEnabled: resolved.crossPostEnabled,
    metaOAuthAvailable: metaOAuthConfigured(),
    metaConnectedVia: erp.metaConnectedVia,
    facebookPageName: erp.facebookPageName,
    pendingPages: erp.pendingMetaPages.map((p) => ({
      id: p.id,
      name: p.name,
      instagramUsername: p.instagramUsername,
    })),
    metaTokenSet: !!resolved.metaAccessToken,
    metaTokenHint: secretHint(resolved.metaAccessToken),
    facebookPageId: resolved.facebookPageId,
    instagramBusinessId: resolved.instagramBusinessId,
    telegramBotTokenSet: !!resolved.telegramBotToken,
    telegramBotTokenHint: secretHint(resolved.telegramBotToken),
    telegramChannelId: resolved.telegramChannelId,
    telegramChannelUsername: resolved.telegramChannelUsername,
    defaultImageUrl: resolved.defaultImageUrl,
    updatedAt: erp.updatedAt,
    updatedBy: erp.updatedBy,
  };
}

export async function saveSocialIntegrations(
  input: SaveSocialIntegrationsInput,
  by: string,
): Promise<{ ok: true; public: SocialIntegrationsPublic } | { ok: false; error: string }> {
  const prev = await loadSocialIntegrationsState();
  const now = new Date().toISOString();

  const next: SocialIntegrationsState = {
    ...prev,
    facebookPageId:
      input.facebookPageId !== undefined
        ? input.facebookPageId.trim()
        : prev.facebookPageId,
    instagramBusinessId:
      input.instagramBusinessId !== undefined
        ? input.instagramBusinessId.trim()
        : prev.instagramBusinessId,
    telegramChannelId:
      input.telegramChannelId !== undefined
        ? input.telegramChannelId.trim()
        : prev.telegramChannelId,
    telegramChannelUsername:
      input.telegramChannelUsername !== undefined
        ? input.telegramChannelUsername.trim()
        : prev.telegramChannelUsername,
    defaultImageUrl:
      input.defaultImageUrl !== undefined
        ? input.defaultImageUrl.trim()
        : prev.defaultImageUrl,
    crossPostEnabled:
      input.crossPostEnabled !== undefined
        ? input.crossPostEnabled
        : prev.crossPostEnabled,
    metaAccessToken:
      input.metaAccessToken?.trim()
        ? input.metaAccessToken.trim()
        : prev.metaAccessToken,
    telegramBotToken:
      input.telegramBotToken?.trim()
        ? input.telegramBotToken.trim()
        : prev.telegramBotToken,
    metaConnectedVia: input.metaAccessToken?.trim()
      ? "manual"
      : prev.metaConnectedVia,
    updatedAt: now,
    updatedBy: by,
  };

  const push = await pushServerBlob("social_integrations_state", next);
  if (!push.ok) {
    return { ok: false, error: push.error || "Failed to save credentials" };
  }

  clearSocialIntegrationsCache();
  const pub = await getSocialIntegrationsPublic();
  return { ok: true, public: pub };
}

export async function clearSocialIntegrations(): Promise<{ ok: boolean; error?: string }> {
  const push = await pushServerBlob("social_integrations_state", emptyState());
  clearSocialIntegrationsCache();
  return push;
}

export async function setPendingMetaPages(
  pages: MetaOAuthPage[],
): Promise<{ ok: boolean; error?: string }> {
  const prev = await loadSocialIntegrationsState();
  const next: SocialIntegrationsState = {
    ...prev,
    pendingMetaPages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      accessToken: p.accessToken,
      instagramBusinessId: p.instagramBusinessId,
      instagramUsername: p.instagramUsername,
    })),
  };
  const push = await pushServerBlob("social_integrations_state", next);
  clearSocialIntegrationsCache();
  return push;
}

export async function connectMetaOAuthPage(
  pageId: string,
  by: string,
): Promise<
  | { ok: true; public: SocialIntegrationsPublic }
  | { ok: false; error: string }
> {
  const prev = await loadSocialIntegrationsState();
  const page = prev.pendingMetaPages.find((p) => p.id === pageId);

  if (!page) {
    return { ok: false, error: "Page not found — connect with Facebook again" };
  }

  const now = new Date().toISOString();
  const next: SocialIntegrationsState = {
    ...prev,
    metaAccessToken: page.accessToken,
    facebookPageId: page.id,
    facebookPageName: page.name,
    instagramBusinessId: page.instagramBusinessId,
    metaConnectedVia: "oauth",
    pendingMetaPages: [],
    crossPostEnabled: true,
    updatedAt: now,
    updatedBy: by,
  };

  const push = await pushServerBlob("social_integrations_state", next);
  if (!push.ok) {
    return { ok: false, error: push.error || "Failed to save Page connection" };
  }
  clearSocialIntegrationsCache();
  const pub = await getSocialIntegrationsPublic();
  return { ok: true, public: pub };
}

export async function connectSingleMetaOAuthPage(
  page: MetaOAuthPage,
  by: string,
): Promise<
  | { ok: true; public: SocialIntegrationsPublic }
  | { ok: false; error: string }
> {
  await setPendingMetaPages([page]);
  return connectMetaOAuthPage(page.id, by);
}
