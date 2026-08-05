"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ACCOUNTS_REPORTS,
  runAccountsReport,
  type AccountsReportFormat,
  type AccountsReportId,
} from "@/lib/accountsReportCatalog";
import {
  HOMEWORK_REPORTS,
  runHomeworkReport,
  type HomeworkReportFormat,
  type HomeworkReportId,
} from "@/lib/homework";
import {
  loadAccounts,
  seedAccountsIfEmpty,
  type AccountsState,
} from "@/lib/accounts";
import {
  STORE_REPORT_CATEGORIES,
  STORE_REPORTS,
  runStoreReport,
  type StoreReportFormat,
  type StoreReportId,
} from "@/lib/storeReportCatalog";
import {
  TRANSPORT_REPORTS,
  runTransportReport,
  type TransportReportFormat,
} from "@/lib/transportReportCatalog";
import { loadTransport, seedTransportIfEmpty } from "@/lib/transport";
import {
  TRUST_REPORTS,
  runTrustReport,
  type TrustReportFormat,
  type TrustReportId,
} from "@/lib/trustReportCatalog";
import { loadTrust, seedTrustIfEmpty } from "@/lib/trust";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function StoreReportsRunner() {
  const [format, setFormat] = useState<StoreReportFormat>("excel");
  const [date, setDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: StoreReportId) {
    const r = runStoreReport(id, { date, format });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as StoreReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/store?tab=reports" className={btnOutline}>
          Open in Store
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      {STORE_REPORT_CATEGORIES.map((cat) => (
        <div key={cat.id}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
            {cat.title}
          </h3>
          <ul className="space-y-1.5">
            {STORE_REPORTS.filter((r) => r.category === cat.id).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button type="button" className={btn} onClick={() => run(r.id)}>
                  Export
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function AccountsReportsRunner() {
  const [state, setState] = useState<AccountsState | null>(null);
  const [date, setDate] = useState(todayIso);
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [asOf, setAsOf] = useState(todayIso);
  const [coaId, setCoaId] = useState("");
  const [format, setFormat] = useState<AccountsReportFormat>("excel");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = seedAccountsIfEmpty();
    setState(s);
    if (!coaId && s.coaAccounts[0]) setCoaId(s.coaAccounts[0].id);
  }, []);

  function run(id: AccountsReportId) {
    const r = runAccountsReport(id, {
      date,
      fromDate,
      toDate,
      asOf,
      coaId,
      format,
      accounts: state ?? loadAccounts(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  if (!state) {
    return <p className="text-sm text-[var(--muted)]">Loading accounts…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          As of
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Ledger account
          <select
            className={`${field} mt-1 block min-w-[180px]`}
            value={coaId}
            onChange={(e) => setCoaId(e.target.value)}
          >
            {state.coaAccounts
              .filter((c) => c.isActive)
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as AccountsReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/accounts?tab=reports" className={btnOutline}>
          Open in Accounts
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {ACCOUNTS_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TransportReportsRunner() {
  const [format, setFormat] = useState<TransportReportFormat>("excel");
  const [date, setDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedTransportIfEmpty();
  }, []);

  function run(id: (typeof TRANSPORT_REPORTS)[number]["id"]) {
    const r = runTransportReport(id, {
      date,
      format,
      transport: loadTransport(),
      masters: loadMasters(),
      sis: loadSis(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TransportReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/transport?tab=reports" className={btnOutline}>
          Open in Transport
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRANSPORT_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrustReportsRunner() {
  const [format, setFormat] = useState<TrustReportFormat>("excel");
  const [projectId, setProjectId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = useMemo(() => {
    const t = seedTrustIfEmpty();
    return t.projects;
  }, []);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  function run(id: TrustReportId) {
    const r = runTrustReport(id, {
      projectId: projectId || undefined,
      format,
      trust: loadTrust(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Project
          <select
            className={`${field} mt-1 block min-w-[14rem]`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TrustReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/trust?tab=reports" className={btnOutline}>
          Open in Trust
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRUST_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeworkReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<HomeworkReportFormat>("excel");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: HomeworkReportId) {
    const r = runHomeworkReport(id, {
      academicYearCode: ay,
      fromDate,
      toDate,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as HomeworkReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/homework?tab=reports" className={btnOutline}>
          Open in Homework
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {HOMEWORK_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

