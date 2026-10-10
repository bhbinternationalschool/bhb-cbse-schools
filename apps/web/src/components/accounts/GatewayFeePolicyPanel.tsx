"use client";
// ratchet-allow: grids_without_row_menu — neither table here is an operational
// list. The first is a settings form whose rows are the eight fixed payment
// rails, edited in place by the controls in the cells; there is no per-row
// operation to put in a menu and no row to open, delete or act on. The second
// is a reconciliation summary aggregated per rail, the same shape as the
// payables-ageing tables already excluded in LedgerPanels.tsx.

/**
 * Who bears the payment-gateway fee — the screen.
 *
 * The policy has been readable by the code and settable only by SQL, which is
 * not a setting, it is a trap: nobody would remember it existed. This is the
 * screen, and it is built around the one risk the feature carries — a rate
 * typed into a box turning into a charge on a parent's card.
 *
 * So three things are always on screen before anything is saved:
 *
 *   the preview      "₹2,500 becomes ₹2,547 on a credit card", from the same
 *                    arithmetic the checkout uses, so it cannot drift from it
 *   the warning      shown while the policy charges parents, not hidden behind
 *                    a save confirmation
 *   the reconciliation   quoted against what Cashfree really deducted, because
 *                    a rate set too low loses money on every payment silently
 *
 * Nothing here computes a charge of its own. The preview comes from the server
 * running quoteAllGatewayFees, which is the function the order is created
 * with. A second implementation in the browser would be a second answer.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Percent, RefreshCw, Save } from "lucide-react";

import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { formatInr } from "@/lib/fees";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)] disabled:opacity-50";
const FIELD = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";

type Bearer = "school" | "payer";
type Rate = { percent: number; flatPaise: number };

type PolicyView = {
  bearer: Bearer;
  perMethod: Record<string, Bearer>;
  rates: Record<string, Rate>;
  gstPercent: number;
  ratesAreDefaults: boolean;
  fallbackGroup: string;
  chargesParents: boolean;
  rails: { group: string; label: string }[];
  preview: {
    netPaise: number;
    rails: { group: string; bearer: Bearer; surchargePaise: number; chargeablePaise: number }[];
  }[];
};

type ReconView = {
  from: string;
  to: string;
  rails: {
    group: string;
    label: string;
    payments: number;
    quotedPaise: number;
    actualPaise: number;
    shortfallPaise: number;
    overRecoveredPaise: number;
  }[];
  totals: {
    payments: number;
    quotedPaise: number;
    actualPaise: number;
    shortfallPaise: number;
    overRecoveredPaise: number;
  };
  unmatchedPayments: number;
};

export function GatewayFeePolicyPanel() {
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [recon, setRecon] = useState<ReconView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Edits live here until saved, so the preview on screen is always the SAVED
  // policy and never a half-typed one. A preview of something that is not
  // stored is the same lie as a receipt for money that was not booked.
  const [draft, setDraft] = useState<PolicyView | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/accounts/gateway-fee-policy");
      const out = (await res.json()) as { ok?: boolean; error?: string; policy?: PolicyView; recon?: ReconView };
      if (!res.ok || !out.ok || !out.policy) {
        setError(out.error || "Could not read the fee policy");
        return;
      }
      setPolicy(out.policy);
      setDraft(out.policy);
      setRecon(out.recon ?? null);
    } catch {
      setError("Could not reach the fee policy");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/accounts/gateway-fee-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bearer: draft.bearer,
          perMethod: draft.perMethod,
          rates: draft.rates,
          gstPercent: draft.gstPercent,
          fallbackGroup: draft.fallbackGroup,
        }),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string; policy?: PolicyView; warning?: string };
      if (!res.ok || !out.ok || !out.policy) {
        setError(out.error || "The policy was not saved");
        return;
      }
      // The SAVED policy replaces the draft. If the server refused part of
      // what was typed — a rate out of range degrades to zero — the screen must
      // show what was actually stored, not what was asked for.
      setPolicy(out.policy);
      setDraft(out.policy);
      setNotice(out.warning || "Saved. The school absorbs the fee on every rail.");
    } catch {
      setError("The policy was not saved");
    } finally {
      setBusy(false);
    }
  };

  const setRail = (group: string, bearer: Bearer) => {
    if (!draft) return;
    setDraft({ ...draft, perMethod: { ...draft.perMethod, [group]: bearer } });
  };
  const setRate = (group: string, patch: Partial<Rate>) => {
    if (!draft) return;
    const current = draft.rates[group] ?? { percent: 0, flatPaise: 0 };
    setDraft({ ...draft, rates: { ...draft.rates, [group]: { ...current, ...patch } } });
  };

  const dirty = !!draft && !!policy && JSON.stringify(draft) !== JSON.stringify(policy);

  return (
    <section className={`${CARD} mt-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
            <Percent className="h-4 w-4" aria-hidden />
            Who pays the gateway fee
          </h4>
          <p className="text-[11px] text-[var(--muted)]">
            The school absorbs it by default, which is how it has always worked
            here. Switch a rail to &ldquo;parent pays&rdquo; and the fee is added
            to the amount at checkout, shown to the parent before they pay, and
            booked to 4110 Gateway Fee Recovered — never to fee income.
          </p>
        </div>
        <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
          Reload
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-[var(--danger-soft,#fee)] p-3 text-[12px] font-semibold text-[var(--danger,#a00)]">
          {error}
        </p>
      ) : null}

      {!draft ? (
        <p className="mt-3 text-[12px] text-[var(--muted)]">
          {busy ? "Reading the policy…" : "The fee policy could not be read."}
        </p>
      ) : (
        <>
          {/* The consequence, while it is true — not behind a save dialog. */}
          {(dirty ? draft : policy)?.chargesParents ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--warning,#e0a800)] bg-[var(--warning-soft,#fff8e1)] p-3 text-[12px] font-semibold text-[var(--brand-deep)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Parents are charged the gateway fee on the rails marked
                &ldquo;parent pays&rdquo;. A charge on top of a regulated school
                fee has a GST treatment and a fee-regulation position attached —
                confirm both with your accountant before telling families.
              </span>
            </p>
          ) : null}

          {draft.ratesAreDefaults ? (
            <p className="mt-3 rounded-xl border border-[var(--border)] p-3 text-[12px] text-[var(--muted)]">
              These rates are the shipped estimates, not your Cashfree pricing.
              Until you replace them with your real rates, a &ldquo;parent
              pays&rdquo; rail may over- or under-recover. The reconciliation
              below is what tells you which.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Default for every rail
              <select
                className={FIELD}
                value={draft.bearer}
                onChange={(e) => setDraft({ ...draft, bearer: e.target.value as Bearer })}
              >
                <option value="school">School absorbs the fee</option>
                <option value="payer">Parent pays the fee</option>
              </select>
            </label>
            <label className="text-[11px] font-bold text-[var(--muted)]">
              GST on the gateway fee (%)
              <input
                className={FIELD}
                type="number"
                min={0}
                max={50}
                step="0.01"
                value={draft.gstPercent}
                onChange={(e) => setDraft({ ...draft, gstPercent: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="mt-3 block text-[11px] font-bold text-[var(--muted)]">
            Rail used when the parent has no choice (a WhatsApp pay-link)
            <select
              className={FIELD}
              value={draft.fallbackGroup}
              onChange={(e) => setDraft({ ...draft, fallbackGroup: e.target.value })}
            >
              {draft.rails.map((r) => (
                <option key={r.group} value={r.group}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal">
              A pay-link is quoted at this rail&apos;s rate, because nobody has
              picked one yet. Leaving it on UPI means a link can never surprise a
              parent with a card-rate charge they did not choose.
            </span>
          </label>

          {/* The scroll box sits INSIDE ErpTableShell: the shell is
              overflow-hidden, so a box outside it never sees anything to
              scroll and answers no wheel, trackpad or touch. Same bug as the
              exam date sheet, and the same shape of fix. */}
          <div className="mt-4">
            <ErpTableShell><div className="overflow-x-auto overscroll-x-contain"><ErpTable minWidth="min-w-[560px]">
              <ErpTableHead>
                <tr>
                  <th className="py-1 text-left">Rail</th>
                  <th className="py-1 text-left">Who pays</th>
                  <th className="py-1 text-left">Rate %</th>
                  <th className="py-1 text-left">Flat ₹</th>
                  <th className="py-1 text-left">₹25,000 becomes</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {draft.rails.map((rail) => {
                  const rate = draft.rates[rail.group] ?? { percent: 0, flatPaise: 0 };
                  const bearer = draft.perMethod[rail.group] ?? draft.bearer;
                  // From the SAVED policy, so this column never previews an
                  // unsaved rate as though it were in force.
                  const shown = policy?.preview
                    ?.find((p) => p.netPaise === 2_500_000)
                    ?.rails.find((r) => r.group === rail.group);
                  return (
                    <tr key={rail.group} className="border-t border-[var(--border)]">
                      <td className="py-1.5 font-semibold text-[var(--brand-deep)]">{rail.label}</td>
                      <td className="py-1.5">
                        <select
                          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[12px]"
                          value={bearer}
                          onChange={(e) => setRail(rail.group, e.target.value as Bearer)}
                        >
                          <option value="school">School</option>
                          <option value="payer">Parent</option>
                        </select>
                      </td>
                      <td className="py-1.5">
                        <input
                          className="w-20 rounded-lg border border-[var(--border)] px-2 py-1 text-[12px]"
                          type="number"
                          min={0}
                          max={20}
                          step="0.01"
                          value={rate.percent}
                          onChange={(e) => setRate(rail.group, { percent: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          className="w-20 rounded-lg border border-[var(--border)] px-2 py-1 text-[12px]"
                          type="number"
                          min={0}
                          step="1"
                          value={rate.flatPaise / 100}
                          onChange={(e) => setRate(rail.group, { flatPaise: Math.round(Number(e.target.value) * 100) })}
                        />
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {shown
                          ? shown.surchargePaise > 0
                            ? `${formatInr(shown.chargeablePaise)} (+${formatInr(shown.surchargePaise)})`
                            : formatInr(shown.chargeablePaise)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable></div></ErpTableShell>
          </div>
          {dirty ? (
            <p className="mt-2 text-[11px] font-semibold text-[var(--muted)]">
              The last column shows the policy as it is saved now. Save to see
              these changes take effect.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} disabled={busy || !dirty} onClick={() => void save()}>
              <Save className="mr-1 inline h-4 w-4" aria-hidden />
              Save policy
            </button>
            {dirty ? (
              <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => setDraft(policy)}>
                Discard changes
              </button>
            ) : null}
            {notice ? (
              <span className="text-[12px] font-semibold text-[var(--brand-deep)]">{notice}</span>
            ) : null}
          </div>
        </>
      )}

      {/* Quoted against actual. The only thing that catches a rate set too low. */}
      {recon ? (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <h5 className="text-[12px] font-bold text-[var(--brand-deep)]">
            What we charged, against what Cashfree deducted
          </h5>
          <p className="text-[11px] text-[var(--muted)]">
            {recon.from} to {recon.to} · from the settlement recon report, so the
            &ldquo;actual&rdquo; column is a subtraction, not an estimate. A
            shortfall means that rail&apos;s rate is set too low and the school is
            quietly absorbing the difference on every payment.
          </p>
          {recon.rails.length === 0 ? (
            <p className="mt-2 text-[12px] text-[var(--muted)]">
              No settled online payments in this window, so there is nothing to
              compare. This is not &ldquo;checked and nil&rdquo;.
            </p>
          ) : (
            <div className="mt-2">
              <ErpTableShell><div className="overflow-x-auto overscroll-x-contain"><ErpTable minWidth="min-w-[560px]">
                <ErpTableHead>
                  <tr>
                    <th className="py-1 text-left">Rail</th>
                    <th className="py-1 text-right">Payments</th>
                    <th className="py-1 text-right">Charged</th>
                    <th className="py-1 text-right">Actual fee</th>
                    <th className="py-1 text-right">Shortfall</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {recon.rails.map((r) => (
                    <tr key={r.group} className="border-t border-[var(--border)]">
                      <td className="py-1.5 font-semibold text-[var(--brand-deep)]">{r.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.payments}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(r.quotedPaise)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(r.actualPaise)}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums font-semibold ${
                          r.shortfallPaise > 0 ? "text-[var(--danger,#a00)]" : "text-[var(--muted)]"
                        }`}
                      >
                        {r.shortfallPaise > 0
                          ? formatInr(r.shortfallPaise)
                          : r.overRecoveredPaise > 0
                            ? `−${formatInr(r.overRecoveredPaise)}`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable></div></ErpTableShell>
            </div>
          )}
          {recon.unmatchedPayments > 0 ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {recon.unmatchedPayments} settled payment(s) could not be matched
              to a checkout started here — taken outside this ERP, or before the
              charge was recorded. Left out rather than counted as zero-charged,
              which would read as a shortfall the school never caused.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
