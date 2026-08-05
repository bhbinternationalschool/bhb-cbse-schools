/**
 * Cross-post school comms to Facebook Page, Instagram Business, Telegram channel.
 * Credentials: ERP Comms → Social (preferred) or server env fallback.
 */

import { publicPortalOrigin } from "@/lib/admissions";
import {
  findCrossPostLog,
  saveCrossPostLog,
} from "@/lib/socialCrossPostLog.server";
import { resolveSocialSecrets, type ResolvedSocialSecrets } from "@/lib/socialIntegrations.server";
import type {
  SocialCrossPostConfig,
  SocialCrossPostKind,
  SocialCrossPostPayload,
  SocialCrossPostResult,
  SocialPlatform,
  SocialPlatformResult,
} from "@/lib/socialCrossPost.types";

function metaGraphVersion(): string {
  return (
    process.env.SOCIAL_GRAPH_API_VERSION ||
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    publicPortalOrigin() ||
    "https://bhbinternational.school"
  ).replace(/\/$/, "");
}

export async function getSocialCrossPostConfig(): Promise<SocialCrossPostConfig> {
  const notes: string[] = [];
  const secrets = await resolveSocialSecrets();
  const token = secrets.metaAccessToken;
  const pageId = secrets.facebookPageId;
  const igId = secrets.instagramBusinessId;
  const tgToken = secrets.telegramBotToken;
  const tgChannel = secrets.telegramChannelId;

  if (!secrets.crossPostEnabled) {
    notes.push("Social cross-post is disabled in ERP settings.");
  }
  if (secrets.credentialSource === "none") {
    notes.push("Connect Facebook and Telegram under Communications → Social.");
  }
  if (!token) {
    notes.push("Facebook is not connected yet.");
  }
  if (!pageId) {
    notes.push("Facebook Page is not selected.");
  }
  if (!tgToken || !tgChannel) {
    notes.push("Telegram channel is not configured.");
  }

  return {
    enabled: secrets.crossPostEnabled,
    facebook: !!(token && pageId),
    instagram: !!(token && (igId || pageId)),
    telegram: !!(tgToken && tgChannel),
    facebookPageId: pageId || null,
    instagramBusinessId: igId || null,
    telegramChannelId: tgChannel || null,
    telegramChannelUsername: secrets.telegramChannelUsername || null,
    defaultImageUrl: secrets.defaultImageUrl || null,
    notes,
  };
}

