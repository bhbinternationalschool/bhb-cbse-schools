"use client";

/**
 * The phone's side of the proxy-proof punch (director, 30 Sep 2026).
 *
 * This browser makes one ECDSA P-256 key pair, the private half
 * NON-EXTRACTABLE (no script, not even ours, can read it out), and keeps it
 * in IndexedDB. The school registers the public half to the staff member on
 * their first punch; afterwards a punch counts only when this key signs it.
 * A colleague handed the login has a different browser, so a different key.
 *
 * Clearing the browser's site data deletes the key — the next punch is then
 * "a new phone" and waits for the office. That is the intended cost.
 */

const DB = "bhb-punch";
const STORE = "keys";
const KEY = "device-v1";

type Pair = { publicKey: CryptoKey; privateKey: CryptoKey };

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

async function devicePair(): Promise<Pair> {
  const have = await idb<Pair | undefined>("readonly", (s) => s.get(KEY)).catch(() => undefined);
  if (have?.privateKey && have.publicKey) return have;
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as Pair;
  await idb("readwrite", (s) => s.put(pair, KEY));
  return pair;
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS/i.test(ua)
          ? "Mac"
          : "Phone";
  const br = /SamsungBrowser/i.test(ua)
    ? "Samsung Internet"
    : /Edg\//i.test(ua)
      ? "Edge"
      : /Firefox|FxiOS/i.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari/i.test(ua)
            ? "Safari"
            : "browser";
  const model = ua.match(/Android [\d.]+; ([^;)]+)[;)]/)?.[1]?.trim();
  return [os, model && model !== "K" ? model : null, br].filter(Boolean).join(" · ");
}

export type QrPunchResult =
  | { ok: true; kind: "in" | "out"; time: string; status?: string; firstRegistration?: boolean }
  | { ok: false; error: string; code?: string };

/** Sign and send one punch. `code` = the six digits (or the QR link). */
export async function submitQrPunch(input: {
  staffId: string;
  kind: "in" | "out";
  code: string;
}): Promise<QrPunchResult> {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof indexedDB === "undefined") {
    return {
      ok: false,
      error: "This browser cannot keep a secure key. Open the ERP in Chrome (or Safari on iPhone) and try again.",
    };
  }
  let pair: Pair;
  try {
    pair = await devicePair();
  } catch {
    return {
      ok: false,
      error: "This browser would not store the phone's key (private / incognito mode?). Open the ERP in a normal window.",
    };
  }
  // Inside the school, or no punch (director, 3 Oct 2026).
  const { readDeviceLocation } = await import("@/lib/deviceLocation");
  const here = await readDeviceLocation();
  if ("error" in here) return { ok: false, error: here.error };
  const code = input.code.replace(/\D/g, "");
  const ts = Date.now();
  const message = `punch|${input.staffId}|${input.kind}|${code}|${ts}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(message),
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  try {
    const res = await fetch("/api/v1/staff/attendance/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: input.kind,
        code,
        lat: here.lat,
        lng: here.lng,
        accuracyM: here.accuracyM,
        device: {
          jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
          signature: b64url(sig),
          ts,
          label: deviceLabel(),
        },
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: { kind: "in" | "out"; time: string; status?: string; firstRegistration?: boolean };
      error?: { message?: string; code?: string };
    } | null;
    if (!res.ok || !body?.ok || !body.data) {
      return {
        ok: false,
        error: body?.error?.message || "Punch was NOT saved — please try again.",
        code: body?.error?.code,
      };
    }
    return { ok: true, ...body.data };
  } catch {
    return { ok: false, error: "Punch was NOT saved — could not reach the school server." };
  }
}
