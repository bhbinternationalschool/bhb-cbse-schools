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
  NOT_PUNCHED_NOTE,
  findStaffRegister,
  attendanceExemptStaffIds,
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
  gradeStaffPunch,
  loadAttendanceRules,
  ruleForStaff,
} from "@/lib/staffAttendanceRules";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  approvedLeaveOn,
  cancelRegisterLeave,
  directLeave,
  loadStaffHr,
  REGISTER_LEAVE_REASON,
  type LeaveType,
} from "@/lib/staffHr";

/**
 * What each code means for STAFF, spelled out. The register used to show
 * only "L" and "LE" side by side, and "L" is Late — on 3 Oct 2026 two staff
 * on leave were marked L, counted as late (present), and every "On leave"
 * figure read 0.
 */
const STAFF_STATUS_LABEL: Record<AttendanceStatus, string> = {
  P: "Present",
  A: "Absent",
  L: "Late",
  HD: "Half day",
  LE: "On leave",
};
import { hasPermission, loadRbac } from "@/lib/rbac";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  canManageStaffLeave,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import {
  autoRunSubstitutionForDate,
  notifySubstitutes,
} from "@/lib/timetableSubstitutionAuto";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { BulkActionBar, RowActionMenu, RowCheckbox, useRowSelection } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { QrPunchCard } from "@/components/staff/QrPunchCard";
import { PunchPhonesPanel } from "@/components/staff/PunchPhonesPanel";

