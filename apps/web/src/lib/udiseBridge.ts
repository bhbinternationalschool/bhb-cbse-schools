/**
 * ERP ↔ Chrome UDISE+ bridge client.
 * Message types stay in sync with apps/udise-bridge-extension/lib/bridge-protocol.js
 */

import {
  getUnlockedCredentials,
  loadUdiseBridgeSettings,
} from "@/lib/udiseVault";
import {
  applyUdiseStudentDetailsSync,
  matrixFromUdiseStudentsFile,
  type UdiseImportResult,
} from "@/lib/udiseStudentDetails";
import { loadMasters } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";

export const UDISE_BRIDGE_MSG = {
  PING: "UDISE_BRIDGE_PING",
  PONG: "UDISE_BRIDGE_PONG",
  OPEN_LOGIN: "UDISE_BRIDGE_OPEN_LOGIN",
  SYNC_STUDENTS: "UDISE_BRIDGE_SYNC_STUDENTS",
  POST_SYNC_PAYLOAD: "UDISE_BRIDGE_POST_SYNC_PAYLOAD",
  SET_PROBE: "UDISE_BRIDGE_SET_PROBE",
} as const;

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export type UdiseBridgePingResult = {
  ok: boolean;
  version?: string;
  probeEnabled?: boolean;
  lastSyncAt?: string;
  error?: string;
};

function extensionId(): string {
  return loadUdiseBridgeSettings().extensionId.trim();
}

function sendToExtension<T = unknown>(
  message: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = extensionId();
    if (!id) {
      reject(new Error("Set Extension ID in Bridge settings first"));
      return;
    }
    if (typeof window === "undefined" || !window.chrome?.runtime?.sendMessage) {
      reject(
        new Error(
          "Chrome extension API unavailable — use Chrome and load the unpacked bridge",
        ),
      );
      return;
    }
    try {
      window.chrome.runtime.sendMessage(id, message, (response) => {
        const err = window.chrome?.runtime?.lastError;
        if (err) {
          reject(new Error(err.message || "Extension not reachable"));
          return;
        }
        resolve(response as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function pingUdiseBridge(): Promise<UdiseBridgePingResult> {
  try {
    const res = await sendToExtension<{
      ok?: boolean;
      type?: string;
      version?: string;
      probeEnabled?: boolean;
      lastSyncAt?: string;
      error?: string;
    }>({ type: UDISE_BRIDGE_MSG.PING });
    if (!res?.ok) {
      return { ok: false, error: res?.error || "Extension replied with error" };
    }
    return {
      ok: true,
      version: res.version,
      probeEnabled: res.probeEnabled,
      lastSyncAt: res.lastSyncAt,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function openUdiseLoginViaBridge(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const creds = getUnlockedCredentials();
  if (!creds) {
    return { ok: false, error: "Unlock the UDISE vault first" };
  }
  const settings = loadUdiseBridgeSettings();
  try {
    await sendToExtension({
      type: UDISE_BRIDGE_MSG.OPEN_LOGIN,
      loginUrl: settings.loginUrl,
      credentials: {
        username: creds.username,
        password: creds.password,
      },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function pullStudentsViaBridge(): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
}> {
  const creds = getUnlockedCredentials();
  const settings = loadUdiseBridgeSettings();
  try {
    const res = await sendToExtension<{
      ok?: boolean;
      message?: string;
      error?: string;
    }>({
      type: UDISE_BRIDGE_MSG.SYNC_STUDENTS,
      loginUrl: settings.loginUrl,
      credentials: creds
        ? { username: creds.username, password: creds.password }
        : undefined,
    });
    if (!res?.ok) {
      return { ok: false, error: res?.error || "Bridge sync failed" };
    }
    return { ok: true, message: res.message };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function setUdiseBridgeProbe(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendToExtension({
      type: UDISE_BRIDGE_MSG.SET_PROBE,
      enabled,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export type BridgeSyncPayload = {
  fileName?: string;
  base64: string;
  mimeType?: string;
};

export async function applyBridgeSyncPayload(
  payload: BridgeSyncPayload,
  academicYearCode?: string,
): Promise<UdiseImportResult & { fileName: string }> {
  const buf = base64ToArrayBuffer(payload.base64);
  const matrix = await matrixFromUdiseStudentsFile(buf);
  const result = applyUdiseStudentDetailsSync(
    matrix,
    loadSis(),
    loadMasters(),
    undefined,
    academicYearCode,
  );
  return {
    ...result,
    fileName: payload.fileName || "Students_Details.xlsx",
  };
}

/**
 * Listen for extension-posted Excel captures. Returns unsubscribe.
 */
export function subscribeUdiseBridgeSyncPayload(
  onPayload: (payload: BridgeSyncPayload) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  function handler(ev: MessageEvent) {
    const data = ev.data as {
      source?: string;
      type?: string;
      payload?: BridgeSyncPayload;
    } | null;
    if (!data || data.source !== "udise-bridge-extension") return;
    if (data.type !== UDISE_BRIDGE_MSG.POST_SYNC_PAYLOAD) return;
    if (!data.payload?.base64) return;
    onPayload(data.payload);
  }

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export function bridgeInstallHint(): string {
  return "Load unpacked: apps/udise-bridge-extension → copy Extension ID → paste below.";
}

/** Re-export for panels that need SIS after sync */
export type { SisState };