async function graphFetch(
  secrets: ResolvedSocialSecrets,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; json: Record<string, unknown>; status: number }> {
  const version = metaGraphVersion();
  const res = await fetch(`https://graph.facebook.com/${version}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secrets.metaAccessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json, status: res.status };
}

const igCache = new Map<string, string>();

async function resolveInstagramBusinessId(
  secrets: ResolvedSocialSecrets,
): Promise<string> {
  if (secrets.instagramBusinessId) return secrets.instagramBusinessId;
  const pageId = secrets.facebookPageId;
  if (!pageId) return "";
  const cached = igCache.get(pageId);
  if (cached) return cached;

  const { ok, json } = await graphFetch(
    secrets,
    `/${pageId}?fields=instagram_business_account`,
  );
  if (!ok) return "";

  const ig = json.instagram_business_account as { id?: string } | undefined;
  const id = ig?.id ?? "";
  if (id) igCache.set(pageId, id);
  return id;
}

function composeCaption(payload: SocialCrossPostPayload): string {
  const lines: string[] = [];
  const title = payload.title.trim();
  const summary = payload.summary?.trim();
  const body = payload.body.trim();

  if (title) lines.push(title);
  if (summary && summary !== title) lines.push(summary);
  if (body && body !== summary) {
    const trimmed = body.length > 1800 ? `${body.slice(0, 1797)}…` : body;
    lines.push(trimmed);
  }
  if (payload.linkUrl) lines.push(payload.linkUrl);

  const school = process.env.NEXT_PUBLIC_SCHOOL_NAME || "BHB International School";
  lines.push(`\n#${school.replace(/\s+/g, "")}`);

  return lines.join("\n\n").trim();
}

function primaryImage(
  secrets: ResolvedSocialSecrets,
  payload: SocialCrossPostPayload,
): string {
  if (payload.imageUrl?.trim()) return payload.imageUrl.trim();
  if (payload.imageUrls?.length) return payload.imageUrls[0]!.trim();
  return secrets.defaultImageUrl;
}

function defaultLinkForKind(kind: SocialCrossPostKind): string {
  const base = appOrigin();
  switch (kind) {
    case "news":
      return `${base}/parent?tab=news`;
    case "gallery":
      return `${base}/parent?tab=gallery`;
    case "notice":
      return `${base}/parent?tab=notices`;
  }
}

async function postToFacebook(
  secrets: ResolvedSocialSecrets,
  payload: SocialCrossPostPayload,
): Promise<SocialPlatformResult> {
  const pageId = secrets.facebookPageId;
  if (!pageId) {
    return { platform: "facebook", ok: false, error: "Facebook Page ID not set" };
  }

  const caption = composeCaption(payload);
  const image = primaryImage(secrets, payload);

  if (image) {
    const { ok, json } = await graphFetch(secrets, `/${pageId}/photos`, {
      method: "POST",
      body: JSON.stringify({ url: image, caption }),
    });
    if (!ok) {
      return {
        platform: "facebook",
        ok: false,
        error: String(
          (json.error as { message?: string } | undefined)?.message ??
            json.message ??
            "Facebook photo post failed",
        ),
      };
    }
    const postId = String(json.id ?? json.post_id ?? "");
    return {
      platform: "facebook",
      ok: true,
      externalPostId: postId,
      postUrl: postId ? `https://facebook.com/${postId}` : undefined,
    };
  }

  const { ok, json } = await graphFetch(secrets, `/${pageId}/feed`, {
    method: "POST",
    body: JSON.stringify({
      message: caption,
      link: payload.linkUrl || defaultLinkForKind(payload.kind),
    }),
  });
  if (!ok) {
    return {
      platform: "facebook",
      ok: false,
      error: String(
        (json.error as { message?: string } | undefined)?.message ??
          json.message ??
          "Facebook feed post failed",
      ),
    };
  }
  const postId = String(json.id ?? "");
  return {
    platform: "facebook",
    ok: true,
    externalPostId: postId,
    postUrl: postId ? `https://facebook.com/${postId}` : undefined,
  };
}

async function postToInstagram(
  secrets: ResolvedSocialSecrets,
  payload: SocialCrossPostPayload,
): Promise<SocialPlatformResult> {
  const igId = await resolveInstagramBusinessId(secrets);
  if (!igId) {
    return {
      platform: "instagram",
      ok: false,
      error: "Instagram Business account not linked to Facebook Page",
    };
  }

  const image = primaryImage(secrets, payload);
  if (!image) {
    return {
      platform: "instagram",
      ok: false,
      error: "Instagram requires an image — add cover or default image in Social settings",
    };
  }

  const caption = composeCaption(payload);

  const create = await graphFetch(secrets, `/${igId}/media`, {
    method: "POST",
    body: JSON.stringify({ image_url: image, caption }),
  });
  if (!create.ok) {
    return {
      platform: "instagram",
      ok: false,
      error: String(
        (create.json.error as { message?: string } | undefined)?.message ??
          "Instagram media create failed",
      ),
    };
  }

  const creationId = String(create.json.id ?? "");
  if (!creationId) {
    return { platform: "instagram", ok: false, error: "No Instagram creation id" };
  }

  const publish = await graphFetch(secrets, `/${igId}/media_publish`, {
    method: "POST",
    body: JSON.stringify({ creation_id: creationId }),
  });
  if (!publish.ok) {
    return {
      platform: "instagram",
      ok: false,
      error: String(
        (publish.json.error as { message?: string } | undefined)?.message ??
          "Instagram publish failed",
      ),
    };
  }

  const mediaId = String(publish.json.id ?? "");
  return {
    platform: "instagram",
    ok: true,
    externalPostId: mediaId,
    postUrl: mediaId ? `https://instagram.com/p/${mediaId}` : undefined,
  };
}

async function postToTelegram(
  secrets: ResolvedSocialSecrets,
  payload: SocialCrossPostPayload,
): Promise<SocialPlatformResult> {
  const token = secrets.telegramBotToken;
  const chatId = secrets.telegramChannelId;
  if (!token || !chatId) {
    return {
      platform: "telegram",
      ok: false,
      error: "Telegram bot token or channel id not set",
    };
  }

  const caption = composeCaption(payload);
  const image = primaryImage(secrets, payload);
  const base = `https://api.telegram.org/bot${token}`;
  const username = secrets.telegramChannelUsername?.replace(/^@/, "");

  if (image) {
    const res = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: image,
        caption: caption.slice(0, 1024),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };
    if (!json.ok) {
      return {
        platform: "telegram",
        ok: false,
        error: json.description || "Telegram sendPhoto failed",
      };
    }
    const msgId = json.result?.message_id;
    return {
      platform: "telegram",
      ok: true,
      externalPostId: msgId ? String(msgId) : "",
      postUrl:
        username && msgId ? `https://t.me/${username}/${msgId}` : undefined,
    };
  }

  const res = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: caption.slice(0, 4096),
      disable_web_page_preview: false,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!json.ok) {
    return {
      platform: "telegram",
      ok: false,
      error: json.description || "Telegram sendMessage failed",
    };
  }
  const msgId = json.result?.message_id;
  return {
    platform: "telegram",
    ok: true,
    externalPostId: msgId ? String(msgId) : "",
    postUrl: username && msgId ? `https://t.me/${username}/${msgId}` : undefined,
  };
}

