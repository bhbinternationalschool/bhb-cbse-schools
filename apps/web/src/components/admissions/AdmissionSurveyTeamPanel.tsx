"use client";

import { useMemo, useState } from "react";
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
import { SurveyDaysBoard } from "@/components/admissions/SurveyDaysBoard";
import { SurveyTeamCard } from "@/components/admissions/SurveyTeamCard";

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
  const [callerStaffId, setCallerStaffId] = useState("");

  const callerIds = state.leadCallerStaffIds || [];
  const staffNotCallers = staff.filter((s) => !callerIds.includes(s.id));

  return (
    <div className="space-y-4">
      <SurveyTeamCard />

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
