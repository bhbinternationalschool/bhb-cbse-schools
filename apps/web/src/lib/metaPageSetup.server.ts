/**
 * Meta Facebook Page + Instagram setup validation (uses ERP or env credentials).
 */

import {
  resolveSocialSecrets,
  type ResolvedSocialSecrets,
} from "@/lib/socialIntegrations.server";
import { crossPostCommsContent } from "@/lib/socialCrossPost.server";
import type { SocialPlatform } from "@/lib/socialCrossPost.types";

const REQUIRED_PERMISSIONS = [
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
] as const;

function metaGraphVersion(): string {
  return (
    process.env.SOCIAL_GRAPH_API_VERSION ||
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

async function graphGet(
  secrets: ResolvedSocialSecrets,
  path: string,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const version = metaGraphVersion();
  const res = await fetch(`https://graph.facebook.com/${version}${path}`, {
    headers: { Authorization: `Bearer ${secrets.metaAccessToken}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

export type MetaSetupStep = {
  id: string;
  label: string;
  done: boolean;
  hint?: string;
};

export type MetaPageSetupReport = {
  credentialSource: string;
  tokenPresent: boolean;
  tokenValid: boolean;
  pageId: string | null;
  pageName: string | null;
  pageLink: string | null;
  instagramBusinessId: string | null;
  instagramUsername: string | null;
  permissions: string[];
  missingPermissions: string[];
  steps: MetaSetupStep[];
  issues: string[];
  fixes: string[];
};

export async function getMetaPageSetupReport(): Promise<MetaPageSetupReport> {
  const secrets = await resolveSocialSecrets();
  const token = secrets.metaAccessToken;
  const pageId = secrets.facebookPageId;
  const issues: string[] = [];
  const fixes: string[] = [];
  const steps: MetaSetupStep[] = [];

  steps.push({
    id: "credentials",
    label: "Social credentials saved in ERP or server env",
    done: secrets.credentialSource !== "none",
    hint:
      secrets.credentialSource === "none"
        ? "Open Comms → Social → Connect accounts"
        : `Source: ${secrets.credentialSource}`,
  });

  steps.push({
    id: "token",
    label: "Meta access token",
    done: !!token,
    hint: "Long-lived Facebook Page token from Meta Business Suite",
  });

  steps.push({
    id: "page_id",
    label: "Facebook Page ID",
    done: !!pageId,
  });

  if (!token) {
    issues.push("No Meta access token — enter in ERP Social settings");
    fixes.push(
      "Communications → Social → Meta access token → Save & connect",
    );
    return {
      credentialSource: secrets.credentialSource,
      tokenPresent: false,
      tokenValid: false,
      pageId: pageId || null,
      pageName: null,
      pageLink: null,
      instagramBusinessId: secrets.instagramBusinessId || null,
      instagramUsername: null,
      permissions: [],
      missingPermissions: [...REQUIRED_PERMISSIONS],
      steps,
      issues,
      fixes,
    };
  }

  const debug = await graphGet(
    secrets,
    "/debug_token?input_token=" + encodeURIComponent(token),
  );
  const debugData = debug.json.data as
    | { is_valid?: boolean; scopes?: string[] }
    | undefined;
  const tokenValid = debug.ok && debugData?.is_valid === true;
  const permissions = (debugData?.scopes ?? []).map(String);

  steps.push({
    id: "token_valid",
    label: "Token validates with Meta",
    done: tokenValid,
    hint: tokenValid ? undefined : "Regenerate Page token in Meta Business Suite",
  });

  if (!tokenValid) {
    issues.push("Meta token failed validation");
    fixes.push("Generate a new long-lived Page access token and save in ERP");
  }

  const missingPermissions = REQUIRED_PERMISSIONS.filter(
    (p) => !permissions.includes(p),
  );
  steps.push({
    id: "permissions",
    label: "Required Graph permissions",
    done: missingPermissions.length === 0,
    hint: missingPermissions.length
      ? `Missing: ${missingPermissions.join(", ")}`
      : undefined,
  });

  let pageName: string | null = null;
  let pageLink: string | null = null;
  let instagramBusinessId: string | null = secrets.instagramBusinessId || null;
  let instagramUsername: string | null = null;

  if (pageId && tokenValid) {
    const page = await graphGet(
      secrets,
      `/${pageId}?fields=name,link,instagram_business_account{id,username}`,
    );
    if (page.ok) {
      pageName = String(page.json.name ?? "") || null;
      pageLink = String(page.json.link ?? "") || null;
      const ig = page.json.instagram_business_account as
        | { id?: string; username?: string }
        | undefined;
      if (ig?.id) {
        instagramBusinessId = instagramBusinessId || ig.id;
        instagramUsername = ig.username ? String(ig.username) : null;
      }
      steps.push({
        id: "page_reachable",
        label: `Page reachable${pageName ? `: ${pageName}` : ""}`,
        done: true,
      });
    } else {
      issues.push("Cannot read Facebook Page — check Page ID in ERP settings");
      fixes.push("Verify SOCIAL_FACEBOOK_PAGE_ID / ERP Facebook Page ID field");
      steps.push({ id: "page_reachable", label: "Page reachable", done: false });
    }
  }

  steps.push({
    id: "instagram_linked",
    label: "Instagram Business linked",
    done: !!instagramBusinessId,
    hint: instagramUsername ? `@${instagramUsername}` : undefined,
  });

  steps.push({
    id: "telegram",
    label: "Telegram channel configured",
    done: !!(secrets.telegramBotToken && secrets.telegramChannelId),
  });

  return {
    credentialSource: secrets.credentialSource,
    tokenPresent: !!token,
    tokenValid,
    pageId: pageId || null,
    pageName,
    pageLink,
    instagramBusinessId,
    instagramUsername,
    permissions,
    missingPermissions: [...missingPermissions],
    steps,
    issues,
    fixes,
  };
}

export async function runSocialTestPost(
  platforms?: SocialPlatform[],
): Promise<{
  ok: boolean;
  message: string;
  results: Awaited<ReturnType<typeof crossPostCommsContent>>["results"];
}> {
  const school = process.env.NEXT_PUBLIC_SCHOOL_NAME || "BHB International School";
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const secrets = await resolveSocialSecrets();

  const result = await crossPostCommsContent({
    kind: "news",
    contentId: `test_${Date.now()}`,
    title: `[TEST] ${school} social connected`,
    body: `Test post from school ERP.\n\nTime: ${stamp}\n\nSafe to delete.`,
    summary: "ERP social test",
    imageUrl: secrets.defaultImageUrl || undefined,
    platforms,
    force: true,
  });

  const anyPosted = result.results.some((r) => r.ok && !r.skipped);
  return {
    ok: anyPosted,
    message: anyPosted
      ? "Test post sent — check Facebook, Instagram, and Telegram"
      : result.results.map((r) => `${r.platform}: ${r.error || "failed"}`).join("; "),
    results: result.results,
  };
}
