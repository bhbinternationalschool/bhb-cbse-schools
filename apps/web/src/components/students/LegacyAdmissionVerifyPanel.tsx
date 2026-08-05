"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import {
  listPendingSystemAdmissions,
  verifyAllPendingSystemAdmissions,
  verifyAndAssignSystemAdmission,
} from "@/lib/studentLegacyAdmission";
import { useDemoSession } from "@/components/shell/SessionContext";

export function LegacyAdmissionVerifyPanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState, message?: string) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const ay =
    session.academicYearCode ||
    (masters ? currentAcademicYearCode(masters) : "");

  const pending = useMemo(() => {
    if (!sis) return [] as SisStudent[];
    return listPendingSystemAdmissions(sis, ay);
  }, [sis, ay]);

  function classLabel(s: SisStudent): string {
    if (!masters) return "—";
    const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
    const sec = masters.sections.find((x) => x.id === s.sectionId)?.name;
    return sec ? `${cls}-${sec}` : cls;
  }

  function verifyOne(id: string) {
    setError(null);
    const res = verifyAndAssignSystemAdmission(id, masters ?? undefined);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSis(res.sis);
    onChanged?.(
      res.sis,
      `Assigned system admission ${res.student.admissionNo} (ERP ${res.student.legacyErpAdmissionNo})`,
    );
    setNotice(`Assigned ${res.student.admissionNo}`);
    window.setTimeout(() => setNotice(null), 2500);
  }

  function verifyAll() {
    if (!pending.length) return;
    setBusy(true);
    setError(null);
    const res = verifyAllPendingSystemAdmissions(masters ?? undefined);
    refresh();
    setBusy(false);
    if (res.assigned > 0) {
      const next = loadSis();
      onChanged?.(
        next,
        `Assigned system admission numbers to ${res.assigned} imported student(s)`,
      );
      setNotice(`Assigned ${res.assigned} student(s)`);
      window.setTimeout(() => setNotice(null), 3000);
    }
    if (res.errors.length) {
      setError(res.errors.slice(0, 5).join(" · "));
    }
  }

  if (!sis || !masters) return null;

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Legacy import — verify admission numbers
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            Imported students with a <strong>duplicate name</strong> in the
            session are held until you verify. The file&apos;s number is stored
            as <strong>Old ERP admission no.</strong>; after verify, a unique{" "}
            <strong>system admission no.</strong> is assigned. Manual new-entry
            students are not affected.
          </p>
        </div>
        {pending.length > 0 ? (
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={verifyAll}
          >
            {busy ? "Assigning…" : `Assign all (${pending.length})`}
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(15,118,110,0.1)] px-3 py-2 text-xs font-medium text-[#0f766e]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          {error}
        </p>
      ) : null}

      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          No pending legacy imports for session {ay}.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)]">
          {pending.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-[var(--brand-deep)]">
                  {s.fullName}
                </div>
                <p className="text-[11px] text-[var(--muted)]">
                  Old ERP: {s.legacyErpAdmissionNo || "—"} · {classLabel(s)} ·
                  Adm date {s.joinedOn || "—"}
                </p>
                <p className="text-[11px] text-amber-800">
                  Pending system admission — duplicate name in session
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/students/${s.id}/edit`}
                  className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold"
                >
                  Review profile
                </Link>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={() => verifyOne(s.id)}
                >
                  Verify &amp; assign no.
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
