"use client";

/**
 * The referral reward policy, and the awards it makes due.
 *
 * One policy governs every referral: when it counts, how much comes off, on
 * which head, and how many a parent may earn. Awarding writes an ordinary
 * Masters concession on the referrer's own child, so the discount behaves
 * like every other concession from that moment on.
 */

import { useMemo, useState } from "react";
import type { AdmissionLead } from "@/lib/admissions";
import { formatInr, currentAcademicYearCode } from "@/lib/masters";
import { QueryError } from "@/components/data/QueryError";
import { useScreenMasters } from "@/components/data/useScreenMasters";
import type { SisState } from "@/lib/sis";
import { childrenOfHousehold } from "@/lib/sis";
import { referralCodeFor } from "@/lib/referrals";
import {
  awardReferralForLead,
  loadReferralPolicy,
  pendingReferralAwards,
  policyLabel,
  rewardedLeadIds,
  saveReferralPolicy,
  type ReferralRewardPolicy,
} from "@/lib/referralRewards";

const inp =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--brand-deep)]";

export function ReferralPolicyEditor({
  leads,
  sis,
  by,
}: {
  leads: AdmissionLead[];
  sis: SisState;
  by: string;
}) {
  const [policy, setPolicy] = useState<ReferralRewardPolicy>(() =>
    loadReferralPolicy(),
  );
  // data-layer 2.1g: the server's book (fee heads, concessions), kept fresh
  // by the versions poll; an award's own write is re-read at once (retry).
  const { masters, scope, error: mastersError, retry: retryMasters } = useScreenMasters();
  /** Teaching subset: fee heads and concessions are WITHHELD, not none. */
  const feesWithheld = scope === "teaching";
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);

  const pending = useMemo(
    () => pendingReferralAwards(leads, sis),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, sis, tick, policy.enabled, policy.trigger],
  );
  const done = useMemo(
    () => (masters && !feesWithheld ? rewardedLeadIds(masters) : new Set<string>()),
    [masters, feesWithheld],
  );

  function save(next: ReferralRewardPolicy) {
    setPolicy(next);
    saveReferralPolicy(next);
    setMsg("Policy saved");
    window.setTimeout(() => setMsg(""), 2500);
  }

  function referrerName(lead: AdmissionLead): string {
    const hh =
      sis.households.find((h) => h.id === lead.referredByHouseholdId) ??
      sis.households.find(
        (h) =>
          referralCodeFor(h) === (lead.referralCode || "").trim().toUpperCase(),
      );
    if (!hh) return lead.referralCode || "—";
    // One row per child: the unscoped filter inflated the "+N siblings"
    // count by the number of years each child had been enrolled.
    const kids = childrenOfHousehold(
      sis,
      hh.id,
      currentAcademicYearCode(),
    ).map((s) => s.fullName);
    return `${hh.guardianName || "Parent"}${kids.length ? ` (${kids[0]}${kids.length > 1 ? ` +${kids.length - 1}` : ""})` : ""}`;
  }

  const feeHeads = (masters?.feeHeads ?? []).filter((h) => h.isActive !== false);

  if (!masters) {
    return mastersError ? (
      <QueryError what="the referral policy's fee heads" error={mastersError} retry={retryMasters} />
    ) : (
      <p className="mt-3 text-xs text-[var(--muted)]">Loading referral policy…</p>
    );
  }

  return (
    <section className="mt-3 rounded-xl border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.06)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Referral reward policy
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            {feesWithheld ? "Fee heads are not shown to your role." : policyLabel(policy, masters)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => save({ ...policy, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      {policy.enabled ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[11px] text-[var(--muted)]">
            Reward when
            <select
              className={`${inp} mt-0.5`}
              value={policy.trigger}
              onChange={(e) =>
                save({
                  ...policy,
                  trigger: e.target.value as ReferralRewardPolicy["trigger"],
                })
              }
            >
              <option value="paid_first_month">
                Admitted + one full month&apos;s fee paid
              </option>
              <option value="enrolled">Child takes admission</option>
              <option value="registered">Registration fee paid</option>
              <option value="enquiry">Enquiry received</option>
            </select>
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Discount type
            <select
              className={`${inp} mt-0.5`}
              value={policy.mode}
              onChange={(e) =>
                save({
                  ...policy,
                  mode: e.target.value === "percent" ? "percent" : "fixed",
                  value: e.target.value === "percent" ? 5 : 50000,
                })
              }
            >
              <option value="fixed">Fixed ₹ per month</option>
              <option value="percent">Percent of the head</option>
            </select>
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            {policy.mode === "percent" ? "Percent (%)" : "Amount (₹)"}
            <input
              className={`${inp} mt-0.5`}
              inputMode="decimal"
              value={
                policy.mode === "percent"
                  ? String(policy.value)
                  : String(policy.value / 100)
              }
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.]/g, "");
                const n = Number(raw) || 0;
                setPolicy({
                  ...policy,
                  value:
                    policy.mode === "percent"
                      ? Math.min(100, Math.round(n))
                      : Math.round(n * 100),
                });
              }}
              onBlur={() => save(policy)}
            />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            On fee head
            {feesWithheld ? (
              <span className={`${inp} mt-0.5 block`}>Not shown to your role</span>
            ) : (
            <select
              className={`${inp} mt-0.5`}
              value={policy.feeHeadId}
              onChange={(e) => save({ ...policy, feeHeadId: e.target.value })}
            >
              <option value="">Tuition (default)</option>
              {feeHeads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.nameEn}
                </option>
              ))}
            </select>
            )}
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Max per parent / session
            <input
              className={`${inp} mt-0.5`}
              inputMode="numeric"
              value={String(policy.maxPerSession)}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  maxPerSession: Math.max(
                    0,
                    Number(e.target.value.replace(/\D/g, "")) || 0,
                  ),
                })
              }
              onBlur={() => save(policy)}
              placeholder="0 = no limit"
            />
          </label>
        </div>
      ) : null}

      {msg ? (
        <p className="mt-2 text-[11px] font-semibold text-[var(--success)]">
          {msg}
        </p>
      ) : null}

      {policy.enabled ? (
        <div className="mt-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            Rewards due ({pending.length})
          </div>
          {pending.length === 0 ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Nothing due — a referral appears here once it reaches the stage
              above and the referring parent is identified.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {pending.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--card)] px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {l.childName || "Enquiry"}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · referred by {referrerName(l)}
                      {l.referralCode ? ` · ${l.referralCode}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-60"
                    disabled={busy === l.id || feesWithheld}
                    title={feesWithheld ? "Concessions are not shown to your role" : undefined}
                    onClick={() => {
                      setBusy(l.id);
                      void awardReferralForLead({ lead: l, by })
                        .then((r) => {
                          setMsg(
                            r.ok
                              ? `Reward given — ${r.ruleName} on ${r.studentName}'s fees`
                              : r.error,
                          );
                          setTick((t) => t + 1);
                          // The award wrote a concession: show it now, not at the next poll.
                          if (r.ok) void retryMasters();
                        })
                        .finally(() => setBusy(""));
                    }}
                  >
                    {busy === l.id ? "Awarding…" : "Award reward"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {done.size > 0 ? (
            <p className="mt-1.5 text-[10px] text-[var(--muted)]">
              {done.size} referral{done.size === 1 ? "" : "s"} already rewarded ·
              the discounts live in Masters → Concessions, where they can be
              changed or stopped.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
        A reward creates a normal concession on the referring parent&apos;s own
        child, so it shows on their fee line, follows them across sessions, and
        can be edited or ended from Masters → Concessions like any other
        discount. Awarding twice for the same enquiry is refused.
        {formatInr(0) ? "" : ""}
      </p>
    </section>
  );
}
