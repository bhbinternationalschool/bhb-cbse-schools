"use client";

/**
 * "This parent is not on WhatsApp — get a number while they are here."
 *
 * Ten of this school's families cannot receive a single WhatsApp message,
 * and until now the only screen that knew was Automation → Bad numbers,
 * which the people who actually meet parents do not open. The fee counter
 * clerk hands a receipt to a father whose number bounces every reminder,
 * and nothing on the screen says so.
 *
 * So the reminder goes where the parent is: the student roster and the fee
 * counter. Ask, type, verify with Meta, done — and the moment a number is
 * confirmed the reminder disappears for that family, because a warning that
 * outlives the problem is how the office learns to ignore warnings.
 *
 * It stays silent unless the problem is ESTABLISHED (see waNumberGap.ts):
 * a number nobody has checked is not a bad number.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Loader2, MessageCircle } from "lucide-react";
import {
  isValidMobile,
  loadSis,
  normalizeMobile,
  updateHouseholdWhatsApp,
  type SisState,
} from "@/lib/sis";
import { ensureSisHydrated } from "@/lib/sisPersistence";
import { withHydrationSlot } from "@/lib/deskHydrateGuard";
import { classLabelForStudent } from "@/lib/parentPortal";
import type { MastersState } from "@/lib/masters";
import {
  studentsNeedingWaNumber,
  waGapHeadline,
  type WaGapStudent,
  type WaVerdictMap,
} from "@/lib/waNumberGap";

type VerifyState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "verified"; mobile: string }
  | { kind: "saved_unverified"; mobile: string }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

/**
 * The verdicts are the same for every mount, so they are fetched once per
 * page life and shared. Two screens and a modal all asking at once used to
 * mean three identical round trips on every render of the fee counter.
 */
let verdictCache: {
  at: number;
  promise: Promise<{ ok: boolean; verdicts: WaVerdictMap; configured: boolean }>;
} | null = null;
const VERDICT_TTL_MS = 5 * 60_000;

function loadVerdicts(force = false): Promise<{
  ok: boolean;
  verdicts: WaVerdictMap;
  configured: boolean;
}> {
  if (!force && verdictCache && Date.now() - verdictCache.at < VERDICT_TTL_MS) {
    return verdictCache.promise;
  }
  const promise = fetch("/api/wa/number-verify")
    .then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        verdicts?: WaVerdictMap;
        configured?: boolean;
      };
      // A failed read is NOT "everybody is fine": returning ok:false keeps
      // the banner quiet rather than green.
      return {
        ok: !!res.ok && !!json.ok,
        verdicts: json.verdicts || {},
        configured: !!json.configured,
      };
    })
    .catch(() => ({ ok: false, verdicts: {} as WaVerdictMap, configured: false }));
  verdictCache = { at: Date.now(), promise };
  return promise;
}

/** Called after a number is saved, so other screens re-read the verdicts. */
export function invalidateWaVerdictCache(): void {
  verdictCache = null;
}

