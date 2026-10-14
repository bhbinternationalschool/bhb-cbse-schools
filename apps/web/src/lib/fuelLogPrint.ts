// ratchet-allow: raw_table — an HTML string written into a print popup (the
// fuel log on the school letterhead); it never renders a screen table.
/**
 * Transport → Fuel, printed: the filtered fills, the totals and — for "All
 * vehicles" — a subtotal per vehicle, under the school letterhead
 * (lib/printLetterheadHtml, the print-branding convention).
 */
import { PRINT_LETTERHEAD_CSS, printLetterheadHtml } from "@/lib/printLetterheadHtml";
import { inrPaise, qtyText, type FuelTotals } from "@/lib/fuelLog";

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type FuelPrintRow = {
  fillDate: string;
  vehicle: string;
  fuelType: string;
  quantity: number;
  unit: "kg" | "litre";
  ratePaise: number;
  amountPaise: number;
  odometerKm: number | null;
  kmSinceLast: number | null;
  kmPerUnit: number | null;
  paidBy: string;
  billDealer: string;
  voucherNo: string;
  status: string;
  voided: boolean;
};

export function fuelRegisterPrintHtml(input: {
  rows: FuelPrintRow[];
  totals: { all: FuelTotals; byVehicle: ({ vehicleName: string } & FuelTotals)[] };
  perVehicle: boolean;
  filterNote: string;
}): string {
  const u = (x: "kg" | "litre") => (x === "kg" ? "kg" : "L");
  const body = input.rows
    .map(
      (r) =>
        `<tr class="${r.voided ? "void" : ""}"><td>${esc(r.fillDate)}</td><td>${esc(r.vehicle)}</td><td>${esc(r.fuelType.toUpperCase())}</td><td class="r">${r.quantity.toFixed(2)} ${u(r.unit)}</td><td class="r">${esc(inrPaise(r.ratePaise))}</td><td class="r">${esc(inrPaise(r.amountPaise))}</td><td class="r">${r.odometerKm ?? ""}</td><td class="r">${r.kmSinceLast ?? ""}</td><td class="r">${r.kmPerUnit ?? ""}</td><td>${esc(r.paidBy)}</td><td>${esc(r.billDealer)}</td><td>${esc(r.voucherNo)}</td><td>${esc(r.status)}</td></tr>`,
    )
    .join("");
  const sub = input.perVehicle
    ? input.totals.byVehicle
        .filter((v) => v.fills > 0)
        .map(
          (v) =>
            `<tr><td>${esc(v.vehicleName)}</td><td class="r">${v.fills}</td><td class="r">${esc(qtyText(v))}</td><td class="r">${esc(inrPaise(v.amountPaise))}</td></tr>`,
        )
        .join("")
    : "";
  const t = input.totals.all;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fuel log</title><style>
  body { font-family: system-ui, sans-serif; font-size: 11px; color: #111; margin: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border-bottom: 1px solid #ccc; padding: 3px 5px; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; background: #f3f4f6; }
  .r { text-align: right; } tr.void td { text-decoration: line-through; color: #888; }
  .sub { color: #444; margin: 4px 0 0; } .tot td { font-weight: 700; border-top: 2px solid #111; }
  ${PRINT_LETTERHEAD_CSS}
</style></head><body>
${printLetterheadHtml({ title: "Fuel log" })}
<p class="sub">${esc(input.filterNote)} · printed ${esc(new Date().toLocaleString("en-IN"))}</p>
<table><thead><tr><th>Date</th><th>Vehicle</th><th>Fuel</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th><th class="r">Odometer</th><th class="r">Km</th><th class="r">Km/unit</th><th>Paid by</th><th>Bill / dealer</th><th>Voucher</th><th>Status</th></tr></thead>
<tbody>${body}<tr class="tot"><td colspan="3">Total (${t.fills} live fills)</td><td class="r">${esc(qtyText(t))}</td><td></td><td class="r">${esc(inrPaise(t.amountPaise))}</td><td colspan="7"></td></tr></tbody></table>
${sub ? `<h3>By vehicle</h3><table><thead><tr><th>Vehicle</th><th class="r">Fills</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>${sub}</tbody></table>` : ""}
</body></html>`;
}
