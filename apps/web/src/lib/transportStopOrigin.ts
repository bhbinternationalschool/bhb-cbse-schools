/**
 * Actual stop or manual stop?
 *
 * On 14 Oct 2026 the places where each tracked bus really halts were added to
 * its route from Fleet Edge GPS. Every such stop's note (geoAddress) starts
 * "From GPS:" and says how many school days the bus stopped there. The older
 * stops were typed or picked by hand, and many of them are places the bus
 * never reaches. The office moves children onto the GPS stops by hand, so
 * every stop picker has to show which is which.
 *
 * The note is the marker on purpose: it is a field every build already
 * carries through a save. A new field would be stripped by an office tab on
 * an older build the first time it saved the route, and the GPS stops would
 * silently turn back into "manual" ones.
 */

export const GPS_STOP_NOTE_PREFIX = "From GPS:";

export type StopOrigin = "gps" | "manual";

export function stopOrigin(stop: { geoAddress?: string } | null | undefined): StopOrigin {
  return String(stop?.geoAddress ?? "").trimStart().startsWith(GPS_STOP_NOTE_PREFIX) ? "gps" : "manual";
}

export const STOP_ORIGIN_LABEL: Record<StopOrigin, string> = {
  gps: "Actual · GPS",
  manual: "Manual",
};

export const STOP_ORIGIN_GROUP: Record<StopOrigin, string> = {
  gps: "Actual stops — where the bus really halts (GPS)",
  manual: "Older manual stops — not confirmed by GPS",
};

/**
 * Stops split for a picker: GPS stops first, each group in route order.
 * A route with no GPS stops gives one group, so nothing changes for it.
 */
export function groupStopsByOrigin<T extends { geoAddress?: string; sequence: number }>(
  stops: T[],
): { origin: StopOrigin; label: string; stops: T[] }[] {
  const bySeq = [...stops].sort((a, b) => a.sequence - b.sequence);
  const gps = bySeq.filter((s) => stopOrigin(s) === "gps");
  const manual = bySeq.filter((s) => stopOrigin(s) === "manual");
  if (gps.length === 0) return [{ origin: "manual", label: "", stops: manual }];
  const out: { origin: StopOrigin; label: string; stops: T[] }[] = [
    { origin: "gps", label: STOP_ORIGIN_GROUP.gps, stops: gps },
  ];
  if (manual.length) out.push({ origin: "manual", label: STOP_ORIGIN_GROUP.manual, stops: manual });
  return out;
}
