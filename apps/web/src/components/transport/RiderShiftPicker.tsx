"use client";

import type { ClassGroupCode } from "@/lib/masters";
import type { TransportRoute, TransportShiftDirection } from "@/lib/transport";
import { listRouteShifts, resolveRiderShift } from "@/lib/transportShifts";

/**
 * Which runs one child is on, and the chance to say otherwise.
 *
 * Shown as a sentence first and a dropdown second, on purpose. Almost every
 * rider follows their class, and a screen that opens with two empty dropdowns
 * invites a clerk to fill them in — 168 hand-placements that all go stale in
 * April. So the rule's answer is stated plainly, and the dropdown is there for
 * the exception.
 *
 * A route with no runs configured shows nothing at all. It runs one journey
 * each way, which is what it always did, and an empty "Runs" section would
 * read as something missing.
 */
export function RiderShiftPicker({
  route,
  groupCode,
  pickupShiftId,
  dropShiftId,
  onChange,
  disabled,
}: {
  route: TransportRoute | undefined;
  /** The child's class group, null when their class is not on the roster. */
  groupCode: ClassGroupCode | null;
  pickupShiftId: string;
  dropShiftId: string;
  onChange: (next: { pickupShiftId: string; dropShiftId: string }) => void;
  disabled?: boolean;
}) {
  if (!route) return null;
  const hasAny =
    listRouteShifts(route, "pickup").length +
      listRouteShifts(route, "drop").length >
    0;
  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
        Runs on {route.busNo || route.code}
      </h3>
      <div className="mt-2 space-y-2">
        {(["pickup", "drop"] as TransportShiftDirection[]).map((direction) => (
          <DirectionRow
            key={direction}
            route={route}
            direction={direction}
            groupCode={groupCode}
            overrideId={direction === "pickup" ? pickupShiftId : dropShiftId}
            disabled={disabled}
            onPick={(id) =>
              onChange({
                pickupShiftId: direction === "pickup" ? id : pickupShiftId,
                dropShiftId: direction === "drop" ? id : dropShiftId,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function DirectionRow({
  route,
  direction,
  groupCode,
  overrideId,
  onPick,
  disabled,
}: {
  route: TransportRoute;
  direction: TransportShiftDirection;
  groupCode: ClassGroupCode | null;
  overrideId: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const runs = listRouteShifts(route, direction);
  if (runs.length === 0) return null;

  const res = resolveRiderShift({
    route,
    direction,
    overrideShiftId: overrideId,
    groupCode,
  });
  // What the rule WOULD decide, asked without the override — otherwise the
  // "follow the class" option would describe the hand-placement it undoes.
  const byRule = resolveRiderShift({ route, direction, groupCode });
  const word = direction === "pickup" ? "Pick-up" : "Drop";

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{word}</span>
      <select
        className="field !py-1.5"
        value={overrideId}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">
          Follow the class ({classRuleLabel(byRule.shift?.name, byRule.reason)})
        </option>
        {runs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.departTime ? ` · leaves ${s.departTime}` : " · time not set"}
          </option>
        ))}
      </select>
      <span
        className={`mt-1 block text-[10px] ${
          res.needsAttention
            ? "font-semibold text-[var(--danger)]"
            : "text-[var(--muted)]"
        }`}
      >
        {res.detail}
      </span>
    </label>
  );
}

/**
 * What the "follow the class" option says the rule currently decides.
 *
 * When the rule cannot decide, the option must not read like a working
 * default — "Follow the class (no run)" is the honest label, and it is the
 * reason the clerk opens the dropdown.
 */
function classRuleLabel(name: string | undefined, reason: string): string {
  if (name) return name;
  if (reason === "unknown-group") return "class not known";
  if (reason === "ambiguous-group") return "two runs claim this class";
  return "no run";
}
