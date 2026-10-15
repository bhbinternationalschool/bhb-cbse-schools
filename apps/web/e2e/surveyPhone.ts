/**
 * A survey phone for tests: an ECDSA P-256 key, and POST /api/public/survey-day
 * signed exactly as the staff app signs it (cbse_school_mobile
 * PunchDeviceKey.surveyMessage + sign: `survey|<action>|<extra>|<ts>`,
 * signature r‖s base64url — WebCrypto's ECDSA output is already r‖s).
 */
import { webcrypto } from "node:crypto";

export type SurveyPhone = {
  jwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  call: (
    baseUrl: string,
    action: string,
    opts?: { extra?: string; body?: Record<string, unknown>; geo?: Record<string, unknown> | null; ts?: number },
  ) => Promise<{ status: number; json: Record<string, unknown> | null; text: string }>;
};

export async function newSurveyPhone(): Promise<SurveyPhone> {
  const pair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const full = (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as { x: string; y: string };
  const jwk = { kty: "EC" as const, crv: "P-256" as const, x: full.x, y: full.y };
  const sign = async (msg: string) =>
    Buffer.from(
      await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(msg)),
    ).toString("base64url");
  return {
    jwk,
    async call(baseUrl, action, opts = {}) {
      const ts = opts.ts ?? Date.now();
      const extra = opts.extra ?? "";
      const signature = await sign(`survey|${action}|${extra}|${ts}`);
      const geo =
        opts.geo === null
          ? undefined
          : (opts.geo ?? { lat: 25.3176, lng: 82.9739, accuracyM: 12, mocked: false });
      const res = await fetch(`${baseUrl}/api/public/survey-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(geo ? { geo } : {}), ...opts.body, device: { jwk, signature, ts, label: "test phone" } }),
      });
      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = null;
      }
      return { status: res.status, json, text };
    },
  };
}