export async function crossPostCommsContent(
  payload: SocialCrossPostPayload,
): Promise<SocialCrossPostResult> {
  const config = await getSocialCrossPostConfig();
  if (!config.enabled) {
    return { ok: false, results: [], error: "Social cross-post disabled" };
  }

  const secrets = await resolveSocialSecrets();
  const platforms: SocialPlatform[] =
    payload.platforms?.length
      ? payload.platforms
      : (["facebook", "instagram", "telegram"] as SocialPlatform[]);

  const enriched: SocialCrossPostPayload = {
    ...payload,
    linkUrl: payload.linkUrl || defaultLinkForKind(payload.kind),
  };

  const results: SocialPlatformResult[] = [];

  for (const platform of platforms) {
    const configured =
      platform === "facebook"
        ? config.facebook
        : platform === "instagram"
          ? config.instagram
          : config.telegram;

    if (!configured) {
      results.push({
        platform,
        ok: false,
        skipped: true,
        error: `${platform} not configured — add credentials in Comms → Social`,
      });
      continue;
    }

    if (!payload.force) {
      const prior = await findCrossPostLog(
        payload.kind,
        payload.contentId,
        platform,
      );
      if (prior?.status === "posted") {
        results.push({
          platform,
          ok: true,
          skipped: true,
          externalPostId: prior.externalPostId,
          postUrl: prior.postUrl,
        });
        continue;
      }
    }

    try {
      const result =
        platform === "facebook"
          ? await postToFacebook(secrets, enriched)
          : platform === "instagram"
            ? await postToInstagram(secrets, enriched)
            : await postToTelegram(secrets, enriched);
      results.push(result);
      await saveCrossPostLog({
        kind: payload.kind,
        contentId: payload.contentId,
        platform,
        status: result.ok ? "posted" : "failed",
        externalPostId: result.externalPostId,
        postUrl: result.postUrl,
        error: result.error,
        title: payload.title,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      results.push({ platform, ok: false, error: msg });
      await saveCrossPostLog({
        kind: payload.kind,
        contentId: payload.contentId,
        platform,
        status: "failed",
        error: msg,
        title: payload.title,
      });
    }
  }

  const anyOk = results.some((r) => r.ok && !r.skipped);
  return { ok: anyOk || results.some((r) => r.skipped && r.ok), results };
}
