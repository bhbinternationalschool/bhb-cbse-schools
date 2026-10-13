"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";

type Data = { byStaff: Record<string, string[]>; updatedAt: string; updatedBy?: string };

/**
 * Staff → Allocate teaching → Co-ordinators (director, 13 Oct 2026).
 *
 * Choose a member of staff, tick their classes. A class has one
 * co-ordinator: a class already given to someone else shows their name and
 * cannot be ticked. On a day a class's teacher is absent, its co-ordinator
 * sees that class in Attendance (web and staff app) and can take the
 * register for that day (lib/attendanceCover). Saved on the server at once.
 */
export function CoordinatorsPanel({ masters, canEdit }: { masters: MastersState; canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [staffId, setStaffId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/staff/coordinators", { cache: "no-store" });
      const body = (await res.json()) as Data & { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData({ byStaff: body.byStaff, updatedAt: body.updatedAt, updatedBy: body.updatedBy });
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the co-ordinators");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const staff = useMemo(
    () =>
      (masters.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [masters],
  );
  const nameOf = (id: string) => masters.staff.find((s) => s.id === id)?.fullName || "Former staff";

  const classes = useMemo(() => {
    const order = [...masters.classes].filter((c) => c.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
    return order
      .map((c) => ({
        id: c.id,
        name: c.name,
        sections: masters.sections.filter((s) => s.classId === c.id && s.isActive !== false),
      }))
      .filter((c) => c.sections.length > 0);
  }, [masters]);
  const label = (key: string) => {
    const [c, s] = key.split("|");
    const cls = masters.classes.find((x) => x.id === c);
    const sec = masters.sections.find((x) => x.id === s);
    const many = masters.sections.filter((x) => x.classId === c && x.isActive !== false).length > 1;
    return [cls?.name || "Class", many ? sec?.name : ""].filter(Boolean).join(" ");
  };

  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const [sid, keys] of Object.entries(data?.byStaff ?? {})) for (const k of keys) m.set(k, sid);
    return m;
  }, [data]);

  function choose(id: string) {
    setStaffId(id);
    setPicked(new Set(data?.byStaff[id] ?? []));
    setMsg(null);
  }

  async function save(forStaff: string, keys: string[]) {
    if (!data) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/staff/coordinators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: forStaff, sectionKeys: keys, baseUpdatedAt: data.updatedAt }),
      });
      const body = (await res.json()) as Data & { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData({ byStaff: body.byStaff, updatedAt: body.updatedAt, updatedBy: body.updatedBy });
      setMsg({
        ok: true,
        text: keys.length
          ? `Saved — ${nameOf(forStaff)} is co-ordinator of ${keys.map(label).join(", ")}.`
          : `${nameOf(forStaff)} is no longer a co-ordinator.`,
      });
      if (forStaff === staffId) setPicked(new Set(body.byStaff[forStaff] ?? []));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved — try again." });
      void load();
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(data?.byStaff ?? {}).sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Class co-ordinators">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Co-ordinators</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Give a co-ordinator their classes. On a day a class teacher is absent (marked absent / on leave on the staff
        register, or on approved leave), the class&apos;s co-ordinator sees that class in Attendance and can take its
        register for that day. A class can have only one co-ordinator.
      </p>
      {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}

      {data ? (
        <>
          {entries.length ? (
            <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {entries.map(([sid, keys]) => (
                <li key={sid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <strong className="text-[var(--brand-deep)]">{nameOf(sid)}</strong>
                    <span className="ml-2 text-xs text-[var(--muted)]">{keys.map(label).join(", ")}</span>
                  </span>
                  {canEdit ? (
                    <span className="flex gap-2">
                      <button type="button" className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline" onClick={() => choose(sid)}>
                        Change
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-xs font-semibold text-[var(--danger)] underline-offset-2 hover:underline disabled:opacity-50"
                        onClick={() => {
                          if (window.confirm(`Remove ${nameOf(sid)} as co-ordinator of ${keys.map(label).join(", ")}?`)) void save(sid, []);
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted)]">No co-ordinators yet.</p>
          )}

          {canEdit ? (
            <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
              <label className="block text-xs font-semibold text-[var(--muted)]">
                Co-ordinator
                <select className="field mt-1 w-full max-w-sm !py-2" value={staffId} onChange={(e) => choose(e.target.value)}>
                  <option value="">Choose staff…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                      {s.empCode ? ` (${s.empCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {staffId ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {classes.map((c) => (
                      <div key={c.id} className="rounded-lg border border-[var(--border)] p-2">
                        <p className="text-xs font-semibold text-[var(--brand-deep)]">{c.name}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          {c.sections.map((s) => {
                            const key = `${c.id}|${s.id}`;
                            const other = owner.get(key);
                            const takenByOther = !!other && other !== staffId;
                            return (
                              <label
                                key={key}
                                className={`flex items-center gap-1.5 text-xs ${takenByOther ? "text-[var(--muted)]" : "text-[var(--brand-deep)]"}`}
                                title={takenByOther ? `Co-ordinator: ${nameOf(other!)}` : undefined}
                              >
                                <input
                                  type="checkbox"
                                  disabled={takenByOther || busy}
                                  checked={picked.has(key)}
                                  onChange={() =>
                                    setPicked((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(key)) n.delete(key);
                                      else n.add(key);
                                      return n;
                                    })
                                  }
                                />
                                {c.sections.length > 1 ? s.name : "Whole class"}
                                {takenByOther ? <span className="text-[10px]">· {nameOf(other!)}</span> : null}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                    onClick={() => void save(staffId, [...picked])}
                  >
                    {busy ? "Saving…" : `Save ${nameOf(staffId)}'s classes (${picked.size})`}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {msg ? (
            <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p>
          ) : null}
        </>
      ) : !err ? (
        <p className="mt-3 text-xs text-[var(--muted)]">Loading…</p>
      ) : null}
    </section>
  );
}
