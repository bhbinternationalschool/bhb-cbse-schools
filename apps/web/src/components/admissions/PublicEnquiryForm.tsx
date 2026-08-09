"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  ADMISSION_SOURCES,
  createEnquiry,
  isDigitalCaptureSource,
  loadAdmissions,
  saveAdmissions,
  sourceLabel,
  type AdmissionSource,
} from "@/lib/admissions";
import type { PublicRegistrationConfig } from "@/lib/publicRegistration";
import { TENANT } from "@/lib/types";
import { AddressAutocompleteField } from "@/components/maps/AddressAutocompleteField";

const FALLBACK_CLASSES = [
  "Nursery",
  "LKG",
  "UKG",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];

function resolveSource(raw: string | null): AdmissionSource {
  const v = (raw || "website").toLowerCase() as AdmissionSource;
  if (isDigitalCaptureSource(v)) return v;
  if (ADMISSION_SOURCES.some((s) => s.value === v && v !== "walk_in")) {
    return v;
  }
  return "website";
}

export function PublicEnquiryForm({
  initialSource,
  config,
}: {
  initialSource?: string | null;
  config: PublicRegistrationConfig;
}) {
  const source = resolveSource(initialSource ?? null);
  // Classes come from the DB via the server. Never call loadMasters() here:
  // this page is public, so masters are cold and the fallback would mint
  // random class ids (see lib/publicRegistration.server.ts). When the DB has
  // no classes we fall back to name-only options with an empty id, which
  // createEnquiry accepts (allowMissingClass) and records in the campaign note.
  const classes = useMemo(
    () =>
      config.classes.length > 0
        ? config.classes
        : FALLBACK_CLASSES.map((name) => ({ id: "", name })),
    [config.classes],
  );

  const [childName, setChildName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [classKey, setClassKey] = useState(classes[0]?.name || "");
  const [guardianName, setGuardianName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [mobile, setMobile] = useState("");
  const [locality, setLocality] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ enquiryNo: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cls = classes.find((c) => c.name === classKey || c.id === classKey);
    const classSoughtId = cls?.id || "";
    const classLabel = cls?.name || classKey;
    const state = loadAdmissions();
    const r = createEnquiry(
      state,
      {
        source,
        childName,
        dob,
        gender,
        classSoughtId,
        guardianName,
        motherName,
        mobile,
        locality,
        address,
        pincode,
        campaignNote: `Public · ${sourceLabel(source)}${classSoughtId ? "" : ` · Class ${classLabel}`}`,
        note,
        leadDate: new Date().toISOString().slice(0, 10),
      },
      "Public form",
      { allowMissingClass: true, publicSubmit: true },
    );
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    saveAdmissions(r.state);
    setDone({ enquiryNo: r.lead.enquiryNo });
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-10">
        <BrandHeader />
        <div className="mt-8 rounded-2xl border border-[rgba(21,128,61,0.35)] bg-[rgba(21,128,61,0.08)] px-5 py-6 text-center">
          <p className="text-sm font-semibold text-[#15803d]">Enquiry received</p>
          <p className="mt-3 font-mono text-2xl font-bold text-[var(--brand-deep)]">
            {done.enquiryNo}
          </p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Please save this lead number. Our counsellor will contact you shortly.
          </p>
        </div>
      </main>
    );
  }

  const inp =
    "w-full rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2.5 text-sm";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-8">
      <BrandHeader />
      <h1 className="mt-6 text-xl font-bold text-[var(--brand-deep)]">
        Admission enquiry
      </h1>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Source: <strong>{sourceLabel(source)}</strong> · You will get a lead
        number after submit.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Child name *
          <input
            className={`${inp} mt-1`}
            required
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Date of birth
            <input
              type="date"
              className={`${inp} mt-1`}
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Gender
            <select
              className={`${inp} mt-1`}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Class sought *
          <select
            className={`${inp} mt-1`}
            required
            value={classKey}
            onChange={(e) => setClassKey(e.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id || c.name} value={c.id || c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Father / guardian *
          <input
            className={`${inp} mt-1`}
            required
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Mother name
          <input
            className={`${inp} mt-1`}
            value={motherName}
            onChange={(e) => setMotherName(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Mobile *
          <input
            className={`${inp} mt-1`}
            required
            inputMode="numeric"
            maxLength={10}
            value={mobile}
            onChange={(e) =>
              setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="10-digit mobile"
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Home address
          <div className="mt-1">
            <AddressAutocompleteField
              value={address}
              onChange={(v) => {
                setAddress(v);
              }}
              onResolved={(place) => {
                setAddress(place.address);
                if (place.locality) setLocality(place.locality);
                if (place.pincode) setPincode(place.pincode);
              }}
              inputClassName={inp}
            />
          </div>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Locality / area
          <input
            className={`${inp} mt-1`}
            value={locality}
            onChange={(e) => setLocality(e.target.value)}
            placeholder="Filled when you pick an address above"
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          PIN code
          <input
            className={`${inp} mt-1`}
            inputMode="numeric"
            maxLength={6}
            value={pincode}
            onChange={(e) =>
              setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Message (optional)
          <textarea
            className={`${inp} mt-1`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error ? (
          <p className="text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-xl bg-[var(--brand-deep)] px-4 py-3 text-sm font-semibold text-white"
        >
          Submit enquiry
        </button>
      </form>
    </main>
  );
}

function BrandHeader() {
  return (
    <div>
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={64}
        height={66}
        className="logo-mark object-contain"
        priority
        aria-hidden
      />
      <p className="font-brand-name mt-2 text-sm text-[var(--brand-deep)]">
        {TENANT.nameDisplay}
      </p>
      <p className="font-tagline text-sm">{TENANT.tagline}</p>
    </div>
  );
}
