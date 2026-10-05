"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SurveyDayApp } from "@/components/field/SurveyDayApp";
import {
  findSurveyMemberForSession,
  isSurveyTeamLeader,
  leaderUpsertBeat,
  loadOfflineQueue,
  persistAdmissions,
  reloadAdmissionsWithSurvey,
  setSurveyBeatActive,
  type SurveyTeamMember,
} from "@/lib/fieldSurvey";
import { todayYmd, type AdmissionsState } from "@/lib/admissions";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";

const inp =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] bg-white px-3 py-3 text-base";

const LOCAL_MEMBER_KEY = "bhb_survey_agent_member_v1";

export function SurveyAgentApp({ session }: { session: DemoSession }) {
  const [state, setState] = useState<AdmissionsState | null>(null);
  const [member, setMember] = useState<SurveyTeamMember | null>(null);
  const [mobileGate, setMobileGate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [beatName, setBeatName] = useState("");
  const [beatArea, setBeatArea] = useState("");
  const [beatTarget, setBeatTarget] = useState("40");
  const [editBeatId, setEditBeatId] = useState("");

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function refresh() {
    const next = reloadAdmissionsWithSurvey();
    setState(next);
    return next;
  }

  useEffect(() => {
    const next = refresh();
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LOCAL_MEMBER_KEY)
        : null;
    const byStaff = findSurveyMemberForSession(next, {
      staffId: session.staffId || undefined,
    });
    if (byStaff) {
      setMember(byStaff);
      return;
    }
    if (saved) {
      const byId = findSurveyMemberForSession(next, { memberId: saved });
      if (byId) setMember(byId);
    }
  }, [session.staffId]);

  const isLeader = !!(state && member && isSurveyTeamLeader(state, member.id));

  function claimByMobile() {
    if (!state) return;
    const hit = findSurveyMemberForSession(state, { mobile: mobileGate });
    if (!hit) {
      flash("Not assigned — ask office to Assign you on Field survey team");
      return;
    }
    setMember(hit);
    window.localStorage.setItem(LOCAL_MEMBER_KEY, hit.id);
    flash(`Welcome ${hit.fullName}`);
  }

  function signOutAgent() {
    setMember(null);
    window.localStorage.removeItem(LOCAL_MEMBER_KEY);
  }

  function saveBeat() {
    if (!state || !member || !beatName.trim()) return;
    const r = leaderUpsertBeat(state, member.id, {
      id: editBeatId || undefined,
      name: beatName.trim(),
      area: beatArea.trim(),
      targetHouseholds: Math.round(Number(beatTarget) || 0),
    });
    if (!r.ok) {
      flash(r.reason);
      return;
    }
    persistAdmissions(r.state);
    setState(r.state);
    flash(editBeatId ? "Beat updated" : "Beat added");
    setBeatName("");
    setBeatArea("");
    setBeatTarget("40");
    setEditBeatId("");
  }

  if (!state) {
    return (
      <p className="p-6 text-sm text-[var(--muted)]">Loading survey app…</p>
    );
  }

  if (!member) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-8">
        <p className="font-brand-name text-sm text-[var(--brand-deep)]">
          {TENANT.nameDisplay}
        </p>
        <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
          Field survey
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Only <strong>assigned</strong> survey team members can start. School
          staff signed in as {session.fullName}
          {session.staffId ? "" : " (no staff id on session)"}.
        </p>
        {!findSurveyMemberForSession(state, {
          staffId: session.staffId || undefined,
        }) ? (
          <div className="space-y-3 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[var(--brand-cream)] p-4">
            <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
              Outside / survey-only login
            </p>
            <input
              className={inp}
              placeholder="Registered mobile"
              inputMode="numeric"
              maxLength={10}
              value={mobileGate}
              onChange={(e) =>
                setMobileGate(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
            />
            <button
              type="button"
              className="w-full rounded-xl bg-[var(--tone-brick-solid)] py-3 text-sm font-semibold text-white"
              onClick={claimByMobile}
            >
              Open my survey
            </button>
          </div>
        ) : null}
        <p className="text-[12px] text-[var(--muted)]">
          Not seeing Start? Ask office: Admissions → Field survey → Survey team
          → Assign.
        </p>
        <Link href="/field" className="block text-sm underline">
          Back
        </Link>
      </div>
    );
  }

  const offlineN = loadOfflineQueue().length;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Survey app · {todayYmd()}
          </p>
          <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
            {member.fullName}
          </h1>
          <p className="text-[12px] text-[var(--muted)]">
            {member.role === "leader" ? "Team leader" : "Survey agent"}
            {member.kind === "external" ? " · outside" : ""}
          </p>
        </div>
        <button
          type="button"
          className="text-[11px] underline"
          onClick={signOutAgent}
        >
          Switch
        </button>
      </div>

      {notice ? (
        <p className="mt-3 rounded-xl bg-[rgba(22,101,52,0.12)] px-3 py-2 text-[12px] text-[#166534]">
          {notice}
        </p>
      ) : null}

      {/* The day itself — signed by this phone, live GPS at every step
          (director, 5 Oct 2026). The old Start/Break/End here wrote only
          this browser's copy, with GPS optional. */}
      <div className="mt-6">
        <SurveyDayApp embedded />
      </div>

      {isLeader ? (
        <div className="mt-8 space-y-3 border-t border-[rgba(32,48,80,0.1)] pt-6">
          <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
            Team leader · beats
          </p>
          <input
            className={inp}
            placeholder="Beat name *"
            value={beatName}
            onChange={(e) => setBeatName(e.target.value)}
          />
          <input
            className={inp}
            placeholder="Area"
            value={beatArea}
            onChange={(e) => setBeatArea(e.target.value)}
          />
          <input
            className={inp}
            type="number"
            placeholder="Target HH"
            value={beatTarget}
            onChange={(e) => setBeatTarget(e.target.value)}
          />
          <button
            type="button"
            className="w-full rounded-xl bg-[var(--brand-deep)] py-3 text-sm font-semibold text-white"
            onClick={saveBeat}
          >
            {editBeatId ? "Update beat" : "Add beat"}
          </button>
          <ul className="space-y-2 text-[12px]">
            {state.surveyBeats.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] px-2 py-1.5"
              >
                <span>
                  {b.code} {b.name}
                  {!b.isActive ? " (off)" : ""}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setEditBeatId(b.id);
                      setBeatName(b.name);
                      setBeatArea(b.area);
                      setBeatTarget(String(b.targetHouseholds));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      const next = setSurveyBeatActive(state, b.id, !b.isActive);
                      persistAdmissions(next);
                      setState(next);
                    }}
                  >
                    {b.isActive ? "Off" : "On"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8 space-y-2 text-[12px] text-[var(--muted)]">
        <Link href="/admissions" className="block font-semibold underline">
          Capture leads in Admissions (tablet)
        </Link>
        {offlineN > 0 ? (
          <p>{offlineN} offline capture(s) waiting to sync.</p>
        ) : null}
        <Link href="/field" className="block underline">
          Field home
        </Link>
      </div>
    </div>
  );
}
