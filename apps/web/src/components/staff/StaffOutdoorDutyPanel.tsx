"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  OUTDOOR_DUTY_PURPOSE_LABELS,
  loadStaffAttendance,
  listActiveOutdoorDuty,
  listOutdoorDutyForStaff,
  type OutdoorDutySession,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";
import { canManageStaffLeave, resolveSessionStaff } from "@/lib/staffResolve";
import { RowActionMenu } from "@/components/ui/erp-grid";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

function durationLabel(startedAt: string, endedAt: string | null): string {
  const ms = (endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(startedAt);
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StaffOutdoorDutyPanel() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [attendance, setAttendance] = useState<StaffAttendanceState | null>(null);

  function reload() {
    setMasters(loadMasters());
    setAttendance(loadStaffAttendance());
  }

  useEffect(() => {
    reload();
    void (async () => {
      const [{ ensureStaffHydrated }, { ensureStaffAttendanceHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/staffPersistence"),
          import("@/lib/staffAttendancePersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      const [didStaff, didAttendance] = await Promise.all([
        withHydrationSlot(() => ensureStaffHydrated()),
        withHydrationSlot(() => ensureStaffAttendanceHydrated()),
      ]);
      if (didStaff || didAttendance) reload();
    })();
  }, []);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const isManager = useMemo(() => {
    if (!masters) return false;
    return canManageStaffLeave(session, masters);
  }, [masters, session]);

  function staffLabel(id: string) {
    const s = masters?.staff.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : id || "—";
  }

  const active = useMemo(() => {
    if (!attendance) return [];
    const all = listActiveOutdoorDuty(attendance);
    return isManager || !selfStaff
      ? all
      : all.filter((s) => s.staffId === selfStaff.id);
  }, [attendance, isManager, selfStaff]);

  const history = useMemo(() => {
    if (!attendance) return [];
    if (isManager || !selfStaff) {
      return [...attendance.outdoorDuty].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
    }
    return listOutdoorDutyForStaff(attendance, selfStaff.id);
  }, [attendance, isManager, selfStaff]);

  if (!masters || !attendance) {
    return <p className="text-sm text-[var(--muted)]">Loading outdoor duty…</p>;
  }

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5 text-sm text-[var(--muted)]">
        {isManager ? (
          <>
            Staff currently off-campus on official work, checked out from
            the header WhatsApp panel. Their day&apos;s attendance stays
            Present with an &ldquo;Outdoor duty&rdquo; note.
          </>
        ) : (
          <>
            Your outdoor-duty check-outs, filed from the header WhatsApp
            panel (&ldquo;Owner / Admin / Principal&rdquo; → &ldquo;Check
            out for outdoor duty&rdquo;).
          </>
        )}
      </p>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Currently out ({active.length})
          </h2>
        </div>
        {active.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">
            Nobody is currently on outdoor duty.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {active.map((s: OutdoorDutySession) => (
              <li key={s.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--brand-deep)]">
                    {staffLabel(s.staffId)}
                  </span>
                  <span className="rounded-md bg-[rgba(197,160,40,0.2)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--brand-deep)]">
                    Out {durationLabel(s.startedAt, null)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {OUTDOOR_DUTY_PURPOSE_LABELS[s.purpose]} · {s.destination}
                  {s.note ? ` — ${s.note}` : ""} · since {fmt(s.startedAt)}
                  {s.startGeo ? " · GPS captured" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            History{!isManager ? " (yours)" : ""}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                {isManager ? <th className="px-4 py-2">Staff</th> : null}
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Destination</th>
                <th className="px-3 py-2">Out</th>
                <th className="px-3 py-2">In</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">GPS</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {history.map((s) => (
                <tr key={s.id}>
                  {isManager ? (
                    <td className="px-4 py-2 font-medium text-[var(--brand-deep)]">
                      {staffLabel(s.staffId)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-xs">
                    {OUTDOOR_DUTY_PURPOSE_LABELS[s.purpose]}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.destination}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {fmt(s.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {s.status === "active" ? "—" : fmt(s.endedAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {durationLabel(s.startedAt, s.endedAt)}
                    {s.status === "active" ? " (ongoing)" : ""}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[var(--muted)]">
                    {s.startGeo ? "Out ✓" : "—"}
                    {s.endGeo ? " · In ✓" : ""}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu row={s} label="Staff actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.staffId))}/edit`; } }]} />
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManager ? 7 : 6}
                    className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No outdoor duty records yet.
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>
    </div>
  );
}
