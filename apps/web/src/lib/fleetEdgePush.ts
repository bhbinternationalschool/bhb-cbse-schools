/**
 * Which of Fleet Edge's three push streams is this payload?
 *
 * WHY THIS EXISTS: Fleet Edge's subscription portal accepts exactly ONE
 * endpoint URL per fleet. The ERP had three — `/` for periodic summaries,
 * `/alerts` for events, `/live` for telemetry — so configuring any one of
 * them silently switched the other two off. Pointing the single URL at
 * `/live` on 8 September 2026 did precisely that: summaries stopped at
 * 04:30 and alerts at 04:08, and because the SOS escalation only runs on
 * the alert path, a driver's panic button had nowhere to land for two days.
 *
 * So the endpoint cannot be told what it is receiving — it has to look.
 *
 * The three payloads are cleanly separable, verified against every one of
 * the 11,231 events this fleet had sent by 10 September 2026: alerts carry
 * `alertName` (544 rows, no exceptions), summaries carry at least one of
 * the four data blocks (5,825 rows), telemetry carries `gpsLatitude` (66).
 *
 * A fourth shape turns up that the vendor docs never mention: a payload of
 * `{vehicleId, registrationNumber}` and nothing else, once a minute, 4,837
 * of them since 14 August. It is a reachability ping, not data — but the
 * old parsers accepted any JSON object at all, so every one was filed as a
 * periodic summary. One vehicle's "5,996 summaries" on the Live tab were
 * 1,169 summaries and 4,834 pings.
 *
 * Nothing here guesses. A shape that matches none of the four is `unknown`,
 * and the caller stores it as such rather than dropping it or forcing it
 * into whichever stream looks closest — this system has been burned before
 * by an unrecognised value being quietly recorded as a known one.
 */

export type FleetEdgePushKind =
  | "alert"
  | "details"
  | "telemetry"
  | "heartbeat"
  | "unknown";

/** The four blocks a TimeBound "periodic details" push carries. */
const DETAIL_BLOCKS = [
  "vehicleSafety",
  "vehiclePerformance",
  "vehicleEfficiency",
  "vehicleHealth",
] as const;

/**
 * Fields that only ever appear on a Basic Push telemetry snapshot. `speed`
 * and `odometer` are deliberately absent: they also occur inside an alert's
 * eventDetails, and a discriminator that can fire on two streams is not one.
 */
const TELEMETRY_FIELDS = [
  "gpsLatitude",
  "gpsLongitude",
  "gpsFix",
  "ignitionOn",
  "vehicleStatus",
] as const;

/** What a ping is allowed to contain and still be a ping. */
const IDENTITY_FIELDS = new Set([
  "vehicleId",
  "registrationNumber",
  "subscriptionId",
  "timestamp",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;

export function classifyFleetEdgePush(raw: unknown): FleetEdgePushKind | null {
  // Not JSON, or JSON that isn't an object. The only outright rejection.
  if (!isObject(raw)) return null;

  // Most specific first. An alert is unambiguous and is also the one whose
  // misfiling costs the most, so it is tested before anything else.
  if (typeof raw.alertName === "string" && raw.alertName.trim()) return "alert";

  if (DETAIL_BLOCKS.some((b) => isObject(raw[b]))) return "details";
  // A summary with all four blocks empty is still a summary if it says which
  // window it covers.
  if (has(raw, "from") && has(raw, "to")) return "details";

  if (TELEMETRY_FIELDS.some((f) => has(raw, f))) return "telemetry";

  // Identity and nothing else: the undocumented reachability ping.
  const keys = Object.keys(raw).filter((k) => raw[k] != null);
  if (keys.length > 0 && keys.every((k) => IDENTITY_FIELDS.has(k))) {
    return "heartbeat";
  }

  return "unknown";
}

/**
 * Read a numeric field by name, ignoring case.
 *
 * Reserved for the fuel levels, and for a specific reason. Of the 34 fields
 * in Fleet Edge's Basic Push spec, exactly two are written capitalised —
 * `PrimaryFuelLevel` and `SecondaryFuelLevel1` — while their own companion
 * fields on the very next line are not (`primaryFuelTankCapacity`,
 * `secondaryFuelTankCapacity1`). Live traffic sends all four lowercase-first,
 * so the document and the wire already disagree, on the fuel fields only.
 *
 * Today the code matches the wire. If Tata ever conform their payload to
 * their own spec, an exact-match read would return nothing, the tank would
 * show empty, and nothing would error — the same silent shape of failure as
 * the summaries that spent this morning being filed as telemetry. Reading
 * both spellings costs nothing and removes the trapdoor.
 *
 * Deliberately NOT applied to the stream discriminators. Every field that
 * decides which stream a payload belongs to — alertName, vehicleSafety,
 * from/to, gpsLatitude, ignitionOn, vehicleStatus — is lowercase-first in
 * both the spec and the wire, and the SQL that classifies stored rows
 * matches on those exact names. Loosening one side and not the other is how
 * the screen and the ingest start disagreeing about what arrived.
 */
export function pickNumber(
  raw: Record<string, unknown>,
  names: readonly string[],
): number | null {
  for (const name of names) {
    const v = raw[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  // Only pay for the scan when the expected spellings missed.
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(raw)) {
    if (!wanted.has(k.toLowerCase())) continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** The tank fields, in the spelling the wire actually uses. */
export const FUEL_FIELDS = {
  primaryLevel: ["primaryFuelLevel", "fuelLevelPercent"],
  primaryCapacity: ["primaryFuelTankCapacity"],
  secondaryLevel: ["secondaryFuelLevel1"],
  secondaryCapacity: ["secondaryFuelTankCapacity1"],
} as const;
