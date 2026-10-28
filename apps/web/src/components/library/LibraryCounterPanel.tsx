"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { formatInr } from "@/lib/masters";
import {
  LIBRARY_CONDITIONS,
  copyLocation,
  fineRuleOf,
  type LibraryItemCondition,
  type LibraryState,
} from "@/lib/library";
import { dueDateFor, fineToDate, libraryToday, splitScannedCodes, type LibraryBorrowerRef } from "@/lib/libraryCounter";
import {
  libraryApi,
  type CounterLoanDto,
  type IssueResultDto,
  type LibraryRulesDto,
  type ReturnResultDto,
} from "@/lib/libraryCounterClient";
import { LibraryFineSettle } from "@/components/library/LibraryFineSettle";

type Person = { id: string; label: string; sub: string };

/** The school's calendar day (IST). */
function todayIso() {
  return libraryToday();
}

/**
 * The counter: scan (or type) accession numbers, pick the borrower, issue
 * them all in one go; or scan books back in and see each fine as it is
 * worked out. Everything is done on the server; the desk reloads after.
 */
export function LibraryCounterPanel({
  state,
  students,
  staff,
  ay,
  readOnly,
  rulesReadOnly,
  onChanged,
  onError,
}: {
  state: LibraryState;
  students: Person[];
  staff: Person[];
  ay: string;
  readOnly: boolean;
  /** The loan rules card: the Store grant's only. Defaults to readOnly. */
  rulesReadOnly?: boolean;
  /** Reload the desk from the server, then show the message. */
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"issue" | "return">("issue");
  const [borrowerType, setBorrowerType] = useState<"student" | "staff">("student");
  const [query, setQuery] = useState("");
  const [borrower, setBorrower] = useState<(LibraryBorrowerRef & { label: string }) | null>(null);
  const [account, setAccount] = useState<{ open: CounterLoanDto[]; finesDue: CounterLoanDto[] } | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [dueOn, setDueOn] = useState("");
  const [returnedOn, setReturnedOn] = useState(todayIso());
  const [condition, setCondition] = useState<LibraryItemCondition>("good");
  const [damageNote, setDamageNote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issueResults, setIssueResults] = useState<IssueResultDto[] | null>(null);
  const [returnResults, setReturnResults] = useState<ReturnResultDto[] | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const rule = fineRuleOf(state);
  const today = todayIso();

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const pool = borrowerType === "student" ? students : staff;
    return pool.filter((p) => p.label.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q)).slice(0, 8);
  }, [query, borrowerType, students, staff]);

  async function loadAccount(b: LibraryBorrowerRef) {
    setAccount(null);
    setAccountError(null);
    const r = await libraryApi.borrower(b);
    if (!r.ok) setAccountError(r.error);
    else setAccount({ open: r.open, finesDue: r.finesDue });
  }

  useEffect(() => {
    if (borrower) void loadAccount(borrower);
  }, [borrower]);

  function addScanned(text: string) {
    const { codes, rejected } = splitScannedCodes(text);
    if (rejected.length) onError(`Not accession numbers: ${rejected.join(", ")}`);
    setQueue((q) => {
      const seen = new Set(q.map((c) => c.toUpperCase()));
      return [...q, ...codes.filter((c) => !seen.has(c.toUpperCase()))];
    });
    setScan("");
    scanRef.current?.focus();
  }

  /** What the desk knows about a queued code — a hint only; the server decides. */
  function describe(code: string) {
    const key = code.toUpperCase();
    const copy = state.copies.find((c) => c.accessionNo.toUpperCase() === key || c.barcode.toUpperCase() === key);
    if (!copy) return { title: "Not in the catalogue on this screen", status: "", location: "", openDue: "" };
    const title = state.titles.find((t) => t.id === copy.titleId)?.title || "(title missing)";
    const open = state.issues.find((i) => i.copyId === copy.id && !i.returnedOn);
    return { title, status: copy.status, location: copyLocation(copy, state), openDue: open?.dueOn || "" };
  }

  async function doIssue() {
    if (!borrower) return onError("Choose who is borrowing first");
    if (!queue.length) return onError("Scan or type at least one accession number");
    setBusy(true);
    const r = await libraryApi.issue({
      borrower: { type: borrower.type, id: borrower.id },
      codes: queue,
      issuedOn,
      dueOn: dueOn || undefined,
      academicYearCode: ay,
      note,
      issueCondition: condition,
      damageNote,
    });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setIssueResults(r.results);
    const done = r.results.filter((x) => x.ok).length;
    // Keep only what did not go out, so the clerk can fix and retry those.
    setQueue(r.results.filter((x) => !x.ok).map((x) => x.code));
    setNote("");
    setDamageNote("");
    setCondition("good");
    await onChanged(`${done} of ${r.results.length} issued to ${r.borrowerName}`);
    void loadAccount(borrower);
  }

  async function doReturn() {
    if (!queue.length) return onError("Scan or type at least one accession number");
    setBusy(true);
    const r = await libraryApi.returnBooks({ codes: queue, returnedOn, returnCondition: condition, damageNote });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setReturnResults(r.results);
    setQueue(r.results.filter((x) => !x.ok).map((x) => x.code));
    setDamageNote("");
    setCondition("good");
    const done = r.results.filter((x) => x.ok);
    const fines = done.reduce((s, x) => s + (x.finePaise ?? 0), 0);
    await onChanged(`${done.length} of ${r.results.length} returned${fines ? ` · fines ${formatInr(fines)}` : ""}`);
  }

  const defaultDue = dueDateFor(issuedOn, state.settings.loanDays) || "";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Counter mode">
          {(["issue", "return"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? btn : btnOutline}
              onClick={() => {
                setMode(m);
                setQueue([]);
                setIssueResults(null);
                setReturnResults(null);
              }}
            >
              {m === "issue" ? "Issue books" : "Return books"}
            </button>
          ))}
        </div>

        {mode === "issue" ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">1 · Borrower</p>
            <div className="flex gap-2">
              {(["student", "staff"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={borrowerType === t ? btn : btnOutline}
                  onClick={() => {
                    setBorrowerType(t);
                    setBorrower(null);
                    setQuery("");
                  }}
                >
                  {t === "student" ? "Student" : "Staff"}
                </button>
              ))}
            </div>
            {borrower ? (
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
                <p className="text-sm font-semibold">{borrower.label}</p>
                <button type="button" className="text-xs font-semibold text-[var(--brand-deep)] underline" onClick={() => setBorrower(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className={field}
                  placeholder={borrowerType === "student" ? "Name or admission no." : "Name or employee code"}
                  aria-label="Find the borrower"
                />
                {hits.length ? (
                  <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                    {hits.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                          onClick={() => {
                            setBorrower({ type: borrowerType, id: p.id, label: `${p.label}${p.sub ? ` · ${p.sub}` : ""}` });
                            setQuery("");
                            scanRef.current?.focus();
                          }}
                        >
                          {p.label} <span className="text-xs text-[var(--muted)]">{p.sub}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {mode === "issue" ? "2 · Books" : "Books coming back"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addScanned(scan);
            }}
            className="flex gap-2"
          >
            <input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              className={field}
              placeholder="Scan the label, or type the accession no. and press Enter"
              aria-label="Accession number"
              autoComplete="off"
            />
            <button type="submit" className={btnOutline}>
              Add
            </button>
          </form>
          {queue.length ? (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {queue.map((code) => {
                const d = describe(code);
                const owed = d.openDue ? fineToDate(rule, { dueOn: d.openDue }, mode === "return" ? returnedOn : today) : null;
                return (
                  <li key={code} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold">{code}</p>
                      <p className="truncate">{d.title}</p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {[d.location && `Shelf ${d.location}`, d.status, d.openDue && `due ${d.openDue}`, owed ? `fine ${formatInr(owed)}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--danger)] underline"
                      onClick={() => setQueue((q) => q.filter((c) => c !== code))}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">Nothing scanned yet. A scanner types the number and presses Enter for you.</p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "issue" ? (
            <>
              <label className="block text-xs text-[var(--muted)]">
                Issued on
                <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Due on (blank = {state.settings.loanDays} days{defaultDue ? `, ${defaultDue}` : ""})
                <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={`${field} mt-1`} />
              </label>
            </>
          ) : (
            <label className="block text-xs text-[var(--muted)]">
              Returned on
              <input type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} className={`${field} mt-1`} />
            </label>
          )}
          <label className="block text-xs text-[var(--muted)]">
            Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value as LibraryItemCondition)} className={`${field} mt-1`}>
              {LIBRARY_CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {condition === "damaged" || condition === "torn" ? (
            <label className="block text-xs text-[var(--muted)] sm:col-span-2">
              Damage note
              <input value={damageNote} onChange={(e) => setDamageNote(e.target.value)} className={`${field} mt-1`} />
            </label>
          ) : null}
          {mode === "issue" ? (
            <label className="block text-xs text-[var(--muted)] sm:col-span-2">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} className={`${field} mt-1`} />
            </label>
          ) : null}
        </div>

        {!readOnly ? (
          <button
            type="button"
            className={btn}
            disabled={busy || !queue.length || (mode === "issue" && !borrower)}
            onClick={() => void (mode === "issue" ? doIssue() : doReturn())}
          >
            {busy ? "Working…" : mode === "issue" ? `Issue ${queue.length || ""} book(s)` : `Return ${queue.length || ""} book(s)`}
          </button>
        ) : null}

        {issueResults && mode === "issue" ? (
          <ul className="space-y-1 text-sm">
            {issueResults.map((r) => (
              <li key={r.code} className={r.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                <span className="font-mono text-xs">{r.code}</span> — {r.ok ? `${r.title} · due ${r.dueOn}` : r.error}
              </li>
            ))}
          </ul>
        ) : null}
        {returnResults && mode === "return" ? (
          <ul className="space-y-2 text-sm">
            {returnResults.map((r) => (
              <li key={r.code} className="rounded-lg border border-[var(--border)] px-3 py-2">
                <p className={r.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  <span className="font-mono text-xs">{r.code}</span> — {r.ok ? `${r.title} back from ${r.borrowerName}` : r.error}
                </p>
                {r.ok ? (
                  <p className="text-xs text-[var(--muted)]">
                    {r.daysLate ? `${r.daysLate} day(s) late` : "On time"}
                    {r.finePaise ? ` · fine ${formatInr(r.finePaise)}` : " · no fine"}
                  </p>
                ) : null}
                {r.ok && r.finePaise && r.issueId ? (
                  <div className="mt-2">
                    <LibraryFineSettle
                      issueId={r.issueId}
                      finePaise={r.finePaise}
                      readOnly={readOnly}
                      onError={onError}
                      onDone={async (msg) => {
                        setReturnResults((rs) => (rs ?? []).map((x) => (x.issueId === r.issueId ? { ...x, finePaise: 0 } : x)));
                        await onChanged(msg);
                      }}
                    />
                    <p className="mt-1 text-[11px] text-[var(--muted)]">Not paying now? The fine stays in Circulation → Fines to collect.</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-4">
        {mode === "issue" && borrower ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">{borrower.label}</h2>
            {accountError ? (
              <p className="mt-2 text-sm text-[var(--danger)]">Could not load this borrower&apos;s loans: {accountError}</p>
            ) : !account ? (
              <p className="mt-2 text-sm text-[var(--muted)]">Loading loans…</p>
            ) : (
              <>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Out now ({account.open.length} of {borrower.type === "staff" ? state.settings.maxBooksPerStaff : state.settings.maxBooksPerStudent})
                </p>
                {account.open.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {account.open.map((l) => {
                      const owed = fineToDate(rule, l, today);
                      return (
                        <li key={l.id}>
                          <span className="font-mono text-xs">{l.accessionNo}</span> {l.title} · due {l.dueOn}
                          {l.dueOn < today ? (
                            <span className="text-[var(--danger)]"> · overdue{owed ? `, fine so far ${formatInr(owed)}` : ""}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--muted)]">Nothing out.</p>
                )}
                {account.finesDue.length ? (
                  <>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--danger)]">Fines owed</p>
                    <ul className="mt-1 space-y-2 text-sm">
                      {account.finesDue.map((l) => (
                        <li key={l.id}>
                          <p>
                            {l.title} · returned {l.returnedOn} · {formatInr(l.finePaise)}
                          </p>
                          <LibraryFineSettle
                            issueId={l.id}
                            finePaise={l.finePaise}
          collecting={l.fineStatus === "collecting"}
                            readOnly={readOnly}
                            onError={onError}
                            onDone={async (msg) => {
                              await onChanged(msg);
                              void loadAccount(borrower);
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <LibraryRulesCard readOnly={rulesReadOnly ?? readOnly} onChanged={onChanged} onError={onError} />
      </div>
    </div>
  );
}

/** Loan days, limits and the fine rule — saved on the server. */
function LibraryRulesCard({
  readOnly,
  onChanged,
  onError,
}: {
  readOnly: boolean;
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [rules, setRules] = useState<LibraryRulesDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<keyof LibraryRulesDto, string> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void libraryApi.rules().then((r) => {
      if (!r.ok) setLoadError(r.error);
      else setRules(r.rules);
    });
  }, []);

  function startEdit(r: LibraryRulesDto) {
    setForm({
      loanDays: String(r.loanDays),
      maxBooksPerStudent: String(r.maxBooksPerStudent),
      maxBooksPerStaff: String(r.maxBooksPerStaff),
      finePaisePerDay: String(r.finePaisePerDay / 100),
      graceDays: String(r.graceDays),
      capPaise: String(r.capPaise / 100),
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    const r = await libraryApi.saveRules({
      loanDays: Number(form.loanDays),
      maxBooksPerStudent: Number(form.maxBooksPerStudent),
      maxBooksPerStaff: Number(form.maxBooksPerStaff),
      finePaisePerDay: Math.round(Number(form.finePaisePerDay) * 100),
      graceDays: Number(form.graceDays),
      capPaise: Math.round(Number(form.capPaise) * 100),
    });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setRules(r.rules);
    setForm(null);
    await onChanged("Library rules saved");
  }

  const fields: { key: keyof LibraryRulesDto; label: string }[] = [
    { key: "loanDays", label: "Loan days" },
    { key: "maxBooksPerStudent", label: "Books per student" },
    { key: "maxBooksPerStaff", label: "Books per staff member" },
    { key: "finePaisePerDay", label: "Fine per late day (₹)" },
    { key: "graceDays", label: "Grace days (free)" },
    { key: "capPaise", label: "Most one loan can owe (₹, 0 = no cap)" },
  ];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">Rules</h2>
        {rules && !form && !readOnly ? (
          <button type="button" className="text-xs font-semibold text-[var(--brand-deep)] underline" onClick={() => startEdit(rules)}>
            Change
          </button>
        ) : null}
      </div>
      {loadError ? (
        <p className="mt-2 text-sm text-[var(--danger)]">Could not load the rules: {loadError}</p>
      ) : !rules ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
      ) : form ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <label key={f.key} className="block text-xs text-[var(--muted)]">
              {f.label}
              <input
                type="number"
                min={0}
                step={f.key === "finePaisePerDay" || f.key === "capPaise" ? "0.5" : "1"}
                value={form[f.key]}
                onChange={(e) => setForm((cur) => (cur ? { ...cur, [f.key]: e.target.value } : cur))}
                className={`${field} mt-1`}
              />
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void save()}>
              Save rules
            </button>
            <button type="button" className={btnOutline} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            Loan {rules.loanDays} days · up to {rules.maxBooksPerStudent} books a student, {rules.maxBooksPerStaff} a staff member
          </li>
          <li>
            Fine {formatInr(rules.finePaisePerDay)} a day after {rules.graceDays} free day(s)
            {rules.capPaise ? `, at most ${formatInr(rules.capPaise)} a loan` : ", no cap"}
          </li>
          <li className="text-xs text-[var(--muted)]">
            The fine is worked out when the book comes back. Collecting it books a receipt in Accounts (Other Income); waiving it needs a reason.
          </li>
        </ul>
      )}
    </div>
  );
}
