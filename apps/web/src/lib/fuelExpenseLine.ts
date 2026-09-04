/**
 * A fuel line on an expense voucher, and the refill it also records.
 *
 * Fuel is the one expense where the amount is not the fact — the rate and the
 * quantity are. ₹4,200 of diesel tells you nothing; 42 litres at ₹100 against
 * an odometer reading tells you the vehicle's mileage, and mileage is how a
 * school notices a leaking tank or a driver selling fuel.
 *
 * So a fuel line is entered as rate × quantity and lands in TWO places: the
 * money in the ledger, the litres in Transport. They are written from one
 * form, from one set of numbers, so they cannot disagree about what was
 * bought.
 *
 * The unit follows the fuel, not the vehicle: a CNG+Petrol vehicle takes kg of
 * CNG and litres of petrol, and a kilogram entered as a litre quietly ruins
 * every mileage figure that vehicle will ever report.
 */

export type FuelPick = {
  vehicleId: string;
  /** Which of the vehicle's fuels this fill was — it may take two. */
  fuelType: string;
  unit: string;
  /** Rate per litre or per kg, in paise. */
  ratePaisePerUnit: number;
  /** Litres or kilograms, to two decimals. */
  qty: number;
  /** The reading on the dial at the pump. */
  odometerKm: number;
};

/**
 * Is this expense head a fuel head?
 *
 * Matched on the account's NAME rather than a hard-coded code, because the
 * chart of accounts is the office's to edit — they have already renamed heads
 * this year — and a code baked in here would silently stop matching the day
 * someone renumbers. A false positive costs one extra optional panel; a false
 * negative loses the mileage record.
 */
export function isFuelAccount(a: { code?: string; name?: string }): boolean {
  const hay = `${a.code ?? ""} ${a.name ?? ""}`.toLowerCase();
  return /\b(fuel|diesel|petrol|cng|gas)\b/.test(hay);
}

/**
 * Rate × quantity, in paise. The amount is derived, never typed.
 *
 * Multiplied as whole numbers — paise by hundredths of a litre — rather than
 * as decimals, so the result cannot land on either side of a half-paisa
 * depending on how the two floats happened to round. 33.33 kg at ₹100.50 is
 * ₹3,349.665, and it must round the same way every time it is computed.
 */
export function fuelAmountPaise(ratePaisePerUnit: number, qty: number): number {
  const rate = Math.max(0, Math.round(ratePaisePerUnit));
  const centiUnits = Math.max(0, Math.round(qty * 100));
  return Math.round((rate * centiUnits) / 100);
}

export type FuelLineProblem = string;

/**
 * Everything that must be true before a fuel line may be posted.
 *
 * The odometer check is a warning and not a refusal: a dial that reads lower
 * than last time is usually a typo, but it is sometimes a replaced cluster or
 * a genuinely rolled-over meter, and refusing would leave the office unable to
 * record a real purchase. It is surfaced instead, because a wrong reading
 * poisons the mileage of every fill that follows it.
 */
export function checkFuelLine(input: {
  pick: FuelPick;
  /** The fuels this vehicle actually takes. */
  allowedFuels: { fuelType: string; unit: string }[];
  /** The dial's last known reading, if the vehicle has one. */
  lastOdometerKm?: number;
}): { ok: boolean; problems: FuelLineProblem[]; warnings: string[] } {
  const problems: FuelLineProblem[] = [];
  const warnings: string[] = [];
  const p = input.pick;

  if (!p.vehicleId) problems.push("Choose the vehicle this fuel went into.");
  if (p.qty <= 0) problems.push("Enter how much fuel was filled.");
  if (p.ratePaisePerUnit <= 0) problems.push("Enter the rate per litre or kg.");

  if (p.vehicleId && p.fuelType) {
    const allowed = input.allowedFuels.find((f) => f.fuelType === p.fuelType);
    if (!allowed) {
      problems.push(
        `This vehicle does not run on ${p.fuelType} — pick one of ${input.allowedFuels
          .map((f) => f.fuelType)
          .join(" or ")}.`,
      );
    } else if (allowed.unit !== p.unit) {
      // Never silently corrected: the quantity was typed against whichever
      // unit was on screen, so the number itself is now in doubt.
      problems.push(`${p.fuelType} is measured in ${allowed.unit}, not ${p.unit}.`);
    }
  }

  if (
    typeof input.lastOdometerKm === "number" &&
    input.lastOdometerKm > 0 &&
    p.odometerKm > 0 &&
    p.odometerKm < input.lastOdometerKm
  ) {
    warnings.push(
      `The odometer reads ${p.odometerKm} km but last showed ${input.lastOdometerKm} km. Check the reading — mileage will be wrong if it is a typo.`,
    );
  }

  return { ok: problems.length === 0, problems, warnings };
}

/** How the line reads in the book, so the voucher explains itself. */
export function fuelNarration(input: {
  vehicleNo: string;
  pick: Pick<FuelPick, "fuelType" | "unit" | "qty" | "ratePaisePerUnit" | "odometerKm">;
}): string {
  const { fuelType, unit, qty, ratePaisePerUnit, odometerKm } = input.pick;
  const rate = (ratePaisePerUnit / 100).toFixed(2);
  const bits = [
    `${fuelType} ${qty} ${unit} @ ₹${rate}/${unit}`,
    input.vehicleNo ? `— ${input.vehicleNo}` : "",
    odometerKm > 0 ? `(${odometerKm} km)` : "",
  ];
  return bits.filter(Boolean).join(" ");
}

/**
 * The refill to hand to Transport once the voucher has posted.
 *
 * `paymentStatus` follows the voucher: fuel bought on account is not "paid",
 * and Transport's own dues would otherwise show every credit fill as settled.
 */
export function buildFuelRefill(input: {
  pick: FuelPick;
  vendorName: string;
  billNo: string;
  filledAt: string;
  paidInFull: boolean;
}): {
  vehicleId: string;
  filledAt: string;
  odometerKm: number;
  qty: number;
  ratePerUnitPaise: number;
  amountPaise: number;
  source: "dealer_pump";
  billNo: string;
  paymentStatus: "paid_cash" | "on_account";
} {
  const p = input.pick;
  return {
    vehicleId: p.vehicleId,
    filledAt: input.filledAt,
    odometerKm: Math.max(0, Math.round(p.odometerKm)),
    qty: Math.round(p.qty * 100) / 100,
    ratePerUnitPaise: Math.round(p.ratePaisePerUnit),
    amountPaise: fuelAmountPaise(p.ratePaisePerUnit, p.qty),
    source: "dealer_pump",
    billNo: input.billNo,
    paymentStatus: input.paidInFull ? "paid_cash" : "on_account",
  };
}
