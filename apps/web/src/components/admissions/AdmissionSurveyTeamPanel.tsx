"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addExternalToSurveyTeam,
  addStaffToSurveyTeam,
  addSurveyExternal,
  removeSurveyTeamMember,
  setSurveyTeamAssigned,
  setSurveyTeamStartMode,
  setSurveyTeamLeader,
} from "@/lib/fieldSurvey";
import {
  isLeadCaller,
  setLeadCallerAssigned,
  type AdmissionsState,
} from "@/lib/admissions";
import { activeStaffSorted } from "@/lib/staffAttendanceRules";
import type { MastersState } from "@/lib/masters";
import {
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { SurveyDaysBoard } from "@/components/admissions/SurveyDaysBoard";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

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
  const [callerStaffId, setCallerStaffId] = useState("");

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

  // Sorting by App shows at a glance who has not signed in yet — the reason
  // this list is checked before a survey day.
  const teamSort = useTableSort(
    state.surveyTeam,
    {
      name: (m) => m.fullName,
      type: (m) => m.kind,
      role: (m) => m.role,
      app: (m) => (m.assigned ? 1 : 0),
    },
    "name",
    "asc",
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
                className="mt-2 rounded-lg bg-[var(--tone-brick-solid)] px-3 py-2 text-[12px] font-semibold text-white"
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
                <ErpSortTh sort={teamSort} field="name" className="px-2 py-2">Name</ErpSortTh>
                <ErpSortTh sort={teamSort} field="type" className="px-2 py-2">Type</ErpSortTh>
                <ErpSortTh sort={teamSort} field="role" className="px-2 py-2">Role</ErpSortTh>
                <ErpSortTh sort={teamSort} field="app" className="px-2 py-2">App</ErpSortTh>
                <th className="px-2 py-2">Day starts</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {teamSort.rows.map((m) => (
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
                  <td className="px-2 py-2 text-[11px]">
                    {m.startMode === "school" ? "At school (gate QR)" : "In the field (GPS)"}
                  </td>
                  <td className="px-2 py-2">
                    {canEdit ? (
                      <RowActionMenu
                        row={m}
                        label={`Actions for ${m.fullName}`}
                        actions={[
                          {
                            id: "assign",
                            label: m.assigned ? "Unassign from the app" : "Assign to the app",
                            onSelect: (x) =>
                              onCommit(
                                setSurveyTeamAssigned(state, x.id, !x.assigned),
                                x.assigned
                                  ? `${x.fullName} removed from app`
                                  : `${x.fullName} assigned — app shows Start`,
                              ),
                          },
                          {
                            id: "start_mode",
                            label: m.startMode === "school" ? "Starts in the field instead" : "Starts at school instead",
                            onSelect: (x) => {
                              const next = x.startMode === "school" ? "field" : "school";
                              onCommit(
                                setSurveyTeamStartMode(state, x.id, next),
                                `${x.fullName} now starts ${next === "school" ? "at school with the gate QR" : "in the field with live GPS"}`,
                              );
                            },
                          },
                          {
                            id: "leader",
                            label: "Make team leader",
                            hidden: (x) => x.role === "leader",
                            onSelect: (x) => onCommit(setSurveyTeamLeader(state, x.id), `${x.fullName} is team leader`),
                          },
                          {
                            id: "remove",
                            label: "Remove from team",
                            tone: "danger",
                            separatorAbove: true,
                            onSelect: (x) => onCommit(removeSurveyTeamMember(state, x.id), `${x.fullName} removed from team`),
                          },
                        ]}
                      />
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
                      className="text-[10px] text-[var(--danger)] underline"
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

      <SurveyDaysBoard canEdit={canEdit} />
    </div>
  );
}
