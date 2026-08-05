"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSocialCrossPostConfig,
  loadSocialCrossPostPrefs,
  saveSocialCrossPostPrefs,
  type SocialCrossPostConfig,
  type SocialCrossPostPrefs,
  type SocialPlatform,
} from "@/lib/socialCrossPost";

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "facebook", label: "Facebook Page" },
  { id: "instagram", label: "Instagram" },
  { id: "telegram", label: "Telegram channel" },
];

type Props = {
  /** Compact row for publish forms */
  compact?: boolean;
};

export function SocialCrossPostPrefsPanel({ compact }: Props) {
  const [prefs, setPrefs] = useState<SocialCrossPostPrefs>(() =>
    loadSocialCrossPostPrefs(),
  );
  const [config, setConfig] = useState<SocialCrossPostConfig | null>(null);

  const reloadConfig = useCallback(() => {
    void fetchSocialCrossPostConfig().then(setConfig);
  }, []);

  useEffect(() => {
    reloadConfig();
    function onPrefs() {
      setPrefs(loadSocialCrossPostPrefs());
    }
    window.addEventListener("bhb-social-cross-post-prefs", onPrefs);
    return () => window.removeEventListener("bhb-social-cross-post-prefs", onPrefs);
  }, [reloadConfig]);

  function toggleEnabled() {
    const next = { ...prefs, enabled: !prefs.enabled };
    setPrefs(next);
    saveSocialCrossPostPrefs(next);
  }

  function togglePlatform(platform: SocialPlatform) {
    const has = prefs.platforms.includes(platform);
    const platforms = has
      ? prefs.platforms.filter((p) => p !== platform)
      : [...prefs.platforms, platform];
    const next = {
      ...prefs,
      platforms: platforms.length ? platforms : [platform],
    };
    setPrefs(next);
    saveSocialCrossPostPrefs(next);
  }

  const configured = config
    ? {
        facebook: config.facebook,
        instagram: config.instagram,
        telegram: config.telegram,
      }
    : null;

  if (compact) {
    return (
      <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.18)] bg-[rgba(32,48,80,0.02)] p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={prefs.enabled}
            onChange={toggleEnabled}
          />
          Also cross-post to social
        </label>
        {prefs.enabled ? (
          <div className="mt-2 flex flex-wrap gap-3">
            {PLATFORMS.map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-1.5 text-xs ${
                  configured && !configured[p.id]
                    ? "text-[var(--muted)] line-through"
                    : "text-[var(--brand-deep)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={prefs.platforms.includes(p.id)}
                  onChange={() => togglePlatform(p.id)}
                />
                {p.label}
                {configured && !configured[p.id] ? " (not configured)" : ""}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Social cross-post
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Publish news, gallery albums, and public notices to Facebook Page,
          Instagram Business, and your Telegram channel when you hit Publish.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
        <input type="checkbox" checked={prefs.enabled} onChange={toggleEnabled} />
        Cross-post on publish (default)
      </label>

      <div className="grid gap-2 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const live = configured?.[p.id];
          return (
            <label
              key={p.id}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                live
                  ? "border-[rgba(22,163,74,0.25)] bg-[rgba(22,163,74,0.04)]"
                  : "border-[rgba(180,35,24,0.2)] bg-[rgba(180,35,24,0.04)]"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={prefs.platforms.includes(p.id)}
                onChange={() => togglePlatform(p.id)}
              />
              <span>
                <span className="font-medium text-[var(--brand-deep)]">
                  {p.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                  {live ? "Connected" : "Add in Comms → Social → Connect accounts"}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {config && config.notes.length > 0 ? (
        <div className="space-y-1 text-[11px] text-[var(--muted)]">
          {config.notes.map((n) => (
            <p key={n}>• {n}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
