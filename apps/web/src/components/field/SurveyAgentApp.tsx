"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  activeSessionForMember,
  captureSurveyGeo,
  endSurveyBreak,
  endSurveySession,
  ensureSurveyMasters,
  findSurveyMemberForSession,
  formatSurveyHours,
  isSurveyTeamLeader,
  leaderUpsertBeat,
  loadOfflineQueue,
  persistAdmissions,
  reloadAdmissionsWithSurvey,
  sessionWorkedMs,
  setSurveyBeatActive,
  startSurveyBreak,
  startSurveySession,
  type SurveyTeamMember,
  type SurveyWorkSession,
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
  const [beatId, setBeatId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

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

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);

  const activeBeats = useMemo(
    () => (state?.surveyBeats || []).filter((b) => b.isActive),
    [state],
  );

  const work: SurveyWorkSession | null = useMemo(() => {
    if (!state || !member) return null;
    return activeSessionForMember(state, member.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick refreshes live hours
  }, [state, member, tick]);

  const isLeader = !!(state && member && isSurveyTeamLeader(state, member.id));

  useEffect(() => {
    if (!beatId && activeBeats[0]) setBeatId(activeBeats[0].id);
  }, [activeBeats, beatId]);

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

  async function withGeo<T>(
    fn: (geo: Awaited<ReturnType<typeof captureSurveyGeo>>) => T | Promise<T>,
  ): Promise<T> {
    setBusy(true);
    try {
      const geo = await captureSurveyGeo();
      if (!geo) flash("Location unavailable — continuing without GPS pin");
      return await fn(geo);
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    if (!state || !member) return;
    await withGeo((geo) => {
      const r = startSurveySession(state, member.id, beatId, geo);
      if (!r.ok) {
        flash(r.reason);
        return;
      }
      persistAdmissions(r.state);
      setState(ensureSurveyMasters(r.state));
      flash(
        geo
          ? `Survey started · ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`
          : "Survey started",
      );
    });
  }

  async function onBreak() {
    if (!state || !work) return;
    await withGeo((geo) => {
      const r = startSurveyBreak(state, work.id, geo);
      if (!r.ok) {
        flash(r.reason);
        return;
      }
      persistAdmissions(r.state);
      setState(r.state);
      flash("Break started");
    });
  }

  async function onResume() {
    if (!state || !work) return;
    await withGeo((geo) => {
      const r = endSurveyBreak(state, work.id, geo);
      if (!r.ok) {
        flash(r.reason);
        return;
      }
      persistAdmissions(r.state);
      setState(r.state);
      flash("Back on survey");
    });
  }

  async function onEnd() {
    if (!state || !work) return;
    await withGeo((geo) => {
      const r = endSurveySession(state, work.id, geo);
      if (!r.ok) {
        flash(r.reason);
        return;
      }
      persistAdmissions(r.state);
      setState(r.state);
      flash(`Survey ended · ${formatSurveyHours(r.workedMs)} worked`);
    });
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
              className="w-full rounded-xl bg-[#9a3412] py-3 text-sm font-semibold text-white"
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

  const selectedBeat = activeBeats.find((b) => b.id === beatId);
  const workedLive = work ? sessionWorkedMs(work) : 0;
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

      {!work ? (
        <div className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[12px] text-[var(--muted)]">
              Beat for today *
            </span>
            <select
              className={inp}
              value={beatId}
              onChange={(e) => setBeatId(e.target.value)}
            >
              <option value="">Select beat…</option>
              {activeBeats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !beatId}
            className="w-full rounded-2xl bg-[#166534] py-4 text-base font-semibold text-white disabled:opacity-40"
            onClick={() => void onStart()}
          >
            {busy ? "Getting location…" : "Start survey"}
          </button>
          <p className="text-center text-[11px] text-[var(--muted)]">
            Attendance locks your start location when you tap Start.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[var(--brand-cream)] p-4">
            <p className="text-[12px] text-[var(--muted)]">
              {selectedBeat?.name || "Beat"} ·{" "}
              <span className="capitalize">
                {work.status.replace("_", " ")}
              </span>
            </p>
            <p className="mt-1 text-3xl font-semibold text-[var(--brand-deep)]">
              {formatSurveyHours(workedLive)}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
              Start{" "}
              {work.startGeo
                ? `${work.startGeo.lat.toFixed(4)}, ${work.startGeo.lng.toFixed(4)}`
                : "no GPS"}
            </p>
          </div>

          {work.status === "active" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl border border-[rgba(32,48,80,0.2)] py-3 text-sm font-semibold"
                onClick={() => void onBreak()}
              >
                Break
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl bg-[#9a3412] py-3 text-sm font-semibold text-white"
                onClick={() => void onEnd()}
              >
                End survey
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl bg-[#166534] py-3 text-sm font-semibold text-white"
                onClick={() => void onResume()}
              >
                End break
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl bg-[#9a3412] py-3 text-sm font-semibold text-white"
                onClick={() => void onEnd()}
              >
                End survey
              </button>
            </div>
          )}
        </div>
      )}

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
