/**
 * Encrypted UDISE+ SDMS credential vault (AES-GCM + PBKDF2 passphrase).
 * Ciphertext in localStorage; unlocked plaintext only in sessionStorage (TTL).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
const VAULT_KEY = "bhb_udise_vault_v1";
const SESSION_KEY = "bhb_udise_vault_session_v1";
const SETTINGS_KEY = "bhb_udise_bridge_settings_v1";
const SESSION_TTL_MS = 45 * 60 * 1000; // 45 minutes

export type UdiseVaultCredentials = {
  username: string;
  password: string;
  schoolUdiseCode: string;
  label: string;
};

export type UdiseVaultStored = {
  v: 1;
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  /** Non-secret metadata */
  usernameHint: string;
  schoolUdiseCode: string;
  label: string;
  updatedAt: string;
};

export type UdiseBridgeSettings = {
  /** Chrome extension ID after unpacked load */
  extensionId: string;
  /** SDMS login URL */
  loginUrl: string;
};

type SessionBlob = {
  credentials: UdiseVaultCredentials;
  unlockedAt: number;
  expiresAt: number;
};

function defaultBridgeSettings(): UdiseBridgeSettings {
  return {
    extensionId: "",
    loginUrl: "https://sdms.udiseplus.gov.in/p2/v1/login",
  };
}

export function loadUdiseBridgeSettings(): UdiseBridgeSettings {
  if (typeof window === "undefined") return defaultBridgeSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultBridgeSettings();
    const p = JSON.parse(raw) as Partial<UdiseBridgeSettings>;
    return {
      ...defaultBridgeSettings(),
      ...p,
      extensionId: (p.extensionId || "").trim(),
      loginUrl:
        (p.loginUrl || "").trim() || defaultBridgeSettings().loginUrl,
    };
  } catch {
    return defaultBridgeSettings();
  }
}

export function saveUdiseBridgeSettings(
  patch: Partial<UdiseBridgeSettings>,
): UdiseBridgeSettings {
  if (!assertModulePermission("compliance", "edit", "saveUdiseBridgeSettings")) {
    return loadUdiseBridgeSettings();
  }
  const next = { ...loadUdiseBridgeSettings(), ...patch };
  next.extensionId = (next.extensionId || "").trim();
  next.loginUrl =
    (next.loginUrl || "").trim() || defaultBridgeSettings().loginUrl;
  if (typeof window !== "undefined") {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }
  return next;
}

function b64Encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const saltBuf = new Uint8Array(salt);
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuf,
      iterations: 210_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function hasUdiseVault(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(VAULT_KEY);
}

export function loadUdiseVaultMeta(): UdiseVaultStored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UdiseVaultStored;
  } catch {
    return null;
  }
}

export async function saveUdiseVault(
  passphrase: string,
  credentials: UdiseVaultCredentials,
): Promise<UdiseVaultStored> {
  if (!assertModulePermission("compliance", "edit", "saveUdiseVault")) {
    throw new Error("Selected academic session is closed — vault is read-only");
  }
  if (!passphrase.trim()) throw new Error("Passphrase is required");
  if (!credentials.username.trim() || !credentials.password) {
    throw new Error("UDISE username and password are required");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase.trim(), salt);
  const payload = JSON.stringify({
    username: credentials.username.trim(),
    password: credentials.password,
    schoolUdiseCode: (credentials.schoolUdiseCode || "").trim(),
    label: (credentials.label || "").trim() || "School SDMS",
  } satisfies UdiseVaultCredentials);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(payload),
  );
  const stored: UdiseVaultStored = {
    v: 1,
    saltB64: b64Encode(salt),
    ivB64: b64Encode(iv),
    cipherB64: b64Encode(cipher),
    usernameHint: credentials.username.trim().slice(0, 4) + "…",
    schoolUdiseCode: (credentials.schoolUdiseCode || "").trim(),
    label: (credentials.label || "").trim() || "School SDMS",
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(stored));
  await unlockUdiseVault(passphrase.trim());
  return stored;
}

export async function unlockUdiseVault(
  passphrase: string,
): Promise<UdiseVaultCredentials> {
  const stored = loadUdiseVaultMeta();
  if (!stored) throw new Error("No vault saved — set UDISE credentials first");
  if (!passphrase.trim()) throw new Error("Passphrase is required");
  const salt = new Uint8Array(b64Decode(stored.saltB64));
  const iv = new Uint8Array(b64Decode(stored.ivB64));
  const cipher = new Uint8Array(b64Decode(stored.cipherB64));
  const key = await deriveKey(passphrase.trim(), salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
  } catch {
    throw new Error("Wrong passphrase");
  }
  const credentials = JSON.parse(
    new TextDecoder().decode(plain),
  ) as UdiseVaultCredentials;
  const now = Date.now();
  const session: SessionBlob = {
    credentials,
    unlockedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return credentials;
}

export function lockUdiseVault(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function getUnlockedCredentials(): UdiseVaultCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SessionBlob;
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session.credentials;
  } catch {
    return null;
  }
}

export function isVaultUnlocked(): boolean {
  return !!getUnlockedCredentials();
}

export function vaultStatus(): "missing" | "locked" | "unlocked" {
  if (!hasUdiseVault()) return "missing";
  return isVaultUnlocked() ? "unlocked" : "locked";
}

export function clearUdiseVault(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(VAULT_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}
