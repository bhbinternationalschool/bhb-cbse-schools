"use client";

/**
 * Two drop-in helpers that sit UNDER an existing input and fill in what the
 * office would otherwise type, using the free public lookups in
 * lib/openLookups.ts.
 *
 * Both are deliberately additive: neither replaces the field it helps, and
 * neither writes anything on its own. `IfscCheck` only ever shows a line of
 * text — the IFSC stays exactly as typed. `PincodeFill` offers a button and
 * calls back only when a person presses it. That matters because these are
 * third-party answers about somebody's bank and somebody's address, and an
 * autofill that overwrites what a parent dictated at the counter is worse
 * than no autofill at all.
 *
 * Both fail quiet. No network, service down, unknown value — the helper
 * shows a short line or nothing, and the form behaves exactly as it does
 * today.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MapPin, TriangleAlert } from "lucide-react";
import { ifscFormatOk, ifscSummary, pinFormatOk, type PinDetails } from "@/lib/openLookups";
import { lookupIfscApi, lookupPinApi } from "@/lib/openLookupsClient";

/** Long enough that typing an eleven-character IFSC is one request, not eleven. */
const DEBOUNCE_MS = 600;

/**
 * Says which bank and branch an IFSC belongs to, under the IFSC field.
 *
 * The format check in bankFileExport already rejects a malformed code. What
 * it cannot catch is a WELL-FORMED code for the wrong branch — and that is
 * the expensive one: the bank rejects the whole salary file over one bad
 * beneficiary row, after the office has gone home. A person reading
 * "Union Bank of India — SIGRA" under a field that should say Murdaha Bazar
 * catches it in the second it takes to read.
 */
export function IfscCheck({ ifsc }: { ifsc: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "found"; text: string; neft: boolean }
    | { kind: "missing"; text: string }
  >({ kind: "idle" });
  // Guards against a slow early request landing after a later one and
  // describing a bank the field no longer holds.
  const latest = useRef(0);

  useEffect(() => {
    const value = (ifsc || "").trim();
    if (!ifscFormatOk(value)) {
      setState({ kind: "idle" });
      return;
    }
    const seq = latest.current + 1;
    latest.current = seq;
    setState({ kind: "busy" });
    const t = setTimeout(() => {
      void lookupIfscApi(value).then((res) => {
        if (latest.current !== seq) return;
        if (res.ok) {
          setState({ kind: "found", text: ifscSummary(res.data), neft: res.data.neft });
        } else if (res.kind === "not_found") {
          setState({ kind: "missing", text: res.message });
        } else {
          // Invalid was handled above, so this is the service being away.
          // Say nothing: the field is valid and the office is not blocked.
          setState({ kind: "idle" });
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ifsc]);

  if (state.kind === "idle") return null;
  if (state.kind === "busy") {
    return (
      <span className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking…
      </span>
    );
  }
  if (state.kind === "missing") {
    return (
      <span className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-[var(--warning)]">
        <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
        {state.text}
      </span>
    );
  }
  return (
    <span className="mt-1 block text-[11px] text-[var(--muted)]">
      <span className="flex items-start gap-1 text-[var(--success)]">
        <Check className="mt-px h-3 w-3 shrink-0" />
        <span className="font-semibold">{state.text}</span>
      </span>
      {!state.neft ? (
        <span className="mt-0.5 flex items-start gap-1 font-semibold text-[var(--warning)]">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
          This branch does not accept NEFT — the salary file will bounce.
        </span>
      ) : null}
    </span>
  );
}

/**
 * Offers district, state and the localities under a PIN, under the PIN field.
 *
 * Offers, not fills. The button appears only once six digits are in, and
 * nothing moves until somebody presses it — an address a parent dictated is
 * not ours to overwrite because a post office disagrees about the spelling.
 */
export function PincodeFill({
  pincode,
  onFill,
}: {
  pincode: string;
  /** Called only on a press, with whatever the post office knows. */
  onFill: (d: PinDetails) => void;
}) {
  const [found, setFound] = useState<PinDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const value = (pincode || "").trim();
    setNote(null);
    if (!pinFormatOk(value)) {
      setFound(null);
      return;
    }
    const seq = latest.current + 1;
    latest.current = seq;
    setBusy(true);
    const t = setTimeout(() => {
      void lookupPinApi(value)
        .then((res) => {
          if (latest.current !== seq) return;
          if (res.ok) {
            setFound(res.data);
          } else {
            setFound(null);
            // Only an unknown PIN is worth saying; a service outage is not
            // the office's problem and the field still works.
            setNote(res.kind === "not_found" ? res.message : null);
          }
        })
        .finally(() => {
          if (latest.current === seq) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pincode]);

  if (busy) {
    return (
      <span className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Looking up…
      </span>
    );
  }
  if (note) {
    return <span className="mt-1 block text-[11px] text-[var(--muted)]">{note}</span>;
  }
  if (!found) return null;

  return (
    <button
      type="button"
      onClick={() => onFill(found)}
      className="mt-1 inline-flex items-center gap-1 text-left text-[11px] font-semibold text-[var(--brand-deep)] underline"
      title="Put these into the city and state boxes"
    >
      <MapPin className="h-3 w-3 shrink-0" />
      Use {found.district}, {found.state}
      {found.localities.length ? ` (${found.localities.length} localities)` : ""}
    </button>
  );
}
