"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, RefreshCw, X } from "lucide-react";
import { entryIsLive, notLiveReason, type AnswerEntry } from "@/lib/answerBook";

const field =
  "rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

/**
 * The school's answer book.
 *
 * Every question a parent asked that the bot could not answer, with what the
 * office replied. Approving one puts it in front of every parent who asks
 * the same thing from then on — which is why approving is a separate act
 * from writing, and why the screen says plainly what is live and what is not.
 */
export function AnswerBookPanel(props: { canEdit: boolean; canApprove: boolean }) {
  const [entries, setEntries] = useState<AnswerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");

  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/wa/answer-book");
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { entries: AnswerEntry[] }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        return setError(body?.error?.message || "Could not read the answer book");
      }
      setEntries(body.data?.entries ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, unknown>, done: string) {
    setError(null);
    setNotice(null);
    const res = await fetch("/api/v1/wa/answer-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.ok) {
      return setError(body?.error?.message || "That did not work");
    }
    setNotice(done);
    await load();
  }

  const waiting = useMemo(
    () => entries.filter((e) => e.status === "proposed"),
    [entries],
  );
  const live = useMemo(
    () => entries.filter((e) => entryIsLive(e, today)),
    [entries, today],
  );
  const shelved = useMemo(
    () => entries.filter((e) => e.status !== "proposed" && !entryIsLive(e, today)),
    [entries, today],
  );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-[var(--brand-deep)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Answer book</h3>
        <p className="text-xs text-[var(--muted)]">
          What parents asked and the bot could not answer. An approved answer is used for every
          parent who asks the same thing — a proposed one is used for nobody.
        </p>
        <button type="button" className={`${field} ml-auto text-xs`} onClick={() => void load()} disabled={busy}>
          <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
          {busy ? "Reading…" : "Refresh"}
        </button>
      </header>

      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-xs text-[var(--success)]">{notice}</p> : null}

      <p className="text-xs text-[var(--muted)]">
        {live.length} answering now · {waiting.length} waiting · {shelved.length} not in use
      </p>

      {props.canEdit ? (
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
          <div className="text-xs font-semibold text-[var(--brand-deep)]">Write an answer</div>
          <input
            className={`${field} w-full`}
            placeholder="The question, as a parent would ask it — e.g. Security deposit kya hai?"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
          />
          <textarea
            className={`${field} min-h-[70px] w-full`}
            placeholder="The school's answer, in the words you would want a parent to read."
            value={newA}
            onChange={(e) => setNewA(e.target.value)}
          />
          <button
            type="button"
            className={`${field} text-xs font-semibold`}
            disabled={!newQ.trim() || !newA.trim()}
            onClick={async () => {
              await act({ action: "save", question: newQ, answer: newA }, "Saved — it answers nobody until it is approved");
              setNewQ("");
              setNewA("");
            }}
          >
            Save as proposed
          </button>
        </div>
      ) : null}

      {[
        { title: "Waiting for an answer or approval", rows: waiting },
        { title: "Answering parents now", rows: live },
        { title: "Not in use", rows: shelved },
      ].map((group) =>
        group.rows.length ? (
          <div key={group.title} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {group.title}
            </h4>
            <ul className="space-y-2">
              {group.rows.map((e) => (
                <li key={e.id} className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--brand-deep)]">{e.question}</span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {e.category}
                      {e.askedCount > 1 ? ` · asked ${e.askedCount}×` : ""}
                      {e.source === "office_reply" ? " · from an office reply" : ""}
                    </span>
                    {notLiveReason(e, today) ? (
                      <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                        {notLiveReason(e, today)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[11px] text-[var(--success)]">
                        Answering
                      </span>
                    )}
                  </div>
                  {props.canEdit ? (
                    <textarea
                      className={`${field} mt-2 min-h-[60px] w-full`}
                      placeholder="The school's answer…"
                      value={draft[e.id] ?? e.answer}
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.id]: ev.target.value }))}
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-xs">{e.answer || "— no answer yet —"}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {props.canEdit ? (
                      <button
                        type="button"
                        className={field}
                        onClick={() =>
                          act(
                            { action: "save", id: e.id, question: e.question, answer: draft[e.id] ?? e.answer },
                            "Saved",
                          )
                        }
                      >
                        Save
                      </button>
                    ) : null}
                    {props.canApprove && e.status !== "approved" ? (
                      <button
                        type="button"
                        className={`${field} font-semibold`}
                        onClick={() => act({ action: "approve", id: e.id }, "Approved — parents get this answer now")}
                      >
                        <Check className="mr-1 inline h-3 w-3" aria-hidden />
                        Approve
                      </button>
                    ) : null}
                    {props.canApprove && e.status === "approved" ? (
                      <button
                        type="button"
                        className={field}
                        onClick={() => act({ action: "retire", id: e.id }, "Retired — it will not be used again")}
                      >
                        <X className="mr-1 inline h-3 w-3" aria-hidden />
                        Retire
                      </button>
                    ) : null}
                    {e.approvedBy ? (
                      <span className="self-center text-[11px] text-[var(--muted)]">
                        approved by {e.approvedBy}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}
