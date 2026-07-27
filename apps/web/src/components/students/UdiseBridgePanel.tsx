"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyBridgeSyncPayload,
  bridgeInstallHint,
  openUdiseLoginViaBridge,
  pingUdiseBridge,
  pullStudentsViaBridge,
  setUdiseBridgeProbe,
  subscribeUdiseBridgeSyncPayload,
} from "@/lib/udiseBridge";
import {
  clearUdiseVault,
  getUnlockedCredentials,
  hasUdiseVault,
  loadUdiseBridgeSettings,
  loadUdiseVaultMeta,
  lockUdiseVault,
  saveUdiseBridgeSettings,
  saveUdiseVault,
  unlockUdiseVault,
  vaultStatus,
  type UdiseBridgeSettings,
} from "@/lib/udiseVault";
import { useSessionReadOnly } from "@/components/shell/SessionContext";
import type { SisState } from "@/lib/sis";

export function UdiseBridgePanel({
  academicYearCode,
  onApplied,
}: {
  academicYearCode: string;
  onApplied: (sis: SisState, message: string) => void;
}) {
  const readOnly = useSessionReadOnly();
  const [settings, setSettings] = useState<UdiseBridgeSettings>(() =>
    loadUdiseBridgeSettings(),
  );
  const [status, setStatus] = useState(() => vaultStatus());
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlashMsg] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [unlockPhrase, setUnlockPhrase] = useState("");

  const refresh = useCallback(() => {
    setSettings(loadUdiseBridgeSettings());
    setStatus(vaultStatus());
    const meta = loadUdiseVaultMeta();
    if (meta) {
      setSchoolCode(meta.schoolUdiseCode || "");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeUdiseBridgeSyncPayload((payload) => {
      void (async () => {
        setBusy(true);
        try {
          const result = await applyBridgeSyncPayload(
            payload,
            academicYearCode,
          );
          const msg = `Bridge import · matched ${result.matched} · updated ${result.updated} · unmatched ${result.unmatched}`;
          onApplied(result.state, msg);
          setFlashMsg(msg);
        } catch (e) {
          setFlashMsg(e instanceof Error ? e.message : "Sync failed");
        } finally {
          setBusy(false);
        }
      })();
    });
  }, [academicYearCode, onApplied]);

  function show(msg: string) {
    setFlashMsg(msg);
    window.setTimeout(() => setFlashMsg(null), 5000);
  }

  async function onDetect() {
    setBusy(true);
    setDetectNote(null);
    const r = await pingUdiseBridge();
    setBusy(false);
    if (r.ok) {
      setDetectNote(
        `Connected · v${r.version || "?"} · last sync ${r.lastSyncAt || "—"}`,
      );
      show("Extension detected");
    } else {
      setDetectNote(r.error || "Not found");
      show(r.error || "Extension not detected");
    }
  }

  async function onSaveSettings() {
    if (readOnly) return;
    const next = saveUdiseBridgeSettings({
      extensionId: settings.extensionId,
      loginUrl: settings.loginUrl,
    });
    setSettings(next);
    show("Bridge settings saved");
  }

  async function onSaveVault() {
    if (readOnly) return;
    setBusy(true);
    try {
      await saveUdiseVault(passphrase, {
        username,
        password,
        schoolUdiseCode: schoolCode,
        label: "School SDMS",
      });
      setPassword("");
      setPassphrase("");
      refresh();
      show("Encrypted vault saved · session unlocked");
    } catch (e) {
      show(e instanceof Error ? e.message : "Vault save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock() {
    setBusy(true);
    try {
      await unlockUdiseVault(unlockPhrase);
      setUnlockPhrase("");
      refresh();
      show("Vault unlocked (45 min)");
    } catch (e) {
      show(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  async function onOpenLogin() {
    setBusy(true);
    const r = await openUdiseLoginViaBridge();
    setBusy(false);
    show(r.ok ? "Opened UDISE+ login — solve CAPTCHA manually" : r.error || "Failed");
  }

  async function onPull() {
    setBusy(true);
    const r = await pullStudentsViaBridge();
    setBusy(false);
    show(r.ok ? r.message || "Armed capture — export Excel from SDMS" : r.error || "Failed");
  }

  async function onProbe(enabled: boolean) {
    const r = await setUdiseBridgeProbe(enabled);
    show(r.ok ? `Network probe ${enabled ? "on" : "off"}` : r.error || "Failed");
  }

  const unlocked = !!getUnlockedCredentials();
  const meta = loadUdiseVaultMeta();

  return (
    <div className="space-y-4 rounded-xl border border-[rgba(32,48,80,0.14)] bg-white/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            UDISE+ Bridge
          </h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Chrome extension autofills SDMS login (CAPTCHA manual) and captures
            Students_Details Excel into SIS. {bridgeInstallHint()}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            status === "unlocked"
              ? "bg-[#0f7a4c]/15 text-[#0f7a4c]"
              : status === "locked"
                ? "bg-[#8a5a10]/15 text-[#8a5a10]"
                : "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]"
          }`}
        >
          Vault {status}
        </span>
      </div>

      {flash ? (
        <p className="text-[12px] text-[var(--brand-deep)]" role="status">
          {flash}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px]">
          <span className="mb-1 block text-[var(--muted)]">Extension ID</span>
          <input
            value={settings.extensionId}
            disabled={readOnly}
            onChange={(e) =>
              setSettings((s) => ({ ...s, extensionId: e.target.value.trim() }))
            }
            placeholder="32-char Chrome extension id"
            className="w-full rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 font-mono text-[11px]"
          />
        </label>
        <label className="block text-[12px]">
          <span className="mb-1 block text-[var(--muted)]">SDMS login URL</span>
          <input
            value={settings.loginUrl}
            disabled={readOnly}
            onChange={(e) =>
              setSettings((s) => ({ ...s, loginUrl: e.target.value }))
            }
            className="w-full rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[11px]"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={readOnly || busy}
          onClick={() => void onSaveSettings()}
          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          Save bridge settings
        </button>
        <button
          type="button"
          disabled={busy || !settings.extensionId}
          onClick={() => void onDetect()}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
        >
          Detect extension
        </button>
        {detectNote ? (
          <span className="self-center text-[11px] text-[var(--muted)]">
            {detectNote}
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border border-dashed border-[rgba(32,48,80,0.2)] p-3">
        <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
          Credential vault
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Passphrase encrypts locally (AES-GCM). Never sent to the server.
          {meta
            ? ` · Saved ${meta.usernameHint} · ${meta.schoolUdiseCode || "no UDISE code"}`
            : ""}
        </p>
        {!hasUdiseVault() || status === "missing" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              value={username}
              disabled={readOnly}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="UDISE username"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[12px]"
            />
            <input
              type="password"
              value={password}
              disabled={readOnly}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="UDISE password"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[12px]"
            />
            <input
              value={schoolCode}
              disabled={readOnly}
              onChange={(e) => setSchoolCode(e.target.value)}
              placeholder="School UDISE code"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[12px]"
            />
            <input
              type="password"
              value={passphrase}
              disabled={readOnly}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="New vault passphrase"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[12px]"
            />
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => void onSaveVault()}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white sm:col-span-2 disabled:opacity-50"
            >
              Save encrypted vault
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {!unlocked ? (
              <>
                <input
                  type="password"
                  value={unlockPhrase}
                  onChange={(e) => setUnlockPhrase(e.target.value)}
                  placeholder="Passphrase to unlock"
                  className="min-w-[180px] flex-1 rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-2 text-[12px]"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onUnlock()}
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  Unlock
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  lockUdiseVault();
                  refresh();
                  show("Vault locked");
                }}
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
              >
                Lock now
              </button>
            )}
            {!readOnly ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear vault? You will need to re-enter UDISE credentials.",
                    )
                  ) {
                    clearUdiseVault();
                    refresh();
                    show("Vault cleared");
                  }
                }}
                className="rounded-lg border border-[#b42318]/40 px-3 py-1.5 text-[11px] font-semibold text-[#b42318]"
              >
                Clear vault
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !unlocked || !settings.extensionId}
          onClick={() => void onOpenLogin()}
          className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          Open UDISE+ (autofill)
        </button>
        <button
          type="button"
          disabled={busy || !settings.extensionId}
          onClick={() => void onPull()}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[12px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
        >
          Pull Students_Details via bridge
        </button>
        <button
          type="button"
          disabled={busy || !settings.extensionId}
          onClick={() => void onProbe(true)}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
        >
          Probe on
        </button>
        <button
          type="button"
          disabled={busy || !settings.extensionId}
          onClick={() => void onProbe(false)}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
        >
          Probe off
        </button>
      </div>
    </div>
  );
}
