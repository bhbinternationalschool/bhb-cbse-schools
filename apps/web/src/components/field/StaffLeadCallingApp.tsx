"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isLeadCaller,
  leadFollowUpBucket,
  loadAdmissions,
  saveAdmissions,
  stageLabel,
  stageTagClass,
  logFollowUp,
  type AdmissionsState,
} from "@/lib/admissions";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";

export function StaffLeadCallingApp({ session }: { session: DemoSession }) {
  const [state, setState] = useState<AdmissionsState | null>(null);
  const [note, setNote] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setState(loadAdmissions());
  }, []);

  const allowed = !!(state && isLeadCaller(state, session.staffId));

  const myLeads = useMemo(() => {
    if (!state || !allowed) return [];
    const me = session.fullName.trim().toLowerCase();
    return state.leads
      .filter(
        (l) =>
          l.stage !== "enrolled" &&
          l.stage !== "lost" &&
          l.assignedTo.trim().toLowerCase() === me,
      )
      .sort((a, b) =>
        (b.leadDate || b.createdAt).localeCompare(a.leadDate || a.createdAt),
      );
  }, [state, allowed, session.fullName]);

  function saveFollowUp(leadId: string) {
    if (!state) return;
    const r = logFollowUp(
      state,
      leadId,
      {
        channel: "call",
        outcome: "connected",
        note: note.trim() || "Called from staff app",
        nextFollowUpAt: "",
        assignToSelf: true,
      },
      session.fullName,
    );
    if (!r.ok) {
      setMsg(r.reason);
      return;
    }
    saveAdmissions(r.state);
    setState(r.state);
    setNote("");
    setActiveId(null);
    setMsg("Follow-up saved");
  }

  if (!state) {
    return <p className="p-6 text-sm text-[var(--muted)]">Loading…</p>;
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-8">
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
          Lead calling
        </h1>
        <p className="rounded-xl border border-[rgba(154,52,18,0.25)] bg-[rgba(154,52,18,0.08)] px-3 py-3 text-[13px] text-[var(--brand-deep)]">
          Lead and admission lists are hidden until office assigns you for{" "}
          <strong>lead calling</strong>. You can still capture leads and
          collect registration UPI without seeing the CRM list.
        </p>
        <Link href="/field" className="block text-sm underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {TENANT.shortName} · Calling
        </p>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
          My assigned leads
        </h1>
        <p className="text-[12px] text-[var(--muted)]">
          Only leads assigned to you — no full admission list.
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl bg-[rgba(22,101,52,0.12)] px-3 py-2 text-[12px] text-[#166534]">
          {msg}
        </p>
      ) : null}

      {myLeads.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">
          No open leads assigned to {session.fullName}.
        </p>
      ) : (
        <ul className="space-y-2">
          {myLeads.map((l) => {
            const bucket = leadFollowUpBucket(l);
            return (
              <li
                key={l.id}
                className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-[var(--brand-deep)]">
                      {l.childName}
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {l.enquiryNo} · {l.guardianName} · {l.mobile}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTagClass(l.stage)}`}
                  >
                    {stageLabel(l.stage)}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  Follow-up: {bucket.replace("_", " ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={`tel:${l.mobile}`}
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                  >
                    Call
                  </a>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
                    onClick={() =>
                      setActiveId(activeId === l.id ? null : l.id)
                    }
                  >
                    Log
                  </button>
                </div>
                {activeId === l.id ? (
                  <div className="mt-2 space-y-2">
                    <input
                      className="w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                      placeholder="Call note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className="w-full rounded-lg bg-[#166534] py-2 text-[12px] font-semibold text-white"
                      onClick={() => saveFollowUp(l.id)}
                    >
                      Save follow-up
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/field" className="block text-center text-sm underline">
        Back to Field app
      </Link>
    </div>
  );
}
