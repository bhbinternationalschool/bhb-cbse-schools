import "server-only";

/**
 * The two desks a fee calculation needs that do not live in the school
 * mirror: transport (the bus fee of every rider) and fee adjustments
 * (posted waivers, stop-future decisions, ad-hoc charges).
 *
 * Both are localStorage-first modules. On Cloud Run there is no
 * localStorage, and until 2026-09-16 nothing pulled them into the server's
 * memory, so `computeStudentDues` ran there with an empty transport desk
 * and no adjustments at all. What that cost, measured on the day:
 *
 *   - `fee_desk_open_dues` held 796 lines and not ONE transport line,
 *     while the transport desk had 157 riders and 139 of them were being
 *     charged ₹83,950 a month between them;
 *   - so the WhatsApp reminders, the /pay/due links, the parent app and
 *     the principal cockpit all quoted school fee only — and parents
 *     replied "only September is pending", which was true of the message
 *     we had sent them;
 *   - and 31 posted adjustments (₹23,055 of waivers, one ₹500 ad-hoc
 *     charge) were invisible unless they happened to be readable off a
 *     receipt (`counterWaiversByDueKey`, PR #200).
 *
 * Call this before any server-side dues computation. It is TTL-gated, so
 * calling it on every request costs nothing after the first.
 *
 * Every failure is best-effort and leaves the previous copy in place: a
 * transient Supabase error must not make a rider's bus fee or a family's
 * waiver vanish, which is the whole defect class this repairs.
 */

let lastTransportMs = 0;
const TRANSPORT_TTL_MS = 60_000;

export async function ensureFeeDuesInputsHydrated(opts?: {
  force?: boolean;
}): Promise<void> {
  if (typeof window !== "undefined") return;

  const force = opts?.force === true;

  if (force || Date.now() - lastTransportMs >= TRANSPORT_TTL_MS) {
    try {
      const { ensureTransportHydratedServer } = await import(
        "@/lib/transportPersistence"
      );
      await ensureTransportHydratedServer();
      lastTransportMs = Date.now();
    } catch (e) {
      console.warn(
        "[feeDues] transport hydrate failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  try {
    const { ensureFeeAdjustmentsHydratedServer } = await import(
      "@/lib/feeAdjustmentsPersistence.server"
    );
    await ensureFeeAdjustmentsHydratedServer({ force });
  } catch (e) {
    console.warn(
      "[feeDues] fee adjustments hydrate failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Tests and the dues rebuild: forget the TTL so the next call pulls. */
export function resetFeeDuesInputsCache(): void {
  lastTransportMs = 0;
}
