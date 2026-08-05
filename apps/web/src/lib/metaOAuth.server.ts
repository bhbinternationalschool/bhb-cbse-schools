/**
 * Meta (Facebook) OAuth — Page access token for social cross-post.
 * Server-only. App id/secret in env (same Meta app as WhatsApp).
 */

import { randomBytes } from "crypto";

export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function metaAppId(): string {
  return (
    process.env.META_APP_ID ||
    process.env.FACEBOOK_APP_ID ||
    process.env.META_OAUTH_CLIENT_ID ||
    ""
  ).trim();
}

export function metaAppSecret(): string {
  return (
    process.env.META_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    process.env.META_OAUTH_CLIENT_SECRET ||
    ""
  ).trim();
}

export function metaGraphVersion(): string {
  return (
    process.env.SOCIAL_GRAPH_API_VERSION ||
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

export function metaOAuthRedirectUri(): string {
  const explicit = (
    process.env.META_OAUTH_REDIRECT_URI ||
    process.env.FACEBOOK_OAUTH_REDIRECT_URI ||
    ""
  ).trim();
  if (explicit) return explicit;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/integrations/social/meta-oauth/callback`;
}

export function metaOAuthConfigured(): boolean {
  return !!(metaAppId() && metaAppSecret());
}

export function newMetaOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildMetaOAuthUrl(state: string): string {
  const version = metaGraphVersion();
  const params = new URLSearchParams({
    client_id: metaAppId(),
    redirect_uri: metaOAuthRedirectUri(),
    state,
    scope: META_OAUTH_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
}

export type MetaOAuthPage = {
  id: string;
  name: string;
  accessToken: string;
  link: string;
  instagramBusinessId: string;
  instagramUsername: string;
};

async function graphGet(
  path: string,
  accessToken?: string,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const version = metaGraphVersion();
  const sep = path.includes("?") ? "&" : "?";
  const tokenQ = accessToken
    ? `${sep}access_token=${encodeURIComponent(accessToken)}`
    : "";
  const res = await fetch(
    `https://graph.facebook.com/${version}${path}${tokenQ}`,
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

export async function exchangeMetaAuthCode(
  code: string,
): Promise<
  | { ok: true; accessToken: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const params = new URLSearchParams({
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    redirect_uri: metaOAuthRedirectUri(),
    code,
  });
  const { ok, json } = await graphGet(`/oauth/access_token?${params.toString()}`);
  if (!ok) {
    const err = json.error as { message?: string } | undefined;
    return {
      ok: false,
      error: err?.message || String(json.error || "Token exchange failed"),
    };
  }
  const accessToken = String(json.access_token ?? "");
  if (!accessToken) {
    return { ok: false, error: "No access token in Meta response" };
  }
  return {
    ok: true,
    accessToken,
    expiresIn: Number(json.expires_in) || undefined,
  };
}

export async function exchangeMetaLongLivedUserToken(
  shortToken: string,
): Promise<
  | { ok: true; accessToken: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    fb_exchange_token: shortToken,
  });
  const { ok, json } = await graphGet(`/oauth/access_token?${params.toString()}`);
  if (!ok) {
    const err = json.error as { message?: string } | undefined;
    return {
      ok: false,
      error: err?.message || "Long-lived token exchange failed",
    };
  }
  const accessToken = String(json.access_token ?? "");
  if (!accessToken) {
    return { ok: false, error: "No long-lived token returned" };
  }
  return {
    ok: true,
    accessToken,
    expiresIn: Number(json.expires_in) || undefined,
  };
}

export async function fetchMetaManagedPages(
  userAccessToken: string,
): Promise<
  | { ok: true; pages: MetaOAuthPage[] }
  | { ok: false; error: string }
> {
  const { ok, json } = await graphGet(
    `/me/accounts?fields=id,name,access_token,link,instagram_business_account{id,username}&limit=50`,
    userAccessToken,
  );
  if (!ok) {
    const err = json.error as { message?: string } | undefined;
    return {
      ok: false,
      error: err?.message || "Could not list Facebook Pages",
    };
  }
  const data = (json.data as Record<string, unknown>[] | undefined) ?? [];
  const pages: MetaOAuthPage[] = data
    .map((row) => {
      const ig = row.instagram_business_account as
        | { id?: string; username?: string }
        | undefined;
      const accessToken = String(row.access_token ?? "");
      const id = String(row.id ?? "");
      if (!id || !accessToken) return null;
      return {
        id,
        name: String(row.name ?? id),
        accessToken,
        link: String(row.link ?? ""),
        instagramBusinessId: ig?.id ? String(ig.id) : "",
        instagramUsername: ig?.username ? String(ig.username) : "",
      };
    })
    .filter((p): p is MetaOAuthPage => p !== null);

  if (!pages.length) {
    return {
      ok: false,
      error:
        "No Facebook Pages found for this account. Use a profile that manages your school Page.",
    };
  }
  return { ok: true, pages };
}

export async function completeMetaOAuthCode(
  code: string,
): Promise<
  | { ok: true; pages: MetaOAuthPage[] }
  | { ok: false; error: string }
> {
  const short = await exchangeMetaAuthCode(code);
  if (!short.ok) return short;

  const long = await exchangeMetaLongLivedUserToken(short.accessToken);
  const userToken = long.ok ? long.accessToken : short.accessToken;

  return fetchMetaManagedPages(userToken);
}
