import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { deleteDeviceToken, upsertDeviceToken } from "@/lib/fcm.server";
import { pushSubjectForSession } from "@/lib/pushSubject";

export const runtime = "nodejs";

type RegisterBody = {
  token?: string;
  platform?: string;
  appVersion?: string;
};

/**
 * POST /api/v1/push/register — the Flutter app registers (or refreshes) its
 * FCM device token against the signed-in subject (parent household / staff).
 * Idempotent: the token is the natural key, so re-registering after a token
 * refresh or a different login on the same device simply re-points it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.authKind !== "session") {
      throw new ApiError("forbidden", "Session required", 403);
    }
    const subject = pushSubjectForSession(ctx.session);
    if (!subject) {
      throw new ApiError("forbidden", "Session has no push subject", 403);
    }
    const body = (await request.json().catch(() => ({}))) as RegisterBody;
    const token = body.token?.trim() || "";
    if (!token || token.length > 4096) {
      throw new ApiError("bad_request", "token required", 400);
    }
    const result = await upsertDeviceToken({
      ...subject,
      token,
      platform: (body.platform || "").slice(0, 32),
      appVersion: (body.appVersion || "").slice(0, 32),
    });
    if (!result.ok) {
      throw new ApiError("server_error", result.error || "Save failed", 502);
    }
    return apiOk({ registered: true, ...subject });
  } catch (e) {
    return apiErr(e);
  }
}

/** DELETE /api/v1/push/register — remove this device's token (sign-out). */
export async function DELETE(request: Request) {
  try {
    await resolveApiAuth(request);
    const body = (await request.json().catch(() => ({}))) as RegisterBody;
    const token = body.token?.trim() || "";
    if (!token) throw new ApiError("bad_request", "token required", 400);
    await deleteDeviceToken(token);
    return apiOk({ removed: true });
  } catch (e) {
    return apiErr(e);
  }
}
