/**
 * The one request path behind the staff app's "Scan" buttons (2026-10-20):
 * POST /api/v1/staff/visitors/scan (ID card, number plate) and
 * POST /api/v1/staff/logbook/scan-bill (fuel bill).
 *
 * Order matters, and is the point of having one handler:
 *   1. who is asking (session),
 *   2. is the body a photo of a sane size — refused before it is parsed,
 *   3. may THIS person use THIS screen (the route's `authorize`: mobile
 *      feature + module permission, and for a bill the vehicle and date),
 *   4. have they scanned too often,
 * and only then the paid model call. A refused caller costs the school
 * nothing.
 *
 * The reply is a draft. Nothing is saved here; the phone pre-fills its form,
 * marks each filled field "check", and the person saves the normal way.
 *
 * Deliberately free of `server-only` imports — the model reader and the
 * session resolver come in as `deps`, so the selftest can drive the real
 * handler with a mocked model (staffScanRoute.selftest.ts).
 */

import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { createKeyedRateLimiter, type KeyedRateLimiter } from "@/lib/rateLimit";
import {
  STAFF_SCAN_MAX_BODY_BYTES,
  STAFF_SCAN_RATE,
  cleanStaffScanInput,
  parseStaffScanReading,
  staffScanAuditOutput,
  type StaffScanInput,
  type StaffScanKind,
  type StaffScanReading,
} from "@/lib/staffScanReading";

export type StaffScanReader = (opts: {
  kind: StaffScanKind;
  base64: string;
  mimeType: string;
  parse: (text: string) => StaffScanReading | null;
  audit: (r: StaffScanReading) => string;
  requester?: string;
}) => Promise<
  | { ok: true; result: StaffScanReading; generationId: string }
  | { ok: false; failure: "not-configured" | "budget" | "read-failed"; error: string }
>;

export type StaffScanDeps = {
  auth: (request: Request) => Promise<ApiAuthContext>;
  /** Throws an ApiError when this caller may not scan this photo. */
  authorize: (ctx: ApiAuthContext, input: StaffScanInput) => void | Promise<void>;
  read: StaffScanReader;
  limiter: KeyedRateLimiter;
  /** IST date, YYYY-MM-DD — a bill dated after it is a misreading. */
  today: () => string;
};

/** One window per process, shared by both scan routes. */
export const staffScanLimiter: KeyedRateLimiter = createKeyedRateLimiter(STAFF_SCAN_RATE);

export async function handleStaffScan(
  request: Request,
  kinds: readonly StaffScanKind[],
  deps: StaffScanDeps,
): Promise<Response> {
  try {
    const ctx = await deps.auth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }

    const declared = Number(request.headers.get("content-length") || "0");
    if (declared > STAFF_SCAN_MAX_BODY_BYTES) {
      throw new ApiError("bad_request", "The photo is too large — retake it", 413);
    }
    const raw = await request.text();
    if (raw.length > STAFF_SCAN_MAX_BODY_BYTES) {
      throw new ApiError("bad_request", "The photo is too large — retake it", 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    const input = cleanStaffScanInput(body, kinds);
    if (typeof input === "string") {
      throw new ApiError("bad_request", input, /too large/.test(input) ? 413 : 400);
    }

    await deps.authorize(ctx, input);

    const who = ctx.session.staffId || ctx.session.email || ctx.session.fullName || "staff";
    if (deps.limiter(`scan:${who}`)) {
      throw new ApiError("conflict", "Too many photos read in the last few minutes — type the details in, or try again shortly", 429);
    }

    const today = deps.today();
    const r = await deps.read({
      kind: input.kind,
      base64: input.base64,
      mimeType: input.mimeType,
      parse: (text) => parseStaffScanReading(input.kind, text, today),
      audit: staffScanAuditOutput,
      requester: ctx.session.email || ctx.session.fullName || "staff",
    });
    if (!r.ok) {
      if (r.failure === "not-configured") {
        throw new ApiError("server_error", "Reading photos is not switched on for this school yet — type the details in", 503);
      }
      if (r.failure === "budget") throw new ApiError("conflict", r.error, 429);
      console.warn(`[staff-scan/${input.kind}] read failed:`, r.error);
      throw new ApiError("server_error", "Could not read the photo just now — try again, or type the details in", 502);
    }
    return apiOk({ kind: r.result.kind, reading: r.result.reading, generationId: r.generationId });
  } catch (e) {
    return apiErr(e);
  }
}