type AttTab =
  | "punch"
  | "manage"
  | "direct"
  | "adjust"
  | "halfday"
  | "sync"
  | "phones";

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
  const [streamFilter, setStreamFilter] = useState<"all" | "teaching" | "non_teaching">("all");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<AttTab>("manage");

  const [staffId, setStaffId] = useState("");
  const [status, setStatusMark] = useState<AttendanceStatus>("P");
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [note, setNote] = useState("");
  const [punchWay, setPunchWay] = useState<AttendancePunchWay | "">("direct");
  const [halfDay, setHalfDay] = useState(true);
  /** Leave type chosen on the register for staff marked On leave (staffId → CL / ML / …). */
  const [leaveTypeFor, setLeaveTypeFor] = useState<Record<string, string>>({});
  /** Leave type for the single-staff direct / adjust forms. */
  const [formLeaveType, setFormLeaveType] = useState("");

  const rulesState = useMemo(() => loadAttendanceRules(), [tick]);
  const attState = useMemo(() => loadStaffAttendance(), [tick]);
  const hrState = useMemo(() => loadStaffHr(), [tick]);
  const leaveTypes: LeaveType[] = hrState.leaveTypes;
  const settings = useMemo(
    () => normalizeAttendanceSettings(attState.settings),
    [attState],
  );

  useEffect(() => {
    setMasters(loadMasters());
  }, [tick]);

  useEffect(() => {
    void (async () => {
      const [
        { ensureStaffHydrated },
        { ensureStaffAttendanceHydrated },
        { ensureStaffHrHydrated },
        { withHydrationSlot },
      ] = await Promise.all([
        import("@/lib/staffPersistence"),
        import("@/lib/staffAttendancePersistence"),
        import("@/lib/staffHrPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      // HR too: marking someone On leave files the leave against their
      // balance, which must be read from the real HR desk, not a stale copy.
      const [didStaff, didAtt, didHr] = await Promise.all([
        withHydrationSlot(() => ensureStaffHydrated()),
        withHydrationSlot(() => ensureStaffAttendanceHydrated()),
        withHydrationSlot(() => ensureStaffHrHydrated()),
      ]);
      if (didStaff || didAtt || didHr) setTick((n) => n + 1);
    })();
  }, []);

  // Who keeps no attendance: the owner, and anyone the office has said so
  // of. They are left OFF the register rather than marked absent — a
  // director who never punches used to read as a daily absentee, which made
  // "absent today" mean nothing.
  const exemptIds = useMemo(() => {
    if (!masters) return new Set<string>();
    const rbac = loadRbac();
    return attendanceExemptStaffIds(settings, {
      roles: rbac.roles.map((r) => ({ id: r.id, code: r.code })),
      assignments: rbac.assignments.map((a) => ({
        staffId: a.staffId,
        roleId: a.roleId,
        isPrimary: a.isPrimary,
      })),
    });
  }, [masters, settings]);

  const roster = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active" && !exemptIds.has(s.id))
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [masters, exemptIds]);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  // Office staff who manage leave still see punch phones and QR screens,
  // but marking or changing the register needs RBAC attendance.edit —
  // admin and owner only since 5 Oct 2026 (director). The server refuses
  // those saves anyway; hiding the tabs saves a click that can only fail.
  const canSeePhones = useMemo(() => {
    if (!masters) return false;
    return canManageStaffLeave(session, masters);
  }, [masters, session]);
  const isManager = useMemo(() => {
    if (!masters) return false;
    return canSeePhones && hasPermission(session, masters, "attendance", "edit");
  }, [canSeePhones, masters, session]);

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
    if (isManager) setTab((t) => (t === "punch" || t === "phones" ? "manage" : t));
    else setTab("punch");
  }, [isManager]);

  useEffect(() => {
    if (!isManager && (tab === "manage" || tab === "direct" || tab === "adjust" || tab === "halfday" || tab === "sync")) {
      setTab("punch");
    }
    if (tab === "phones" && (isManager || !canSeePhones)) setTab(isManager ? "manage" : "punch");
  }, [isManager, canSeePhones, tab]);

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
              status: "A" as AttendanceStatus,
              note: NOT_PUNCHED_NOTE,
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
    const byStream =
      streamFilter === "all"
        ? roster
        : roster.filter((s) =>
            streamFilter === "non_teaching"
              ? s.stream === "non_teaching"
              : s.stream !== "non_teaching",
          );
    if (!q) return byStream;
    return byStream.filter((s) => {
      const des = masters?.designations.find((d) => d.id === s.designationId);
      return [s.empCode, s.fullName, s.mobile, s.rfidNo, s.biometricId, des?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [roster, query, masters, streamFilter]);

  // The register sorts by whatever the office is scanning for: the code it
  // reads off a card, the name it hears, the rule, or today's mark. The
  // punch columns are inputs, not values, so they are not sort handles.
  const staffSort = useTableSort(
    filtered,
    {
      code: (s) => s.empCode,
      name: (s) => s.fullName,
      rule: (s) => ruleForStaff(rulesState, s.id)?.code ?? "",
      mark: (s) => marks.find((m) => m.staffId === s.id)?.status ?? "",
    },
    "code",
    "asc",
  );

  const summary = useMemo(() => summarizeStaffMarks(marks), [marks]);

  const localMark = useMemo(() => {
    if (!selfStaff) return null;
    return marks.find((m) => m.staffId === selfStaff.id) ?? null;
  }, [marks, selfStaff]);

  /**
   * My own punch, as the SERVER holds it. The card used to read this
   * browser's copy of the register — where everyone defaults to "P" — so a
   * teacher who had not punched saw "Status: P", and "Punch in" wrote to a
   * local copy the teacher's role could not save (staff.edit), silently.
   */
  type ServerPunch = {
    allowSelfPunch: boolean;
    today: {
      status: string;
      inTime: string | null;
      outTime: string | null;
      punchWayLabel?: string;
    } | null;
  };
  const [serverPunch, setServerPunch] = useState<ServerPunch | null>(null);

  async function loadServerPunch() {
    try {
      const res = await fetch("/api/v1/staff/attendance/punch", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: ServerPunch;
      } | null;
      if (res.ok && body?.ok && body.data) setServerPunch(body.data);
    } catch {
      /* keep what we have */
    }
  }

  useEffect(() => {
    if (tab !== "punch" || !selfStaff) return;
    void loadServerPunch();
  }, [tab, selfStaff]);

  const myMark = serverPunch
    ? serverPunch.today
      ? {
          status: serverPunch.today.status,
          inTime: serverPunch.today.inTime || "",
          outTime: serverPunch.today.outTime || "",
          punchWay: localMark?.punchWay,
          note: "",
          punchGeo: undefined as undefined | { distanceM?: number },
        }
      : null
    : localMark;

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

  /** Re-derives who's absent on `forDate` and auto-arranges + notifies any
   * newly-uncovered periods — safe to call after every save, since it's a
   * no-op when nothing changed (see lib/timetableSubstitutionAuto.ts). */
  async function runSubstitutionAutomation(forDate: string) {
    if (!masters) return;
    const outcome = autoRunSubstitutionForDate(masters, ay, forDate);
    if (!outcome.ran || outcome.created.length === 0) return;
    const bits = [
      `${outcome.created.length} substitution(s) auto-arranged for ${forDate}`,
    ];
    const notifyResult = await notifySubstitutes(
      outcome.created,
      masters,
      forDate,
    );
    if (notifyResult.ok) {
      if (notifyResult.sent > 0) {
        bits.push(`${notifyResult.sent} substitute(s) notified on WhatsApp`);
      }
    } else {
      bits.push(`WhatsApp notify failed: ${notifyResult.error}`);
    }
    flash(bits.join(" · "));
  }

  const staffKeys = useMemo(() => filtered.map((s) => s.id), [filtered]);
  const staffSel = useRowSelection(staffKeys);

  function setStatus(id: string, st: AttendanceStatus, leaveType?: string) {
    if (st === "LE" && leaveType) setLeaveTypeFor((prev) => ({ ...prev, [id]: leaveType }));
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

  /** Punches graded by Masters → Attendance rules (school timing for staff
   * with no rule). What a person decided stays: manual / direct / adjusted
   * marks and approved leave are not re-graded. */
  const DECIDED_BY_PERSON = new Set(["manual", "direct", "adjusted", "leave_sync", "survey", "outdoor"]);
  function applyRulesToMarks(
    list: StaffAttendanceMark[],
    opts: { punchesOnly?: boolean } = {},
  ): StaffAttendanceMark[] {
    return list.map((m) => {
      if (!m.inTime) return m;
      if (opts.punchesOnly && DECIDED_BY_PERSON.has(m.punchWay || "")) return m;
      const ev = gradeStaffPunch(rulesState, m.staffId, date, m.inTime, m.outTime);
      return {
        ...m,
        status: ev.status,
        note: `${ev.label} (${ev.ruleName})`,
        punchWay: opts.punchesOnly ? m.punchWay : "rule",
      };
    });
  }

  function applyRulesToVisible() {
    let applied = 0;
    let skipped = 0;
    setMarks((prev) =>
      prev.map((m) => {
        if (!filtered.some((s) => s.id === m.staffId)) return m;
        if (!m.inTime) {
          skipped += 1;
          return m;
        }
        const ev = gradeStaffPunch(rulesState, m.staffId, date, m.inTime, m.outTime);
        applied += 1;
        return {
          ...m,
          status: ev.status,
          note: `${ev.label} (${ev.ruleName})`,
          punchWay: "rule",
        };
      }),
    );
    setDirty(true);
    flash(
      `Rules applied to ${applied} staff` +
        (skipped ? ` · ${skipped} skipped (no in-time)` : ""),
    );
  }

  /**
   * Make the HR leave record agree with a staff member's mark for `date`.
   * On leave → a one-day approved leave of the chosen type (balance goes
   * down; refused when the balance or the type's rules say no). Anything
   * else → withdraw a leave the register itself filed earlier. Leave filed
   * through HR is never created twice nor withdrawn here.
   * Returns an error to show, or "" when the HR side is in order.
   */
  function reconcileRegisterLeave(id: string, st: AttendanceStatus, typeCode: string): string {
    const name = roster.find((s) => s.id === id)?.fullName || "this staff member";
    const hr = loadStaffHr();
    if (st === "LE") {
      const existing = approvedLeaveOn(hr, id, date, ay);
      if (existing) return "";
      if (!typeCode) return `Choose the leave type (${leaveTypes.map((t) => t.code).join(" / ")}) for ${name}`;
      const res = directLeave({
        academicYearCode: ay,
        staffId: id,
        typeCode,
        fromDate: date,
        toDate: date,
        reason: REGISTER_LEAVE_REASON,
        appliedBy: session.fullName,
      });
      return res.ok ? "" : `${name}: ${res.error}`;
    }
    if (st === "HD") return "";
    const res = cancelRegisterLeave({ staffId: id, date, academicYearCode: ay, cancelledBy: session.fullName });
    return res.ok ? "" : `${name}: ${res.error}`;
  }

  function saveRegister() {
    if (!isManager) {
      flash("Only admin can save the full register", true);
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
    // Punches always follow the Masters rules; with "Auto-apply punch rules
    // on save" on, every mark with an in-time is re-graded.
    // Leave first: an On-leave mark must be backed by an HR leave of a
    // chosen type before the register says so, and a mark moved off leave
    // gives the day back to the balance.
    for (const m of marks) {
      const err = reconcileRegisterLeave(m.staffId, m.status, leaveTypeFor[m.staffId] || "");
      if (err) {
        flash(err, true);
        setTick((x) => x + 1);
        return;
      }
    }
    const hrNow = loadStaffHr();
    let toSave = applyRulesToMarks(
      marks.map((m) => {
        if (m.status !== "LE") return m;
        const lv = approvedLeaveOn(hrNow, m.staffId, date, ay);
        return lv ? { ...m, note: `On leave (${lv.typeCode})` } : m;
      }),
      { punchesOnly: !settings.autoApplyRulesOnSave },
    );
    if (settings.syncLeaveToAttendance) {
      toSave = applyApprovedLeaveToMarks(toSave, date, ay);
    }
    setMarks(toSave);
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
    void runSubstitutionAutomation(date);
  }

  function onDirect(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only admin can direct-mark", true);
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
    const leaveErr = reconcileRegisterLeave(staffId, status, formLeaveType);
    if (leaveErr) {
      flash(leaveErr, true);
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
    void runSubstitutionAutomation(date);
  }

  function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only admin can adjust attendance", true);
      return;
    }
    const leaveErr = reconcileRegisterLeave(staffId, status, formLeaveType);
    if (leaveErr) {
      flash(leaveErr, true);
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
    void runSubstitutionAutomation(date);
  }

  function onHalfDay(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only admin can adjust half-day", true);
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
      flash("Only admin can sync leave", true);
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
      : canSeePhones
        ? ([{ id: "phones", label: "Punch phones & QR screens", tone: "navy" }] as const)
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
            Admin — manage register, direct mark, adjust, sync leave.
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
            My punch · today
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
                  {myMark?.status ?? (serverPunch ? "Not punched yet" : "—")}
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
              <QrPunchCard
                staffId={selfStaff.id}
                inTime={myMark?.inTime || null}
                outTime={myMark?.outTime || null}
                onPunched={() => {
                  void loadServerPunch();
                  setTick((x) => x + 1);
                }}
              />
            </>
          )}
        </div>
      ) : null}

      {tab === "phones" && canSeePhones && !isManager ? (
        <PunchPhonesPanel canDecidePhones={false} />
      ) : null}

      {tab === "manage" && isManager ? (
        <>
          <PunchPhonesPanel canDecidePhones />
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
            <label className="text-xs font-semibold text-[var(--muted)]">
              Staff
              <select
                className="field mt-1 !py-2"
                value={streamFilter}
                onChange={(e) =>
                  setStreamFilter(
                    e.target.value as "all" | "teaching" | "non_teaching",
                  )
                }
              >
                <option value="all">All ({roster.length})</option>
                <option value="teaching">
                  Teaching ({roster.filter((x) => x.stream !== "non_teaching").length})
                </option>
                <option value="non_teaching">
                  Non-teaching ({roster.filter((x) => x.stream === "non_teaching").length})
                </option>
              </select>
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
                {STAFF_STATUS_LABEL[s.code]}: {summary[s.code] ?? 0}
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

          <BulkActionBar
            selection={staffSel}
            noun="staff member"
            actions={[
              ...ATTENDANCE_STATUSES.filter((st) => st.code !== "LE").map((st) => ({
                id: st.code,
                label: `Mark ${STAFF_STATUS_LABEL[st.code]}`,
                onRun: (ids: string[]) => {
                  for (const id of ids) setStatus(id, st.code);
                  staffSel.clear();
                },
              })),
              // On leave always carries its type, so the balance is charged.
              ...leaveTypes.map((t) => ({
                id: `LE:${t.code}`,
                label: `Mark On leave (${t.code})`,
                onRun: (ids: string[]) => {
                  for (const id of ids) setStatus(id, "LE", t.code);
                  staffSel.clear();
                },
              })),
            ]}
          />
          <ErpTableShell exportAs="staff_attendance" exportTitle="Staff attendance">
            <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[880px]">
              <ErpTableHead>
                <tr>
                  <th className="w-10 px-2 py-2">
                    <RowCheckbox
                      checked={staffSel.allSelected(filtered.map((s) => s.id))}
                      indeterminate={staffSel.someSelected(filtered.map((s) => s.id))}
                      onChange={() => staffSel.toggleAll(filtered.map((s) => s.id))}
                      label="Select all staff shown"
                    />
                  </th>
                  <ErpSortTh sort={staffSort} field="code">Code</ErpSortTh>
                  <ErpSortTh sort={staffSort} field="name">Name</ErpSortTh>
                  <ErpSortTh sort={staffSort} field="rule">Rule</ErpSortTh>
                  <th className="px-3 py-2">In</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Way</th>
                  <ErpSortTh sort={staffSort} field="mark">Mark</ErpSortTh>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {staffSort.rows.map((s) => {
                  const mark = marks.find((m) => m.staffId === s.id);
                  const rule = ruleForStaff(rulesState, s.id);
                  return (
                    <tr key={s.id}>
                      <td className="w-10 px-2 py-2">
                        <RowCheckbox
                          checked={staffSel.isSelected(s.id)}
                          onChange={() => staffSel.toggle(s.id)}
                          label={`Select ${s.fullName}`}
                        />
                      </td>
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
                                title={STAFF_STATUS_LABEL[st.code]}
                              >
                                {STAFF_STATUS_LABEL[st.code]}
                              </button>
                            );
                          })}
                        </div>
                        {mark?.status === "LE" ? (
                          (() => {
                            const lv = approvedLeaveOn(hrState, s.id, date, ay);
                            if (lv) {
                              return (
                                <p className="mt-1 text-[10px] font-semibold text-[var(--brand-deep)]">
                                  {lv.typeCode} leave · {lv.reason === REGISTER_LEAVE_REASON ? "from this register" : "approved in HR"}
                                </p>
                              );
                            }
                            return (
                              <select
                                className="field mt-1 !py-0.5 !text-[11px]"
                                aria-label={`Leave type for ${s.fullName}`}
                                value={leaveTypeFor[s.id] || ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setLeaveTypeFor((prev) => ({ ...prev, [s.id]: v }));
                                  setDirty(true);
                                }}
                              >
                                <option value="">Leave type…</option>
                                {leaveTypes.map((t) => (
                                  <option key={t.code} value={t.code}>
                                    {t.code} — {t.name}
                                  </option>
                                ))}
                              </select>
                            );
                          })()
                        ) : mark?.note ? (
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            {mark.note}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RowActionMenu row={s} label="Staff actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.id))}/edit`; } }]} />
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
              </ErpTableBody>
            </ErpTable>
            </div>
          </ErpTableShell>
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
          leaveTypes={leaveTypes}
          leaveType={formLeaveType}
          onLeaveType={setFormLeaveType}
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
          leaveTypes={leaveTypes}
          leaveType={formLeaveType}
          onLeaveType={setFormLeaveType}
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
  leaveTypes,
  leaveType,
  onLeaveType,
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
  leaveTypes: LeaveType[];
  leaveType: string;
  onLeaveType: (v: string) => void;
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
              {STAFF_STATUS_LABEL[s.code]}
            </option>
          ))}
        </select>
      </label>
      {status === "LE" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Leave type (charged to the balance unless HR already approved this day)
          </span>
          <select
            className="field !py-1.5"
            value={leaveType}
            onChange={(e) => onLeaveType(e.target.value)}
          >
            <option value="">Select…</option>
            {leaveTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
