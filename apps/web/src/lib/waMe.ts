/**
 * Staff-initiated WhatsApp — from the SCHOOL's number, not the staff member's.
 *
 * This file used to do both at once. `openWaMe` POSTed to /api/wa/dispatch
 * AND opened wa.me, so a fee reminder left the school's Business number and
 * opened a chat on the clerk's personal WhatsApp in the same click: the family
 * could get it twice, from two different senders, and only one of those is on
 * the school's record. Fourteen screens called it.
 *
 * Now the school sends, and only the school. When it cannot, the staff member
 * is TOLD — with the reason — instead of a personal chat opening silently
 * behind the failure. Nothing about a message to a parent should depend on
 * whose phone happened to be at the desk.
 *
 * `wa.me` is still right in two places, and neither is a send:
 *   - a link pointed AT the school's own number (gate QR, visitor poster, the
 *     parent app's "message a teacher"), which is how a parent starts a
 *     conversation that then arrives through the Business API;
 *   - `wa.me/?text=` with NO number, which is just the share sheet.
 */

import type { RbacModule } from "@/lib/rbac";

/** Build https://wa.me/91…?text=… from a 10-digit or E.164 mobile. */
export function waMeUrl(mobile: string, text: string): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export type SchoolWaResult =
  | { ok: true; deferred: boolean }
  | { ok: false; error: string };

/**
 * Send from the school's WhatsApp Business number.
 *
 * `module` is the RBAC module the send belongs to — the dispatch route checks
 * `edit` on it, so a clerk who may not touch admissions cannot message a lead
 * from the school's number. It also decides quiet hours: anything not marked
 * `urgent` is held inside the family's quiet window rather than waking them.
 */
export async function sendFromSchoolWhatsApp(input: {
  mobile: string;
  text: string;
  module: RbacModule;
  /** Retried automatically by the dispatch route — e.g. a household altMobile. */
  fallbackMobile?: string;
  /** Attendance, transport, health and safety. Skips quiet hours. */
  urgent?: boolean;
}): Promise<SchoolWaResult> {
  const digits = input.mobile.replace(/\D/g, "");
  if (digits.length < 10) {
    return { ok: false, error: "No valid 10-digit WhatsApp number on record" };
  }
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: input.module,
        messages: [
          {
            mobile: digits,
            fallbackMobile: input.fallbackMobile,
            body: input.text,
            urgent: !!input.urgent,
          },
        ],
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      results?: { status?: string; error?: string }[];
      error?: string;
    } | null;
    if (!res.ok) {
      return { ok: false, error: data?.error || `Server said ${res.status}` };
    }
    const row = data?.results?.[0];
    if (row?.status === "sent") return { ok: true, deferred: false };
    // Quiet hours are a success, not a failure — it goes out later, and the
    // staff member should not resend it by hand in the meantime.
    if (row?.status === "deferred" || row?.status === "queued") {
      return { ok: true, deferred: true };
    }
    return { ok: false, error: row?.error || row?.status || "not sent" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network error",
    };
  }
}

/**
 * Fire-and-forget send with its own toast, for the many call sites that were
 * written around the old `openWaMe(mobile, text)` shape.
 *
 * The signature is kept so fourteen screens did not each need editing to stop
 * messaging parents from a personal account — but the behaviour is inverted:
 * it no longer opens anything. On failure it says so, in words, naming the
 * reason, because the previous silent double-send is exactly what made this
 * impossible to notice.
 */
export function openWaMe(
  mobile: string,
  text: string,
  fallbackMobile?: string,
  opts?: { module?: RbacModule; urgent?: boolean },
): void {
  void (async () => {
    const r = await sendFromSchoolWhatsApp({
      mobile,
      text,
      fallbackMobile,
      module: opts?.module ?? "notifications",
      urgent: opts?.urgent,
    });
    const { pushToast } = await import("@/components/shell/Toast");
    if (r.ok) {
      pushToast({
        kind: "success",
        message: r.deferred
          ? "Queued on the school's WhatsApp — it goes out after the family's quiet hours."
          : "Sent from the school's WhatsApp.",
      });
      return;
    }
    pushToast({
      kind: "error",
      message:
        `Not sent — the school's WhatsApp could not deliver this: ${r.error}. ` +
        `Nothing was sent from your own WhatsApp either. Fix the number or the ` +
        `template and try again, so the message stays on the school's record.`,
      durationMs: 0,
    });
  })();
}
