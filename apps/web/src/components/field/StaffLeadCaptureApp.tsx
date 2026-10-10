"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  createStaffMobileEnquiry,
  emptyAdmissionLead,
  loadAdmissions,
  saveAdmissions,
  todayYmd,
  type TransportInterest,
} from "@/lib/admissions";
import { loadMasters } from "@/lib/masters";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";
import { SisParentMatchBanner } from "@/components/admissions/SisParentMatchBanner";
import { VoiceMicButton } from "@/components/voice/VoiceMicButton";

const inp =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] bg-white px-3 py-3 text-base";

export function StaffLeadCaptureApp({ session }: { session: DemoSession }) {
  const masters = useMemo(() => loadMasters(), []);
  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );
  const by = session.fullName;

  const [childName, setChildName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [classSoughtId, setClassSoughtId] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [mobile, setMobile] = useState("");
  const [locality, setLocality] = useState("");
  const [address, setAddress] = useState("");
  const [transportInterest, setTransportInterest] =
    useState<TransportInterest>("undecided");
  const [previousSchool, setPreviousSchool] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    const state = loadAdmissions();
    const r = createStaffMobileEnquiry(
      state,
      emptyAdmissionLead({
        source: "walk_in",
        childName,
        dob,
        gender,
        classSoughtId,
        guardianName,
        motherName,
        mobile,
        locality,
        address,
        transportInterest,
        previousSchool,
        campaignNote: note.trim() || `Staff mobile · ${by}`,
        leadDate: todayYmd(),
      }),
      by,
    );
    if (!r.ok) {
      setMsg(r.reason);
      return;
    }
    saveAdmissions(r.state);
    setMsg(`Saved ${r.lead.enquiryNo} · assigned to you (not visible in lists until lead-calling assignment)`);
    setChildName("");
    setDob("");
    setGender("");
    setGuardianName("");
    setMotherName("");
    setMobile("");
    setLocality("");
    setAddress("");
    setPreviousSchool("");
    setNote("");
    setTransportInterest("undecided");
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {TENANT.shortName} · Staff app
        </p>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
          Capture lead
        </h1>
        <p className="text-[12px] text-[var(--muted)]">
          From anywhere — no survey beat. {by}
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl bg-[rgba(22,101,52,0.12)] px-3 py-2 text-[12px] text-[#166534]">
          {msg}
        </p>
      ) : null}

      <div className="space-y-3">
        <input
          className={inp}
          placeholder="Child name *"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inp}
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
          <select
            className={inp}
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="">Gender</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </select>
        </div>
        <select
          className={inp}
          value={classSoughtId}
          onChange={(e) => setClassSoughtId(e.target.value)}
        >
          <option value="">Class sought</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className={inp}
          placeholder="Father / guardian *"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Mother"
          value={motherName}
          onChange={(e) => setMotherName(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Mobile * (10 digit)"
          inputMode="numeric"
          maxLength={10}
          value={mobile}
          onChange={(e) =>
            setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
        />
        <SisParentMatchBanner
          guardianName={guardianName}
          motherName={motherName}
          mobile={mobile}
        />
        <input
          className={inp}
          placeholder="Locality"
          value={locality}
          onChange={(e) => setLocality(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <select
          className={inp}
          value={transportInterest}
          onChange={(e) =>
            setTransportInterest(e.target.value as TransportInterest)
          }
        >
          <option value="undecided">Transport undecided</option>
          <option value="yes">Transport yes</option>
          <option value="no">Transport no</option>
        </select>
        <input
          className={inp}
          placeholder="Previous school"
          value={previousSchool}
          onChange={(e) => setPreviousSchool(e.target.value)}
        />
        <span className="flex items-center gap-1.5">
          <input
            className={inp}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <VoiceMicButton
            onTranscript={(t) => setNote((prev) => (prev ? `${prev} ${t}` : t))}
          />
        </span>
      </div>

      <button
        type="button"
        className="w-full rounded-2xl bg-[var(--brand-deep)] py-3.5 text-sm font-semibold text-white"
        onClick={submit}
      >
        Save lead
      </button>

      <Link href="/field" className="block text-center text-sm underline">
        Back to Field app
      </Link>
    </div>
  );
}
