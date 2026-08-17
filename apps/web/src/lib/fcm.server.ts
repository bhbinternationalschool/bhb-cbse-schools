/**
 * Firebase Cloud Messaging (HTTP v1) for the Flutter app. Device tokens
 * live in public.push_device_tokens keyed by the same subject pair as
 * Web Push (subject_type/subject_id) so one sendPushToSubject() call fans
 * out to browsers *and* phones.
 *
 * Auth: Application Default Credentials via google-auth-library — on Cloud
 * Run that is the runtime service account (same GCP project as the Firebase
 * project, so no key file needed); locally it is `gcloud auth
 * application-default login`, or GOOGLE_APPLICATION_CREDENTIALS. Sending is
 * best-effort and never throws — WhatsApp stays the primary channel.
 */

import { GoogleAuth } from "google-auth-library";
import { getServerTenantContext } from "@/lib/serverTenant";

const FCM_PROJECT_ID =
  process.env.FCM_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  "school-erp-prod-493619";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!auth) auth = new GoogleAuth({ scopes: [FCM_SCOPE] });
  return auth;
}

/**
 * ADC first (Cloud Run runtime SA / GOOGLE_APPLICATION_CREDENTIALS / gcloud
 * application-default). Outside production only, fall back to the gcloud
 * CLI's own credential — the ADC user token on a dev Mac routinely expires
 * (`invalid_rapt`) while `gcloud auth print-access-token` keeps working.
 */
async function getAccessToken(): Promise<string | null> {
  try {
    const client = await getAuth().getClient();
    const t = await client.getAccessToken();
    if (t.token) return t.token;
  } catch (e) {
    console.warn("[fcm] ADC token failed:", (e as Error)?.message?.slice(0, 120));
  }
  if (process.env.NODE_ENV === "production") return null;
  try {
    const { execFileSync } = await import("child_process");
    const out = execFileSync("gcloud", ["auth", "print-access-token"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return process.env.FCM_DISABLED !== "1" && !!FCM_PROJECT_ID;
}

export type DeviceTokenRow = {
  id: string;
  token: string;
  platform: string;
};

export type FcmPayload = {
  title: string;
  body: string;
  /** In-app deep link, e.g. "/homework", "/chat?studentId=…". */
  url?: string;
  /** Extra string data forwarded verbatim to the app. */
  data?: Record<string, string>;
};

function tokenRowId(token: string): string {
  return `fcm_${Buffer.from(token).toString("base64url").slice(0, 48)}`;
}

export async function upsertDeviceToken(input: {
  subjectType: string;
  subjectId: string;
  token: string;
  platform?: string;
  appVersion?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const { error } = await ctx.sb.from("push_device_tokens").upsert(
    {
      id: tokenRowId(input.token),
      tenant_id: ctx.tenantId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      token: input.token,
      platform: input.platform || "",
      app_version: input.appVersion || "",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDeviceToken(token: string): Promise<{ ok: boolean }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false };
  await ctx.sb.from("push_device_tokens").delete().eq("token", token);
  return { ok: true };
}

async function listTokensForSubject(
  subjectType: string,
  subjectId: string,
): Promise<DeviceTokenRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("push_device_tokens")
    .select("id, token, platform")
    .eq("tenant_id", ctx.tenantId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId);
  if (error || !data) return [];
  return data as DeviceTokenRow[];
}

type SendOutcome = "sent" | "expired" | "failed";

async function sendOne(
  accessToken: string,
  token: string,
  payload: FcmPayload,
): Promise<{ outcome: SendOutcome; error?: string }> {
  const data: Record<string, string> = {
    ...(payload.data || {}),
    title: payload.title,
    body: payload.body,
    url: payload.url || "",
  };
  const message = {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data,
      android: {
        priority: "HIGH",
        // No click_action: firebase_messaging ≥7 opens the launcher activity
        // itself and surfaces the tap via onMessageOpenedApp/getInitialMessage.
        notification: {
          channel_id: "bhb_default",
          sound: "default",
        },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
      },
    },
  };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": FCM_PROJECT_ID,
      },
      body: JSON.stringify(message),
    },
  );
  if (res.ok) return { outcome: "sent" };
  const text = await res.text().catch(() => "");
  // UNREGISTERED (404) / invalid-argument on the token → device gone.
  if (
    res.status === 404 ||
    /UNREGISTERED|registration-token-not-registered|InvalidRegistration/i.test(text)
  ) {
    return { outcome: "expired", error: text };
  }
  return { outcome: "failed", error: `${res.status} ${text.slice(0, 300)}` };
}

/**
 * Push one payload to every app install registered for a subject. Dead
 * tokens are deleted; other failures are logged and skipped. Never throws.
 */
export async function sendFcmToSubject(
  subjectType: string,
  subjectId: string,
  payload: FcmPayload,
): Promise<{ sent: number; expired: number; failed: number }> {
  const zero = { sent: 0, expired: 0, failed: 0 };
  if (!fcmConfigured() || !subjectId) return zero;
  const tokens = await listTokensForSubject(subjectType, subjectId);
  if (tokens.length === 0) return zero;

  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.warn("[fcm] no credentials — skipping push");
    return { ...zero, failed: tokens.length };
  }

  const out = { ...zero };
  for (const row of tokens) {
    try {
      const r = await sendOne(accessToken, row.token, payload);
      if (r.outcome === "sent") out.sent += 1;
      else if (r.outcome === "expired") {
        await deleteDeviceToken(row.token);
        out.expired += 1;
      } else {
        console.warn("[fcm] send failed", r.error);
        out.failed += 1;
      }
    } catch (e) {
      console.warn("[fcm] send threw", (e as Error)?.message);
      out.failed += 1;
    }
  }
  return out;
}

/**
 * Fan one payload out to many subjects of the same type (e.g. every
 * household in a section). Sequential on purpose — this runs inside API
 * routes and a class is at most a few dozen households.
 */
export async function sendFcmToSubjects(
  subjectType: string,
  subjectIds: string[],
  payload: FcmPayload,
): Promise<{ sent: number; expired: number; failed: number }> {
  const out = { sent: 0, expired: 0, failed: 0 };
  for (const id of new Set(subjectIds.filter(Boolean))) {
    const r = await sendFcmToSubject(subjectType, id, payload);
    out.sent += r.sent;
    out.expired += r.expired;
    out.failed += r.failed;
  }
  return out;
}
