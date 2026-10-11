"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toolsGet, type LookupStudent } from "@/lib/feeToolsClient";

/**
 * Find a student on the server (name, admission no, parent mobile) for the
 * Bulk & PDC screens. Asks the server on every settled query — this screen
 * holds no roster of its own.
 */
export function FeeToolsStudentPicker({
  onPick,
  placeholder = "Find a student — name, admission no or parent mobile",
  disabled,
}: {
  onPick: (s: LookupStudent) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LookupStudent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      setError("");
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await toolsGet<{ students: LookupStudent[] }>(`/api/fees/tools/lookup?q=${encodeURIComponent(needle)}`);
      if (my !== seq.current) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setHits([]);
        return;
      }
      setError("");
      setHits(r.students);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
        <Search className="size-4 text-[var(--muted)]" aria-hidden />
        <input
          className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {loading ? <span className="text-[11px] text-[var(--muted)]">Searching…</span> : null}
      </label>
      {error ? <p className="mt-1 text-xs font-medium text-[var(--danger)]">{error}</p> : null}
      {hits.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--shadow-2,0_12px_32px_rgba(0,0,0,0.18))]">
          {hits.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                onClick={() => {
                  onPick(s);
                  setQ("");
                  setHits([]);
                }}
              >
                <span className="text-sm font-semibold text-[var(--brand-deep)]">
                  {s.name} <span className="font-normal text-[var(--muted)]">· {s.classLabel || "—"} · {s.admissionNo}</span>
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {s.guardianName}
                  {s.siblingIds.length ? ` · ${s.siblingIds.length} sibling${s.siblingIds.length === 1 ? "" : "s"}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
