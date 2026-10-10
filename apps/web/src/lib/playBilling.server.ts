/**
 * Google Play Billing — verifying a purchase server-side.
 *
 * Play requires its own billing system for digital content consumed inside an
 * app distributed through Play. A tutor pass is exactly that, so the Play
 * build buys through Play and the phone sends us the purchase token. School
 * FEES are different — paying for a real-world education service is exempt,
 * and they keep going through Cashfree on every channel.
 *
 * The token from the phone proves nothing on its own: it is a string a
 * modified client can invent. It only becomes a purchase when Google says so,
 * which is what this module asks. Never grant a pass from the client's word.
 *
 * Ships inert. Without `androidpublisher` access the verifier returns
 * `not_configured` and the route refuses rather than granting — the same
 * fail-closed shape as the Gmail sender, which also waits on a credential
 * somebody has to create in the console.
 */

import { GoogleAuth } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** The Play package the parent app ships under. Staff never sells anything. */
export const PLAY_PACKAGE_NAME =
  process.env.PLAY_PACKAGE_NAME || "school.bhbinternational.parent";

/**
 * Product ids as created in Play Console. They must match `TutorPlan.code`
 * so one lookup serves both rails — a mismatch here sells the wrong number
 * of days, so the selftest pins it.
 */
export const PLAY_PRODUCT_IDS = ["tutor_day", "tutor_week", "tutor_month"];

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!auth) auth = new GoogleAuth({ scopes: [SCOPE] });
  return auth;
}

export function playBillingConfigured(): boolean {
  return process.env.PLAY_BILLING_DISABLED !== "1";
}

/** Google's purchaseState for a one-time product. 0 = purchased. */
const PURCHASED = 0;

export type PlayVerification =
  | {
      ok: true;
      /** Google's own order id — what we store as the payment reference. */
      orderId: string;
      productId: string;
      purchaseTimeMillis: number;
      /** True once we have acknowledged it to Google. */
      acknowledged: boolean;
    }
  | { ok: false; error: string; code: "not_configured" | "invalid" | "unavailable" };

async function token(): Promise<string | null> {
  try {
    const client = await getAuth().getClient();
    const t = await client.getAccessToken();
    return t.token || null;
  } catch (e) {
    console.warn(
      "[play-billing] token failed:",
      (e as Error)?.message?.slice(0, 140),
    );
    return null;
  }
}

/**
 * Ask Google whether this purchase token is a real, completed purchase of
 * this product. Returns the order id to store against the pass.
 */
export async function verifyPlayPurchase(input: {
  productId: string;
  purchaseToken: string;
}): Promise<PlayVerification> {
  if (!playBillingConfigured()) {
    return { ok: false, error: "Play billing is switched off", code: "not_configured" };
  }
  if (!PLAY_PRODUCT_IDS.includes(input.productId)) {
    return { ok: false, error: "Unknown product", code: "invalid" };
  }
  const access = await token();
  if (!access) {
    return {
      ok: false,
      error:
        "Play Developer API credentials are not set up yet — a purchase cannot be verified",
      code: "not_configured",
    };
  }

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(input.productId)}/tokens/` +
    `${encodeURIComponent(input.purchaseToken)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach Google Play: ${(e as Error).message}`,
      code: "unavailable",
    };
  }

  if (res.status === 404 || res.status === 400) {
    // Google does not know this token for this product. That is a forgery or
    // a stale token, and either way it is not a purchase.
    return { ok: false, error: "Google Play does not recognise this purchase", code: "invalid" };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Google Play returned ${res.status}`,
      code: "unavailable",
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    purchaseState?: number;
    orderId?: string;
    purchaseTimeMillis?: string;
    acknowledgementState?: number;
  };

  if (body.purchaseState !== PURCHASED) {
    // 1 = cancelled, 2 = pending. A pending purchase (cash at a counter, in
    // some markets) is NOT money yet and must not open the tutor.
    return {
      ok: false,
      error:
        body.purchaseState === 2
          ? "This purchase is still pending with Google Play"
          : "This purchase was cancelled",
      code: "invalid",
    };
  }

  return {
    ok: true,
    orderId: String(body.orderId || ""),
    productId: input.productId,
    purchaseTimeMillis: Number(body.purchaseTimeMillis || 0),
    acknowledged: body.acknowledgementState === 1,
  };
}

/**
 * Tell Google we have granted what was bought.
 *
 * Play REFUNDS an unacknowledged purchase automatically after three days, so
 * this is not bookkeeping — skipping it takes the money back off the school
 * and leaves the parent with a pass. Best effort: a failure here must not
 * undo a pass we have already granted, so it is logged, not thrown.
 */
export async function acknowledgePlayPurchase(input: {
  productId: string;
  purchaseToken: string;
}): Promise<boolean> {
  const access = await token();
  if (!access) return false;
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(input.productId)}/tokens/` +
    `${encodeURIComponent(input.purchaseToken)}:acknowledge`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok && res.status !== 409) {
      // 409 = already acknowledged, which is the outcome we wanted anyway.
      console.warn(`[play-billing] acknowledge returned ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(
      "[play-billing] acknowledge failed:",
      (e as Error)?.message?.slice(0, 140),
    );
    return false;
  }
}