export function WaNumberGapBanner({
  sis,
  masters,
  studentIds,
  onSaved,
  title,
}: {
  /**
   * Omit it and the banner loads the roster itself — so the dashboard can
   * mount it as one line without learning how SIS hydration works. Pass it
   * on a screen that already holds SIS, so both show the same roster.
   */
  sis?: SisState | null;
  masters?: MastersState | null;
  /** Scope to these students — the fee counter passes the family at the desk. */
  studentIds?: string[];
  /** The page holds SIS in state; tell it to re-read after a save. */
  onSaved?: () => void;
  title?: string;
}) {
  const [verdicts, setVerdicts] = useState<WaVerdictMap | null>(null);
  const [ownSis, setOwnSis] = useState<SisState | null>(null);
  const [configured, setConfigured] = useState(true);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, VerifyState>>({});
  /** Households cleared in this session — removed from the list on screen. */
  const [cleared, setCleared] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void loadVerdicts().then((r) => {
      if (!alive) return;
      setVerdicts(r.ok ? r.verdicts : null);
      setConfigured(r.configured);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Nobody handed us a roster: fetch one. `undefined` means "not supplied";
  // an explicit `null` means the caller has SIS and it is not ready yet, and
  // must not be second-guessed.
  const selfLoad = sis === undefined;
  useEffect(() => {
    if (!selfLoad) return;
    let alive = true;
    const read = () => {
      if (!alive) return null;
      const next = loadSis();
      setOwnSis(next);
      return next;
    };
    // The roster is the biggest payload this app pulls (~2.5 MB). If the
    // browser already holds one, use it: a banner is not a reason to make
    // the dashboard fetch the whole school. Only an empty cache hydrates,
    // and then through the shared slot like every other desk.
    const local = read();
    if (!local || local.students.length === 0) {
      void withHydrationSlot(() => ensureSisHydrated())
        .then(() => read())
        .catch(() => read());
    }
    window.addEventListener("bhb-sis-updated", read);
    return () => {
      alive = false;
      window.removeEventListener("bhb-sis-updated", read);
    };
  }, [selfLoad]);

  const roster = selfLoad ? ownSis : (sis ?? null);

  const rows = useMemo(() => {
    if (!verdicts) return [];
    return studentsNeedingWaNumber(roster, verdicts, {
      studentIds,
      classLabel: (s) =>
        classLabelForStudent(
          s as Parameters<typeof classLabelForStudent>[0],
          masters ?? undefined,
        ),
    }).filter((r) => !cleared.includes(r.gap.householdId));
  }, [verdicts, roster, studentIds, masters, cleared]);

  const scoped = !!studentIds;

  useEffect(() => {
    // Scoped to one family at the counter: open, because that is the ask.
    if (scoped) setOpen(true);
  }, [scoped, rows.length]);

  const verify = useCallback(
    async (row: WaGapStudent, saveUnverified: boolean) => {
      const key = row.gap.householdId;
      const mobile = normalizeMobile(drafts[key] || "");
      if (!isValidMobile(mobile)) {
        setStates((s) => ({
          ...s,
          [key]: { kind: "error", message: "Enter the 10-digit number" },
        }));
        return;
      }

      const save = (kind: "verified" | "saved_unverified") => {
        const saved = updateHouseholdWhatsApp(key, mobile);
        if (!saved.ok) {
          setStates((s) => ({
            ...s,
            [key]: { kind: "error", message: saved.error },
          }));
          return false;
        }
        invalidateWaVerdictCache();
        setStates((s) => ({ ...s, [key]: { kind, mobile } }));
        if (selfLoad) setOwnSis(loadSis());
        onSaved?.();
        // Let the office SEE the green tick before the row goes.
        window.setTimeout(() => {
          setCleared((c) => (c.includes(key) ? c : [...c, key]));
        }, 2200);
        return true;
      };

      if (saveUnverified) {
        save("saved_unverified");
        return;
      }

      setStates((s) => ({ ...s, [key]: { kind: "checking" } }));
      try {
        const res = await fetch("/api/wa/number-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobile }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          onWhatsApp?: boolean | null;
          error?: string;
        };
        if (!res.ok) {
          setStates((s) => ({
            ...s,
            [key]: {
              kind: "error",
              message: json.error || "Could not check this number",
            },
          }));
          return;
        }
        if (json.onWhatsApp === true) {
          save("verified");
          return;
        }
        if (json.onWhatsApp === false) {
          // Saving this would swap one dead number for another.
          setStates((s) => ({
            ...s,
            [key]: {
              kind: "rejected",
              message:
                "Meta says this number is also not on WhatsApp. Ask for the number they use WhatsApp on.",
            },
          }));
          return;
        }
        setStates((s) => ({
          ...s,
          [key]: {
            kind: "error",
            message:
              json.error ||
              "Meta did not answer. You can save it without verifying.",
          },
        }));
      } catch (e) {
        setStates((s) => ({
          ...s,
          [key]: {
            kind: "error",
            message: e instanceof Error ? e.message : "Check failed",
          },
        }));
      }
    },
    [drafts, onSaved, selfLoad],
  );

  // Nothing established, nothing to say. No "all good" banner either: the
  // desk is not the place to celebrate the absence of a problem.
  if (!rows.length) return null;

  const headline = title || waGapHeadline(rows);

  return (
    <section
      className="overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50/80 shadow-sm dark:bg-amber-500/10"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-300/70 bg-amber-100/70 px-3 py-2 dark:bg-amber-500/15">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-600" />
        </span>
        <AlertTriangle
          className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
        <p className="text-[13px] font-extrabold uppercase tracking-wide text-amber-900 dark:text-amber-200">
          {headline}
        </p>
        <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          Ask the parent for their WhatsApp number and enter it here
        </span>
        {!scoped ? (
          <button
            type="button"
            className="ml-auto rounded-lg border border-amber-500 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 dark:bg-transparent dark:text-amber-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide list" : `Show ${rows.length}`}
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="divide-y divide-amber-200/70">
          {rows.map((row) => {
            const key = row.gap.householdId;
            const st = states[key] || { kind: "idle" };
            const busy = st.kind === "checking";
            const done = st.kind === "verified" || st.kind === "saved_unverified";
            return (
              <li key={row.studentId} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="text-sm font-bold text-[var(--brand-deep)]">
                    {row.studentName}
                  </p>
                  {row.className ? (
                    <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                      {row.className}
                    </span>
                  ) : null}
                  {row.fatherName ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      s/o {row.fatherName}
                    </span>
                  ) : null}
                  {row.gap.guardianName ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      · {row.gap.guardianName}
                    </span>
                  ) : null}
                </div>

                <p className="mt-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  {row.gap.headline}
                  {row.gap.numbers.length ? (
                    <span className="font-normal text-[var(--muted)]">
                      {" — "}
                      {row.gap.numbers
                        .map((n) => `${n.mobile10} (${n.label})`)
                        .join(", ")}
                    </span>
                  ) : null}
                </p>

                {done ? (
                  <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-[var(--success-soft,rgba(22,132,80,0.12))] px-2 py-1.5 text-[12px] font-bold text-[var(--success,#16794f)]">
                    <BadgeCheck className="size-4" aria-hidden />
                    {st.kind === "verified"
                      ? `Verified on WhatsApp — ${st.mobile} saved for this family`
                      : `Saved ${st.mobile} — not verified with Meta yet, it will be confirmed on the first message`}
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-2 py-1 dark:bg-transparent">
                      <MessageCircle
                        className="size-3.5 text-[#25D366]"
                        aria-hidden
                      />
                      <span className="text-[11px] font-bold text-[var(--muted)]">
                        +91
                      </span>
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={14}
                        placeholder="WhatsApp number"
                        aria-label={`WhatsApp number for ${row.studentName}`}
                        className="w-36 bg-transparent text-sm font-semibold tabular-nums outline-none"
                        value={drafts[key] ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void verify(row, false);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
                      disabled={busy}
                      onClick={() => void verify(row, false)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <BadgeCheck className="size-3.5" aria-hidden />
                      )}
                      {busy ? "Checking with Meta…" : "Verify & save"}
                    </button>
                    {st.kind === "error" || !configured ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] hover:bg-white"
                        disabled={busy}
                        onClick={() => void verify(row, true)}
                        title="Save the number now; WhatsApp will confirm it on the first message"
                      >
                        Save without verifying
                      </button>
                    ) : null}
                  </div>
                )}

                {st.kind === "rejected" ? (
                  <p className="mt-1 text-[11px] font-bold text-[var(--danger)]">
                    {st.message}
                  </p>
                ) : null}
                {st.kind === "error" ? (
                  <p className="mt-1 text-[11px] font-semibold text-[var(--muted)]">
                    {st.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!configured ? (
        <p className="border-t border-amber-200/70 px-3 py-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
          WhatsApp is not connected on this server, so numbers cannot be
          checked with Meta right now — they can still be collected and saved.
        </p>
      ) : null}
    </section>
  );
}
