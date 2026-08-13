"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addExternalToSurveyTeam,
  addStaffToSurveyTeam,
  addSurveyExternal,
  formatSurveyHours,
  removeSurveyTeamMember,
  setSurveyTeamAssigned,
  setSurveyTeamLeader,
  surveyDayAnalytics,
} from "@/lib/fieldSurvey";
import {
  isLeadCaller,
  setLeadCallerAssigned,
  todayYmd,
  type AdmissionsState,
} from "@/lib/admissions";
import { activeStaffSorted } from "@/lib/staffAttendanceRules";
import type { MastersState } from "@/lib/masters";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

export function AdmissionSurveyTeamPanel({
  state,
  masters,
  canEdit,
  onCommit,
}: {
  state: AdmissionsState;
  masters: MastersState;
  canEdit: boolean;
  onCommit: (next: AdmissionsState, msg?: string) => void;
}) {
  const staff = useMemo(
    () => activeStaffSorted(masters.staff ?? []),
    [masters.staff],
  );
  const analytics = useMemo(() => surveyDayAnalytics(state), [state]);
  const onTeamIds = useMemo(
    () =>
      new Set(
        state.surveyTeam
          .filter((m) => m.kind === "staff")
          .map((m) => m.staffId),
      ),
    [state.surveyTeam],
  );
  const availableStaff = staff.filter((s) => !onTeamIds.has(s.id));

  const [staffId, setStaffId] = useState("");
  const [asLeader, setAsLeader] = useState(false);
  const [extName, setExtName] = useState("");
  const [extMobile, setExtMobile] = useState("");
  const [extNote, setExtNote] = useState("");
  const [pickExternalId, setPickExternalId] = useState("");
  const [analyticsDate, setAnalyticsDate] = useState(todayYmd());
  const [callerStaffId, setCallerStaffId] = useState("");

  const dayAnalytics = useMemo(
    () => surveyDayAnalytics(state, analyticsDate),
    [state, analyticsDate],
  );

  const callerIds = state.leadCallerStaffIds || [];
  const staffNotCallers = staff.filter((s) => !callerIds.includes(s.id));

  function addStaff() {
    if (!canEdit || !staffId) return;
    const row = staff.find((s) => s.id === staffId);
    if (!row) return;
    const r = addStaffToSurveyTeam(state, row, asLeader);
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    onCommit(
      r.state,
      asLeader
        ? `${row.fullName} added as team leader`
        : `${row.fullName} added to survey team`,
    );
    setStaffId("");
    setAsLeader(false);
  }

  function createExternal() {
    if (!canEdit) return;
    const r = addSurveyExternal(state, {
      fullName: extName,
      mobile: extMobile,
      note: extNote,
    });
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    const add = addExternalToSurveyTeam(r.state, r.agent.id);
    if (!add.ok) {
      onCommit(r.state, `External saved · ${add.reason}`);
      return;
    }
    onCommit(add.state, `Survey-only staff ${r.agent.fullName} added & assigned`);
    setExtName("");
    setExtMobile("");
    setExtNote("");
  }

  function addExistingExternal() {
    if (!canEdit || !pickExternalId) return;
    const r = addExternalToSurveyTeam(state, pickExternalId);
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    onCommit(r.state, `${r.member.fullName} assigned to survey team`);
    setPickExternalId("");
  }

  const externalsNotOnTeam = state.surveyExternals.filter(
    (e) =>
      !state.surveyTeam.some(
        (m) => m.kind === "external" && m.externalId === e.id,
      ),
  );

  return (
    <div className="space-y-4">
      <MastersWorkCard
        title="Survey team"
        hint="Choose school staff · set team leader · add outside survey-only workers · Assign shows Start survey on their app"
      >
        <p className="mb-3 text-[12px] text-[var(--muted)]">
          Agent app:{" "}
          <Link
            href="/field/survey"
            className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          >
            /field/survey
          </Link>{" "}
          — only assigned members see Start survey. Team leader can edit beats
          from the phone.
        </p>

        {canEdit ? (
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                Add existing staff
              </p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  className={inp}
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                >
                  <option value="">Select staff…</option>
                  {availableStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} — {s.fullName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white"
                  onClick={addStaff}
                >
                  Add
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={asLeader}
                  onChange={(e) => setAsLeader(e.target.checked)}
                />
                Make team leader (replaces current leader)
              </label>
            </div>

            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                Outside survey staff (survey work only)
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={inp}
                  placeholder="Full name *"
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                />
                <input
                  className={inp}
                  placeholder="Mobile *"
                  inputMode="numeric"
                  maxLength={10}
                  value={extMobile}
                  onChange={(e) =>
                    setExtMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                />
              </div>
              <input
                className={`${inp} mt-2`}
                placeholder="Note (agency / beat hire)"
                value={extNote}
                onChange={(e) => setExtNote(e.target.value)}
              />
              <button
                type="button"
                className="mt-2 rounded-lg bg-[#9a3412] px-3 py-2 text-[12px] font-semibold text-white"
                onClick={createExternal}
              >
                Add external + assign
              </button>
              {externalsNotOnTeam.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
                  <select
                    className={`${inp} min-w-[160px] flex-1`}
                    value={pickExternalId}
                    onChange={(e) => setPickExternalId(e.target.value)}
                  >
                    <option value="">Re-assign saved external…</option>
                    {externalsNotOnTeam.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} · {e.mobile}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[12px] font-semibold"
                    onClick={addExistingExternal}
                  >
                    Assign
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {state.surveyTeam.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">
            No survey team yet — add staff or outside workers above.
          </p>
        ) : (
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">App</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {state.surveyTeam.map((m) => (
                <tr key={m.id}>
                  <td className="px-2 py-2 text-[12px]">
                    <span className="font-medium text-[var(--brand-deep)]">
                      {m.fullName}
                    </span>
                    <div className="text-[10px] text-[var(--muted)]">
                      {m.empCode ? `${m.empCode} · ` : ""}
                      {m.mobile || "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    {m.kind === "staff" ? "School staff" : "Survey-only"}
                  </td>
                  <td className="px-2 py-2">
                    {m.role === "leader" ? (
                      <span className="rounded-full bg-[rgba(197,160,40,0.2)] px-2 py-0.5 text-[10px] font-semibold text-[#8a6914]">
                        Team leader
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--muted)]">
                        Agent
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    {m.assigned ? (
                      <span className="font-semibold text-[#166534]">
                        Shows Start survey
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">Hidden</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {canEdit ? (
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            onCommit(
                              setSurveyTeamAssigned(state, m.id, !m.assigned),
                              m.assigned
                                ? `${m.fullName} removed from app`
                                : `${m.fullName} assigned — app shows Start`,
                            )
                          }
                        >
                          {m.assigned ? "Unassign" : "Assign"}
                        </button>
                        {m.role !== "leader" ? (
                          <button
                            type="button"
                            className="underline"
                            onClick={() =>
                              onCommit(
                                setSurveyTeamLeader(state, m.id),
                                `${m.fullName} is team leader`,
                              )
                            }
                          >
                            Make leader
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-[var(--danger)] underline"
                          onClick={() =>
                            onCommit(
                              removeSurveyTeamMember(state, m.id),
                              `${m.fullName} removed from team`,
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        )}
      </MastersWorkCard>

      <MastersWorkCard
        title="Lead callers (CRM list access)"
        hint="Only assigned callers see lead / registration lists on Field app and Admissions CRM. Capture + UPI collect stay available to all staff."
      >
        {canEdit ? (
          <div className="mb-3 flex flex-wrap gap-2">
            <select
              className={`${inp} min-w-[200px] flex-1`}
              value={callerStaffId}
              onChange={(e) => setCallerStaffId(e.target.value)}
            >
              <option value="">Select staff for lead calling…</option>
              {staffNotCallers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.empCode} — {s.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white"
              onClick={() => {
                if (!callerStaffId) return;
                const row = staff.find((s) => s.id === callerStaffId);
                onCommit(
                  setLeadCallerAssigned(state, callerStaffId, true),
                  `${row?.fullName || "Staff"} can now see assigned lead lists`,
                );
                setCallerStaffId("");
              }}
            >
              Assign caller
            </button>
          </div>
        ) : null}
        {callerIds.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">
            No lead callers yet — staff Field app will hide Lead calling until
            assigned here.
          </p>
        ) : (
          <ul className="space-y-1 text-[12px]">
            {callerIds.map((id) => {
              const row = staff.find((s) => s.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5"
                >
                  <span>
                    {row ? `${row.empCode} — ${row.fullName}` : id}
                    {isLeadCaller(state, id) ? (
                      <span className="ml-2 text-[10px] text-[#166534]">
                        lists unlocked
                      </span>
                    ) : null}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="text-[10px] text-[#b42318] underline"
                      onClick={() =>
                        onCommit(
                          setLeadCallerAssigned(state, id, false),
                          "Lead calling access removed",
                        )
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </MastersWorkCard>

      <MastersTableCard title="Per-survey analytics (by day)">
        <p className="mb-3 rounded-lg border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2 text-[11px] text-[var(--muted)]">
          <strong className="text-[var(--brand-deep)]">Salary rule:</strong>{" "}
          School IN → survey Start/End counts as full Present (outdoor duty).
          If they go home without school OUT, survey End closes attendance
          OUT. If they return and punch school OUT, that OUT is kept. Missing
          End stays Present and is flagged for HR — no auto LWP. Outside
          survey-only staff are not on payroll.
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-semibold text-[var(--muted)]">
            Survey date
            <input
              type="date"
              className={`${inp} mt-1`}
              value={analyticsDate}
              onChange={(e) => setAnalyticsDate(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              Sessions{" "}
              <strong>{dayAnalytics.sessions}</strong>
            </span>
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              On field{" "}
              <strong>{dayAnalytics.active}</strong>
            </span>
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              Ended{" "}
              <strong>{dayAnalytics.ended}</strong>
            </span>
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              Worked{" "}
              <strong>{formatSurveyHours(dayAnalytics.totalWorkedMs)}</strong>
            </span>
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              Breaks{" "}
              <strong>{formatSurveyHours(dayAnalytics.totalBreakMs)}</strong>
            </span>
            <span className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5">
              Captures{" "}
              <strong>{dayAnalytics.captures}</strong>
            </span>
          </div>
        </div>

        {dayAnalytics.byAgent.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No survey sessions this day — agents can Start via WhatsApp (START CODE + location pin) or /field/survey.
          </div>
        ) : (
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Worked</th>
                <th className="px-2 py-2">Break</th>
                <th className="px-2 py-2">Captures</th>
                <th className="px-2 py-2">Salary day</th>
                <th className="px-2 py-2">Start GPS</th>
                <th className="px-2 py-2">End GPS</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {dayAnalytics.byAgent.map((a) => (
                <tr key={`${a.memberId}-${a.agentName}`}>
                  <td className="px-2 py-2 text-[12px] font-medium">
                    {a.agentName}
                  </td>
                  <td className="px-2 py-2 text-[11px] capitalize">
                    {a.status.replace("_", " ")}
                  </td>
                  <td className="px-2 py-2 text-[12px]">
                    {formatSurveyHours(a.workedMs)}
                  </td>
                  <td className="px-2 py-2 text-[12px]">
                    {formatSurveyHours(a.breakMs)}
                  </td>
                  <td className="px-2 py-2 text-[12px]">{a.captures}</td>
                  <td className="px-2 py-2 text-[11px]">
                    <span
                      className={
                        a.salaryCode === "open_hr_review"
                          ? "font-semibold text-[#9a3412]"
                          : a.salaryCode === "external_na"
                            ? "text-[var(--muted)]"
                            : "font-semibold text-[#166534]"
                      }
                    >
                      {a.salaryLabel}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[10px]">
                    {a.startLabel}
                  </td>
                  <td className="px-2 py-2 font-mono text-[10px]">
                    {a.endLabel}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        )}

        {dayAnalytics.byBeat.length > 0 ? (
          <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
            <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
              By beat
            </p>
            <div className="flex flex-wrap gap-2">
              {dayAnalytics.byBeat.map((b) => (
                <span
                  key={b.beatId || b.beatName}
                  className="rounded-lg bg-[rgba(154,52,18,0.1)] px-2.5 py-1.5 text-[11px] text-[#9a3412]"
                >
                  {b.beatName} · {b.sessions} sess ·{" "}
                  {formatSurveyHours(b.workedMs)} · {b.captures} leads
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {analytics.date === todayYmd() && analytics.active > 0 ? (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            {analytics.active} survey still open today — End survey on the agent
            app locks hours + end location for salary outdoor close.
          </p>
        ) : null}
      </MastersTableCard>
    </div>
  );
}
