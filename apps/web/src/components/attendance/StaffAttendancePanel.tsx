"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ATTENDANCE_STATUSES,
  statusTone,
  todayIso,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  adjustStaffAttendance,
  adjustStaffHalfDayAttendance,
  applyApprovedLeaveToMarks,
  defaultStaffMarks,
  findStaffRegister,
  loadStaffAttendance,
  normalizeAttendanceSettings,
  nowHhmm,
  punchWayLabel,
  punchWayShort,
  summarizeStaffMarks,
  syncLeaveOntoAttendanceDate,
  upsertStaffMark,
  upsertStaffRegister,
  type AttendancePunchWay,
  type StaffAttendanceMark,
} from "@/lib/staffAttendance";
import {
  evaluatePunchAgainstRule,
  loadAttendanceRules,
  ruleForStaff,
} from "@/lib/staffAttendanceRules";
import { loadMasters, type MastersState } from "@/lib/masters";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  canManageStaffLeave,
  resolveSessionStaff,
} from "@/lib/staffResolve";

type AttTab =
  | "punch"
  | "manage"
  | "direct"
  | "adjust"
  | "halfday"
  | "sync";

export function StaffAttendancePanel({ ay }: { ay: string }) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [date, setDate] = useState(todayIso);
  const [marks, setMarks] = useState<StaffAttendanceMark[]>([]);
  const [remark, setRemark] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<AttTab>("manage");

  const [staffId, setStaffId] = useState("");
  const [status, setStatusMark] = useState<AttendanceStatus>("P");
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [note, setNote] = useState("");
  const [punchWay, setPunchWay] = useState<AttendancePunchWay | "">("direct");
  const [halfDay, setHalfDay] = useState(true);

  const rulesState = useMemo(() => loadAttendanceRules(), [tick]);
  const attState = useMemo(() => loadStaffAttendance(), [tick]);
  const settings = useMemo(
    () => normalizeAttendanceSettings(attState.settings),
    [attState],
  );

  useEffect(() => {
    setMasters(loadMasters());
  }, [tick]);

  useEffect(() => {
    void (async () => {
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const { ensureStaffAttendanceHydrated } = await import(
        "@/lib/staffAttendancePersistence"
      );
      const [didStaff, didAtt] = await Promise.all([
        ensureStaffHydrated(),
        ensureStaffAttendanceHydrated(),
      ]);
      if (didStaff || didAtt) setTick((n) => n + 1);
    })();
  }, []);

  const roster = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active")
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [masters]);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const isManager = useMemo(() => {
    if (!masters) return false;
    return canManageStaffLeave(session, masters);
  }, [masters, session]);

  const holidayTeaching = useMemo(() => {
    if (!masters) return null;
    const c = classifyStaffHolidayDay(masters, date, ay, "teaching");
    if (c.status === "working") return null;
    return c;
  }, [masters, date, ay]);

  const holidayNonTeaching = useMemo(() => {
    if (!masters) return null;
    const c = classifyStaffHolidayDay(masters, date, ay, "non_teaching");
    if (c.status === "working") return null;
    return c;
  }, [masters, date, ay]);

  const holidayDay = holidayTeaching || holidayNonTeaching;

  function holidayForStaffId(id: string) {
    if (!masters) return null;
    const s = roster.find((x) => x.id === id);
    const stream = s?.stream === "non_teaching" ? "non_teaching" : "teaching";
    const c = classifyStaffHolidayDay(masters, date, ay, stream);
    if (c.status === "working") return null;
    return c;
  }

  const holidayBlocksAllStaff =
    holidayTeaching?.status === "holiday" &&
    holidayNonTeaching?.status === "holiday";

  useEffect(() => {
    if (isManager) setTab((t) => (t === "punch" ? "manage" : t));
    else setTab("punch");
  }, [isManager]);

  useEffect(() => {
    if (!isManager && (tab === "manage" || tab === "direct" || tab === "adjust" || tab === "halfday" || tab === "sync")) {
      setTab("punch");
    }
  }, [isManager, tab]);

  useEffect(() => {
    if (!isManager && selfStaff) setStaffId(selfStaff.id);
  }, [isManager, selfStaff]);

  useEffect(() => {
    if (!masters) return;
    const state = loadStaffAttendance();
    const existing = findStaffRegister(state, date, ay);
    const cfg = normalizeAttendanceSettings(state.settings);
    let nextMarks: StaffAttendanceMark[];
    if (existing) {
      const byId = new Map(existing.marks.map((m) => [m.staffId, m]));
      nextMarks = roster.map((s) => {
        const hit = byId.get(s.id);
          return (
            hit ?? {
              staffId: s.id,
              status: "P" as AttendanceStatus,
              note: "",
              inTime: "",
              outTime: "",
              punchWay: "" as const,
            }
          );
      });
      setRemark(existing.remark);
    } else {
      nextMarks = defaultStaffMarks(roster);
      setRemark("");
    }
    if (cfg.syncLeaveToAttendance) {
      nextMarks = applyApprovedLeaveToMarks(nextMarks, date, ay);
    }
    setMarks(nextMarks);
    setDirty(false);
  }, [masters, date, ay, roster, tick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) => {
      const des = masters?.designations.find((d) => d.id === s.designationId);
      return [s.empCode, s.fullName, s.mobile, s.rfidNo, s.biometricId, des?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [roster, query, masters]);

  const summary = useMemo(() => summarizeStaffMarks(marks), [marks]);

  const myMark = useMemo(() => {
    if (!selfStaff) return null;
    return marks.find((m) => m.staffId === selfStaff.id) ?? null;
  }, [marks, selfStaff]);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 2800);
  }

  function setStatus(id: string, st: AttendanceStatus) {
    setMarks((prev) =>
      prev.map((m) =>
        m.staffId === id
          ? { ...m, status: st, punchWay: m.punchWay || "manual" }
          : m,
      ),
    );
    setDirty(true);
  }

  function setPunch(id: string, field: "inTime" | "outTime", value: string) {
    setMarks((prev) =>
      prev.map((m) =>
        m.staffId === id
          ? {
              ...m,
              [field]: value,
              punchWay: m.punchWay || "manual",
            }
          : m,
      ),
    );
    setDirty(true);
  }

  function markAll(st: AttendanceStatus) {
    setMarks((prev) =>
      prev.map((m) => ({
        ...m,
        status: st,
        punchWay: m.punchWay || "manual",
      })),
    );
    setDirty(true);
  }

  function applyRulesToMarks(list: StaffAttendanceMark[]): StaffAttendanceMark[] {
    return list.map((m) => {
      const rule = ruleForStaff(rulesState, m.staffId);
      if (!rule || !m.inTime) return m;
      const ev = evaluatePunchAgainstRule(
        rulesState,
        rule,
        date,
        m.inTime,
        m.outTime,
      );
      return {
        ...m,
        status: ev.status,
        note: ev.label,
        punchWay: "rule",
      };
    });
  }

  function applyRulesToVisible() {
    let applied = 0;
    let skipped = 0;
    setMarks((prev) =>
      prev.map((m) => {
        if (!filtered.some((s) => s.id === m.staffId)) return m;
        const rule = ruleForStaff(rulesState, m.staffId);
        if (!rule || !m.inTime) {
          skipped += 1;
          return m;
        }
        const ev = evaluatePunchAgainstRule(
          rulesState,
          rule,
          date,
          m.inTime,
          m.outTime,
        );
        applied += 1;
        return {
          ...m,
          status: ev.status,
          note: ev.label,
          punchWay: "rule",
        };
      }),
    );
    setDirty(true);
    flash(
      `Rules applied to ${applied} staff` +
        (skipped ? ` · ${skipped} skipped (no rule / no in-time)` : ""),
    );
  }

  function saveRegister() {
    if (!isManager) {
      flash("Only principal / admin can save the full register", true);
      return;
    }
    if (holidayBlocksAllStaff) {
      flash(
        `School holiday: ${holidayDay?.label ?? "off"}. Staff attendance is not marked.`,
        true,
      );
      return;
    }
    if (roster.length === 0) {
      flash("No active staff in roster", true);
      return;
    }
    let toSave = marks;
    if (settings.autoApplyRulesOnSave) {
      toSave = applyRulesToMarks(marks);
      setMarks(toSave);
    }
    upsertStaffRegister({
      academicYearCode: ay,
      date,
      marks: toSave,
      markedBy: session.fullName,
      remark,
    });
    setDirty(false);
    flash("Staff attendance saved");
    setTick((x) => x + 1);
  }

  function onSelfPunch(kind: "in" | "out") {
    if (!selfStaff) {
      flash("Sign in with your staff login to punch", true);
      return;
    }
    const selfHol = holidayForStaffId(selfStaff.id);
    if (selfHol?.status === "holiday") {
      flash(`Holiday for you: ${selfHol.label}`, true);
      return;
    }
    if (!settings.allowSelfPunch) {
      flash("Self-punch is disabled in attendance settings", true);
      return;
    }
    const time = nowHhmm();
    const cur = myMark;
    const result = upsertStaffMark({
      academicYearCode: ay,
      date,
      staffId: selfStaff.id,
      status: cur?.status === "A" || !cur ? "P" : cur.status,
      inTime: kind === "in" ? time : cur?.inTime || time,
      outTime: kind === "out" ? time : cur?.outTime || "",
      note: kind === "in" ? "Self punch-in" : "Self punch-out",
      punchWay: "self",
      markedBy: session.fullName,
      roster,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    flash(kind === "in" ? `Punched in at ${time}` : `Punched out at ${time}`);
    setTick((x) => x + 1);
  }

  function onDirect(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can direct-mark", true);
      return;
    }
    const targetHol = holidayForStaffId(staffId);
    if (targetHol?.status === "holiday") {
      flash(
        `Holiday for this staff: ${targetHol.label}. Direct mark blocked.`,
        true,
      );
      return;
    }
    const result = upsertStaffMark({
      academicYearCode: ay,
      date,
      staffId,
      status,
      inTime,
      outTime,
      note: note || "Direct mark",
      punchWay: punchWay || "direct",
      markedBy: session.fullName,
      roster,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    flash("Direct attendance saved");
    setTick((x) => x + 1);
  }

  function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can adjust attendance", true);
      return;
    }
    const result = adjustStaffAttendance({
      academicYearCode: ay,
      date,
      staffId,
      status,
      inTime,
      outTime,
      note: note || undefined,
      markedBy: session.fullName,
      roster,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    flash("Attendance adjusted");
    setTick((x) => x + 1);
  }

  function onHalfDay(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can adjust half-day", true);
      return;
    }
    const result = adjustStaffHalfDayAttendance({
      academicYearCode: ay,
      date,
      staffId,
      halfDay,
      markedBy: session.fullName,
      roster,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    flash(halfDay ? "Marked half-day" : "Cleared half-day");
    setTick((x) => x + 1);
  }

  function onSyncLeave() {
    if (!isManager) {
      flash("Only principal / admin can sync leave", true);
      return;
    }
    syncLeaveOntoAttendanceDate({
      academicYearCode: ay,
      date,
      markedBy: session.fullName,
      roster,
    });
    flash("Approved leave synced to attendance");
    setTick((x) => x + 1);
  }

  function loadStaffIntoForm(id: string) {
    setStaffId(id);
    const m = marks.find((x) => x.staffId === id);
    if (m) {
      setStatusMark(m.status);
      setInTime(m.inTime);
      setOutTime(m.outTime);
      setNote(m.note);
      setPunchWay(m.punchWay || "direct");
      setHalfDay(m.status === "HD");
    }
  }

  function scanLookup(code: string) {
    if (!isManager) {
      flash("RFID scan is for office marking", true);
      return;
    }
    const raw = code.trim().toLowerCase();
    if (!raw || !masters) return;
    const byRfid = roster.find(
      (s) => s.rfidNo.trim().toLowerCase() === raw,
    );
    const byBio = roster.find(
      (s) => s.biometricId.trim().toLowerCase() === raw,
    );
    const byCode = roster.find(
      (s) => s.empCode.trim().toLowerCase() === raw,
    );
    const hit = byRfid || byBio || byCode;
    if (!hit) {
      flash(`No staff for code “${code.trim()}”`, true);
      return;
    }
    const way: AttendancePunchWay = byRfid
      ? "rfid"
      : byBio
        ? "biometric"
        : "manual";
    const time = nowHhmm();
    setMarks((prev) =>
      prev.map((m) =>
        m.staffId === hit.id
          ? {
              ...m,
              status: "P",
              inTime: m.inTime || time,
              punchWay: way,
              note:
                way === "rfid"
                  ? "RFID punch"
                  : way === "biometric"
                    ? "Biometric punch"
                    : "Manual scan",
            }
          : m,
      ),
    );
    setDirty(true);
    flash(
      `Marked present via ${punchWayLabel(way)}: ${hit.fullName}`,
    );
  }

  const tabs: { id: AttTab; label: string; tone: "teal" | "navy" | "amber" | "violet" | "sky" | "green" }[] = [
    { id: "punch", label: "My punch", tone: "teal" },
    ...(isManager
      ? ([
          { id: "manage", label: "Manage", tone: "navy" },
          { id: "direct", label: "Direct mark", tone: "amber" },
          { id: "adjust", label: "Adjust", tone: "violet" },
          { id: "halfday", label: "Adjust half-day", tone: "sky" },
          { id: "sync", label: "Sync leave", tone: "green" },
        ] as const)
      : []),
  ];

  if (!masters) {
    return <p className="text-sm text-[var(--muted)]">Loading attendance…</p>;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-2.5 text-sm text-[var(--muted)]">
        {isManager ? (
          <>
            Principal / admin — manage register, direct mark, adjust, sync leave.
            Settings &amp; rules in{" "}
            <Link
              href="/masters"
              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
            >
              Masters → Leave setup
            </Link>
            . Reports in Attendance → Reports.
          </>
        ) : selfStaff ? (
          <>
            Punching as{" "}
            <strong className="text-[var(--brand-deep)]">
              {selfStaff.empCode} · {selfStaff.fullName}
            </strong>
            . Office marks the full day register.
          </>
        ) : (
          <>
            Sign in with your staff login to punch. Principal / admin manage the
            register after office login.
          </>
        )}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">
          Date
          <input
            type="date"
            className="field mt-1 !py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      {holidayDay ? (
        <div className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {holidayBlocksAllStaff ? (
            <>
              <strong>{holidayDay.label}</strong> — holiday for all staff.
              Punch / full register save blocked.
            </>
          ) : (
            <>
              {holidayTeaching?.status === "holiday" ? (
                <span>
                  <strong>{holidayTeaching.label}</strong> — teachers off.{" "}
                </span>
              ) : null}
              {holidayNonTeaching?.status === "holiday" ? (
                <span>
                  <strong>{holidayNonTeaching.label}</strong> — non-teaching
                  off.{" "}
                </span>
              ) : null}
              Other stream can still mark attendance.
            </>
          )}
        </div>
      ) : null}

      <ModuleTabs
        aria-label="Staff attendance"
        value={tab}
        onChange={(id) => setTab(id as AttTab)}
        items={tabs}
      />

      {tab === "punch" ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 max-w-lg space-y-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            My punch · {date}
          </h2>
          {!settings.allowSelfPunch ? (
            <p className="text-sm text-[var(--muted)]">
              Self-punch is disabled. Ask office to mark you.
            </p>
          ) : !selfStaff ? (
            <p className="text-sm text-[var(--muted)]">
              Sign in with Staff → Login to punch your attendance.
            </p>
          ) : (
            <>
              <div className="text-sm text-[var(--muted)]">
                Status:{" "}
                <strong className="text-[var(--brand-deep)]">
                  {myMark?.status ?? "—"}
                </strong>
                {myMark?.inTime ? ` · In ${myMark.inTime}` : ""}
                {myMark?.outTime ? ` · Out ${myMark.outTime}` : ""}
              </div>
              <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-sm">
                <span className="text-[11px] text-[var(--muted)]">
                  Way of attendance
                </span>
                <div className="font-semibold text-[var(--brand-deep)]">
                  {punchWayLabel(myMark?.punchWay)}
                </div>
              </div>
              {myMark?.note ? (
                <p className="text-[11px] text-[var(--muted)]">{myMark.note}</p>
              ) : null}
              {myMark?.punchGeo?.distanceM != null ? (
                <p className="text-[11px] text-[var(--muted)]">
                  WA GPS · ~{Math.round(myMark.punchGeo.distanceM)} m from campus
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
                  onClick={() => onSelfPunch("in")}
                >
                  Punch in
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-bold text-[var(--brand-deep)]"
                  onClick={() => onSelfPunch("out")}
                >
                  Punch out
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === "manage" && isManager ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-xs font-semibold text-[var(--muted)]">
              Search / RFID / biometric
              <input
                className="field mt-1 w-full !py-2"
                placeholder="Name, emp code, RFID…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    scanLookup(query);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold"
              onClick={() => markAll("P")}
            >
              All present
            </button>
            <button
              type="button"
              className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold"
              onClick={() => markAll("A")}
            >
              All absent
            </button>
            <button
              type="button"
              className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold"
              onClick={applyRulesToVisible}
            >
              Apply rules
            </button>
            <button
              type="button"
              disabled={!dirty}
              className="rounded-xl bg-[var(--brand-deep)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              onClick={saveRegister}
            >
              Save
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            {ATTENDANCE_STATUSES.map((s) => (
              <span
                key={s.code}
                className="rounded-md bg-[rgba(32,48,80,0.06)] px-2 py-1 font-semibold text-[var(--brand-deep)]"
              >
                {s.short}: {summary[s.code] ?? 0}
              </span>
            ))}
            {dirty ? (
              <span className="rounded-md bg-[rgba(197,160,40,0.2)] px-2 py-1 font-semibold text-[var(--brand-deep)]">
                Unsaved
              </span>
            ) : null}
          </div>

          <label className="block text-xs font-semibold text-[var(--muted)]">
            Day remark
            <input
              className="field mt-1 w-full !py-2"
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                setDirty(true);
              }}
            />
          </label>

          <div className="overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">In</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Way</th>
                  <th className="px-3 py-2">Mark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
                {filtered.map((s) => {
                  const mark = marks.find((m) => m.staffId === s.id);
                  const rule = ruleForStaff(rulesState, s.id);
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                        {s.empCode}
                      </td>
                      <td className="px-3 py-2">{s.fullName}</td>
                      <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                        {rule ? rule.code : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          className="field !py-1 !text-xs"
                          value={mark?.inTime || ""}
                          onChange={(e) =>
                            setPunch(s.id, "inTime", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          className="field !py-1 !text-xs"
                          value={mark?.outTime || ""}
                          onChange={(e) =>
                            setPunch(s.id, "outTime", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded-md bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--brand-deep)]"
                          title={punchWayLabel(mark?.punchWay)}
                        >
                          {punchWayShort(mark?.punchWay)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {ATTENDANCE_STATUSES.map((st) => {
                            const tone = statusTone(st.code);
                            const on = mark?.status === st.code;
                            return (
                              <button
                                key={st.code}
                                type="button"
                                className={`rounded px-2 py-1 text-[11px] font-bold ${
                                  on
                                    ? `${tone.bg} ${tone.text}`
                                    : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                                }`}
                                onClick={() => setStatus(s.id, st.code)}
                              >
                                {st.short}
                              </button>
                            );
                          })}
                        </div>
                        {mark?.note ? (
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            {mark.note}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                    >
                      No active staff to mark
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "direct" && isManager ? (
        <MarkForm
          title="Direct mark"
          hint="Set status for one staff immediately (saved to the day register)."
          roster={roster}
          staffId={staffId}
          status={status}
          inTime={inTime}
          outTime={outTime}
          note={note}
          punchWay={punchWay || "direct"}
          showPunchWay
          onStaffId={loadStaffIntoForm}
          onStatus={setStatusMark}
          onInTime={setInTime}
          onOutTime={setOutTime}
          onNote={setNote}
          onPunchWay={setPunchWay}
          onSubmit={onDirect}
          submitLabel="Save direct mark"
        />
      ) : null}

      {tab === "adjust" && isManager ? (
        <MarkForm
          title="Adjust attendance"
          hint="Change an existing mark for the selected date."
          roster={roster}
          staffId={staffId}
          status={status}
          inTime={inTime}
          outTime={outTime}
          note={note}
          punchWay="adjusted"
          showPunchWay={false}
          onStaffId={loadStaffIntoForm}
          onStatus={setStatusMark}
          onInTime={setInTime}
          onOutTime={setOutTime}
          onNote={setNote}
          onPunchWay={setPunchWay}
          onSubmit={onAdjust}
          submitLabel="Save adjustment"
        />
      ) : null}

      {tab === "halfday" && isManager ? (
        <form
          onSubmit={onHalfDay}
          className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 max-w-lg space-y-3"
        >
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Adjust half-day · {date}
          </h2>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Staff
            </span>
            <select
              className="field !py-1.5"
              value={staffId}
              onChange={(e) => loadStaffIntoForm(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.empCode} · {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={halfDay}
              onChange={(e) => setHalfDay(e.target.checked)}
            />
            Half day (HD)
          </label>
          <button
            type="submit"
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
          >
            Save half-day adjustment
          </button>
        </form>
      ) : null}

      {tab === "sync" && isManager ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 max-w-lg space-y-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Sync leave → attendance · {date}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            Marks staff with approved leave as LE (or HD for half-day leave) on
            this date. Does not remove other marks.
          </p>
          <button
            type="button"
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
            onClick={onSyncLeave}
          >
            Sync approved leave
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MarkForm({
  title,
  hint,
  roster,
  staffId,
  status,
  inTime,
  outTime,
  note,
  punchWay,
  showPunchWay,
  onStaffId,
  onStatus,
  onInTime,
  onOutTime,
  onNote,
  onPunchWay,
  onSubmit,
  submitLabel,
}: {
  title: string;
  hint: string;
  roster: { id: string; empCode: string; fullName: string }[];
  staffId: string;
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  note: string;
  punchWay: AttendancePunchWay | "";
  showPunchWay?: boolean;
  onStaffId: (id: string) => void;
  onStatus: (s: AttendanceStatus) => void;
  onInTime: (v: string) => void;
  onOutTime: (v: string) => void;
  onNote: (v: string) => void;
  onPunchWay: (v: AttendancePunchWay | "") => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 max-w-lg space-y-3"
    >
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
      <p className="text-[11px] text-[var(--muted)]">{hint}</p>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Staff</span>
        <select
          className="field !py-1.5"
          value={staffId}
          onChange={(e) => onStaffId(e.target.value)}
          required
        >
          <option value="">Select…</option>
          {roster.map((s) => (
            <option key={s.id} value={s.id}>
              {s.empCode} · {s.fullName}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Status</span>
        <select
          className="field !py-1.5"
          value={status}
          onChange={(e) => onStatus(e.target.value as AttendanceStatus)}
        >
          {ATTENDANCE_STATUSES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.short} — {s.label}
            </option>
          ))}
        </select>
      </label>
      {showPunchWay ? (
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Way of attendance
          </span>
          <select
            className="field !py-1.5"
            value={punchWay || "direct"}
            onChange={(e) =>
              onPunchWay(e.target.value as AttendancePunchWay)
            }
          >
            <option value="direct">Direct mark</option>
            <option value="manual">Manual</option>
            <option value="rfid">RFID card</option>
            <option value="biometric">Biometric</option>
            <option value="self">Self punch</option>
          </select>
        </label>
      ) : (
        <p className="text-[11px] text-[var(--muted)]">
          Way of attendance:{" "}
          <strong className="text-[var(--brand-deep)]">
            {punchWayLabel(punchWay || "adjusted")}
          </strong>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">In</span>
          <input
            type="time"
            className="field !py-1.5"
            value={inTime}
            onChange={(e) => onInTime(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Out</span>
          <input
            type="time"
            className="field !py-1.5"
            value={outTime}
            onChange={(e) => onOutTime(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Note</span>
        <input
          className="field !py-1.5"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Optional"
        />
      </label>
      <button
        type="submit"
        className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
      >
        {submitLabel}
      </button>
    </form>
  );
}
