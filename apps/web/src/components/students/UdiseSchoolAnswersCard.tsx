"use client";

import { useEffect, useState } from "react";
import {
  UDISE_SCHOOL_ANSWER_DEFS,
  type UdiseSchoolAnswerKey,
  type UdiseSchoolAnswers,
} from "@/lib/udiseSchoolAnswers";

const ENDPOINT = "/api/v1/udise/robot/school-answers";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Students → UDISE+ → the questions with one answer for the whole school.
 * The robot types an answer only after a named person has ticked and
 * confirmed it here; a child whose ERP record says otherwise keeps the
 * record's answer. Saved on the server, not in this browser.
 */
export function UdiseSchoolAnswersCard() {
  const [saved, setSaved] = useState<UdiseSchoolAnswers | null>(null);
  const [draft, setDraft] = useState<Partial<Record<UdiseSchoolAnswerKey, boolean>>>({});
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const body = (await res.json()) as UdiseSchoolAnswers & { ok: boolean; error?: string };
        if (!live) return;
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setSaved(body);
        setDraft(body.answers || {});
        setState("ready");
      } catch (e) {
        if (!live) return;
        setState("error");
        setMsg(e instanceof Error ? e.message : "Could not load the school answers.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const dirty = UDISE_SCHOOL_ANSWER_DEFS.some((d) => !!draft[d.key] !== !!saved?.answers[d.key]);
  const ticked = UDISE_SCHOOL_ANSWER_DEFS.filter((d) => draft[d.key]).length;

  const save = async () => {
    setState("saving");
    setMsg("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: draft }),
      });
      const body = (await res.json()) as UdiseSchoolAnswers & { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSaved(body);
      setDraft(body.answers || {});
      setState("ready");
      setMsg("Saved. The robot uses these from the next child it opens.");
    } catch (e) {
      setState("ready");
      setMsg(`Not saved: ${e instanceof Error ? e.message : "try again"}`);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE school answers">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Robot — school answers</h3>
        <p className="text-xs text-[var(--muted)]">
          {saved?.confirmedAt
            ? `Confirmed by ${saved.confirmedBy}, ${when(saved.confirmedAt)}`
            : state === "loading"
              ? "Loading…"
              : "Not confirmed yet — the robot leaves these for you on every child"}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        UDISE+ questions with the same answer for nearly every child. Tick only what is true for this school. The robot
        then fills them on each child&apos;s form — only where the portal box is still empty, outlined in yellow, and
        never saved for you. A child whose ERP record says otherwise (marked CWSN, admitted under RTE, another
        nationality) gets the record&apos;s answer.
      </p>
      {state === "error" ? (
        <p className="mt-3 text-xs text-[var(--danger)]">{msg}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {UDISE_SCHOOL_ANSWER_DEFS.map((d) => (
              <li key={d.key}>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!draft[d.key]}
                    disabled={state !== "ready"}
                    onChange={(e) => setDraft((x) => ({ ...x, [d.key]: e.target.checked }))}
                  />
                  <span>
                    <span className="font-semibold text-[var(--brand-deep)]">{d.question}</span>
                    <br />
                    <span className="text-[var(--muted)]">{d.answer}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={state !== "ready" || !dirty}
              onClick={() => void save()}
            >
              {state === "saving" ? "Saving…" : `Confirm ${ticked} answer${ticked === 1 ? "" : "s"}`}
            </button>
            {msg ? <span className="text-xs text-[var(--muted)]">{msg}</span> : null}
          </div>
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            Also filled from the ERP, without a tick here: last year&apos;s class and result (for children who were with
            us last year) and the distance band (road distance from the family&apos;s village). Admission date is left for
            you — the ERP&apos;s join dates are not the admission register&apos;s.
          </p>
        </>
      )}
    </section>
  );
}
