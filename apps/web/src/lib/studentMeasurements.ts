/**
 * Height and weight as a class teacher measures them (My class → Height &
 * weight). Pure — the phone screen and the server use the same checks.
 *
 * Director, 7 Oct 2026: UDISE+ asks every child's height and weight, the ERP
 * had 1 height and 14 weights for 189 children, and the figures must be
 * MEASURED — never estimated from age — because the portal records them as
 * facts about the child. A tape and a scale per class, typed here once, and
 * the UDISE robot fills them from the ERP.
 *
 * The ranges are wide enough for Nursery to Class VIII and narrow enough to
 * catch the usual slips: a weight typed into the height box, metres instead
 * of centimetres, grams instead of kilograms.
 */

export const HEIGHT_CM = { min: 60, max: 190 } as const;
export const WEIGHT_KG = { min: 8, max: 110 } as const;

export type MeasurementCheck =
  | { ok: true; heightCm: string; weightKg: string }
  | { ok: false; error: string };

function num(raw: string): number | null {
  const t = (raw || "").trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t);
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/**
 * Check one child's pair. Both blank = nothing to save (ok, empty strings).
 * One blank is allowed — a child weighed today and measured tomorrow.
 */
export function checkMeasurement(heightRaw: string, weightRaw: string): MeasurementCheck {
  const h = num(heightRaw);
  const w = num(weightRaw);
  if (Number.isNaN(h)) return { ok: false, error: "Height must be a number in cm, e.g. 112 or 112.5" };
  if (Number.isNaN(w)) return { ok: false, error: "Weight must be a number in kg, e.g. 19 or 19.5" };
  if (h !== null && h > 0 && h < 3) return { ok: false, error: `Height ${h} looks like metres — type centimetres (e.g. ${Math.round(h * 100)})` };
  if (w !== null && w > 1000) return { ok: false, error: `Weight ${w} looks like grams — type kilograms (e.g. ${oneDecimal(w / 1000)})` };
  if (h !== null && w !== null && h < HEIGHT_CM.min && w > HEIGHT_CM.min) {
    return { ok: false, error: "Height and weight look swapped — height in cm, weight in kg" };
  }
  if (h !== null && (h < HEIGHT_CM.min || h > HEIGHT_CM.max)) {
    return { ok: false, error: `Height must be between ${HEIGHT_CM.min} and ${HEIGHT_CM.max} cm` };
  }
  if (w !== null && (w < WEIGHT_KG.min || w > WEIGHT_KG.max)) {
    return { ok: false, error: `Weight must be between ${WEIGHT_KG.min} and ${WEIGHT_KG.max} kg` };
  }
  return { ok: true, heightCm: h === null ? "" : oneDecimal(h), weightKg: w === null ? "" : oneDecimal(w) };
}

/** Age in whole years on `today` (YYYY-MM-DD) from an ISO date of birth; null if unknown. */
export function ageYears(dob: string, today: string): number | null {
  const m = (dob || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = today.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !t) return null;
  let age = Number(t[1]) - Number(m[1]);
  if (t[2]! < m[2]! || (t[2] === m[2] && t[3]! < m[3]!)) age -= 1;
  return age >= 0 && age < 30 ? age : null;
}
