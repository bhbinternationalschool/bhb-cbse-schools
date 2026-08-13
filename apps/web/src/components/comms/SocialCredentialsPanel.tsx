"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, PlugZap } from "lucide-react";
import type { SocialPlatform } from "@/lib/socialCrossPost";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

const btnFacebook =
  "rounded-lg bg-[#1877F2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#166FE5] disabled:opacity-50";

type PendingPage = { id: string; name: string; instagramUsername: string };

type CredentialsPublic = {
  configuredInErp: boolean;
  credentialSource: string;
  crossPostEnabled: boolean;
  metaOAuthAvailable: boolean;
  metaConnectedVia: "" | "oauth" | "manual";
  facebookPageName: string;
  pendingPages: PendingPage[];
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

type Props = {
  onSaved?: () => void;
};

export function SocialCredentialsPanel({ onSaved }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickingPage, setPickingPage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pub, setPub] = useState<CredentialsPublic | null>(null);

  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [facebookPageId, setFacebookPageId] = useState("");
  const [instagramBusinessId, setInstagramBusinessId] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChannelId, setTelegramChannelId] = useState("");
  const [telegramChannelUsername, setTelegramChannelUsername] = useState("");
  const [defaultImageUrl, setDefaultImageUrl] = useState("");
  const [crossPostEnabled, setCrossPostEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testPlatforms, setTestPlatforms] = useState<SocialPlatform[]>([
    "facebook",
    "instagram",
    "telegram",
  ]);

  const reload = useCallback(() => {
    setLoading(true);
    void fetch("/api/integrations/social/credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { credentials?: CredentialsPublic } | null) => {
        const c = j?.credentials ?? null;
        setPub(c);
        if (c) {
          setFacebookPageId(c.facebookPageId);
          setInstagramBusinessId(c.instagramBusinessId);
          setTelegramChannelId(c.telegramChannelId);
          setTelegramChannelUsername(c.telegramChannelUsername);
          setDefaultImageUrl(c.defaultImageUrl);
          setCrossPostEnabled(c.crossPostEnabled);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const metaError = searchParams.get("meta_error");
    const metaConnected = searchParams.get("meta_connected");
    const metaPage = searchParams.get("meta_page");
    const metaPick = searchParams.get("meta_pick_page");

    if (metaError) {
      setError(decodeURIComponent(metaError));
    } else if (metaConnected) {
      setNotice(
        metaPage
          ? `Facebook connected — ${decodeURIComponent(metaPage)}`
          : "Facebook Page connected",
      );
      onSaved?.();
    } else if (metaPick) {
      setNotice("Pick which Facebook Page to use for posting");
    }

    if (metaError || metaConnected || metaPick) {
      const url = new URL(window.location.href);
      url.searchParams.delete("meta_error");
      url.searchParams.delete("meta_connected");
      url.searchParams.delete("meta_page");
      url.searchParams.delete("meta_pick_page");
      router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    }
  }, [searchParams, router, onSaved]);

  async function save() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        facebookPageId,
        instagramBusinessId,
        telegramChannelId,
        telegramChannelUsername,
        defaultImageUrl,
        crossPostEnabled,
      };
      if (metaAccessToken.trim()) body.metaAccessToken = metaAccessToken.trim();
      if (telegramBotToken.trim()) body.telegramBotToken = telegramBotToken.trim();

      const res = await fetch("/api/integrations/social/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        credentials?: CredentialsPublic;
      };
      if (!res.ok) {
        setError(json.error || "Save failed");
        return;
      }
      setPub(json.credentials ?? null);
      setMetaAccessToken("");
      setTelegramBotToken("");
      setNotice(json.message ? `${json.message}` : "Saved");
      onSaved?.();
    } catch {
      setError("Could not save credentials");
    } finally {
      setSaving(false);
    }
  }

  async function selectPage(pageId: string) {
    setPickingPage(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/social/meta-oauth/select-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        credentials?: CredentialsPublic;
      };
      if (!res.ok) {
        setError(json.error || "Could not connect Page");
        return;
      }
      setPub(json.credentials ?? null);
      setNotice(json.message || "Page connected");
      onSaved?.();
    } finally {
      setPickingPage(false);
    }
  }

  async function clearErpCredentials() {
    if (!window.confirm("Clear saved social credentials?")) {
      return;
    }
    await fetch("/api/integrations/social/credentials", { method: "DELETE" });
    reload();
    setNotice("Credentials cleared");
  }

  function toggleTestPlatform(platform: SocialPlatform) {
    setTestPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  }

  async function runTestPost() {
    setTesting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/integrations/social/meta-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: testPlatforms }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setError(json.message || "Test post failed");
        return;
      }
      setNotice(json.message || "Test post sent");
    } catch {
      setError("Could not send test post");
    } finally {
      setTesting(false);
    }
  }

  const metaConnected = pub?.metaTokenSet && !!pub.facebookPageId;
  const telegramOk = !pub?.telegramBotTokenSet || !!pub.telegramChannelId;

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)]">
            <PlugZap className="h-4 w-4" />
            Connect social accounts
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Connect your school Facebook Page and Instagram account, or enter
            tokens manually. Add Telegram below.
          </p>
        </div>
        {pub ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
              metaConnected && telegramOk
                ? "bg-[rgba(22,163,74,0.12)] text-[var(--success)]"
                : metaConnected
                  ? "bg-[rgba(197,160,40,0.15)] text-[#92400e]"
                  : "bg-[rgba(180,35,24,0.1)] text-[var(--danger)]"
            }`}
          >
            {metaConnected ? "Facebook OK" : "Facebook not connected"}
          </span>
        ) : null}
      </div>

      <div className="rounded-xl border border-[rgba(24,119,242,0.2)] bg-[rgba(24,119,242,0.04)] p-3">
        <p className="text-sm font-medium text-[var(--brand-deep)]">
          Facebook & Instagram
        </p>
        {pub?.facebookPageName && pub.metaConnectedVia === "oauth" ? (
          <p className="mt-1 text-xs text-[var(--success)]">
            Connected Page: {pub.facebookPageName}
            {pub.instagramBusinessId ? " · Instagram linked" : ""}
          </p>
        ) : pub?.metaTokenSet ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Token saved {pub.metaTokenHint}
            {pub.facebookPageId ? ` · Page ${pub.facebookPageId}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Sign in with a Facebook account that manages your school Page.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {pub?.metaOAuthAvailable ? (
            <a href="/api/integrations/social/meta-oauth/connect" className={btnFacebook}>
              Connect with Facebook
            </a>
          ) : (
            <p className="text-[11px] text-[var(--muted)]">
              One-click connect is not available. Use manual token entry below.
            </p>
          )}
          {pub?.metaOAuthAvailable && pub.metaConnectedVia === "oauth" ? (
            <a
              href="/api/integrations/social/meta-oauth/connect"
              className={btnOutline}
            >
              Reconnect
            </a>
          ) : null}
        </div>
      </div>

      {pub?.pendingPages && pub.pendingPages.length > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
          <p className="text-sm font-medium text-[var(--brand-deep)]">
            Choose a Facebook Page
          </p>
          <ul className="mt-2 space-y-2">
            {pub.pendingPages.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`${btnOutline} w-full justify-start text-left`}
                  disabled={pickingPage}
                  onClick={() => void selectPage(p.id)}
                >
                  {p.name}
                  {p.instagramUsername ? ` · @${p.instagramUsername}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="text-sm text-[var(--brand-deep)]">
        <summary className="cursor-pointer font-medium">
          Advanced — paste Meta token manually
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--muted)] sm:col-span-2">
            Meta Page access token
            <input
              type="password"
              className={`${field} mt-1`}
              value={metaAccessToken}
              onChange={(e) => setMetaAccessToken(e.target.value)}
              placeholder={pub?.metaTokenSet ? "Leave blank to keep" : "EAAG…"}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Facebook Page ID
            <input
              className={`${field} mt-1`}
              value={facebookPageId}
              onChange={(e) => setFacebookPageId(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Instagram Business ID (optional)
            <input
              className={`${field} mt-1`}
              value={instagramBusinessId}
              onChange={(e) => setInstagramBusinessId(e.target.value)}
            />
          </label>
        </div>
      </details>

      {!loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--muted)] sm:col-span-2">
            Telegram bot token
            {pub?.telegramBotTokenSet ? (
              <span className="ml-2 text-[var(--success)]">saved {pub.telegramBotTokenHint}</span>
            ) : null}
            <input
              type="password"
              className={`${field} mt-1`}
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
              placeholder="From @BotFather"
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Telegram channel ID
            <input
              className={`${field} mt-1`}
              value={telegramChannelId}
              onChange={(e) => setTelegramChannelId(e.target.value)}
              placeholder="@YourSchoolChannel"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Channel username (optional)
            <input
              className={`${field} mt-1`}
              value={telegramChannelUsername}
              onChange={(e) => setTelegramChannelUsername(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)] sm:col-span-2">
            Default image URL (Instagram)
            <input
              className={`${field} mt-1`}
              value={defaultImageUrl}
              onChange={(e) => setDefaultImageUrl(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={crossPostEnabled}
              onChange={(e) => setCrossPostEnabled(e.target.checked)}
            />
            Enable cross-posting when publishing
          </label>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save Telegram & settings"}
        </button>
        {pub?.configuredInErp ? (
          <button type="button" className={btnOutline} onClick={() => void clearErpCredentials()}>
            Clear saved credentials
          </button>
        ) : null}
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <p className="text-sm font-medium text-[var(--brand-deep)]">Test post</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Send a short test message to confirm each channel works.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {(["facebook", "instagram", "telegram"] as SocialPlatform[]).map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={testPlatforms.includes(p)}
                onChange={() => toggleTestPlatform(p)}
              />
              {p}
            </label>
          ))}
        </div>
        <button
          type="button"
          className={`${btn} mt-3`}
          disabled={testing || !testPlatforms.length}
          onClick={() => void runTestPost()}
        >
          {testing ? "Sending…" : "Send test post"}
        </button>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(22,163,74,0.12)] px-3 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[rgba(180,35,24,0.1)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
