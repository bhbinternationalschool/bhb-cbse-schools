"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  STAFF_DOC_LABELS,
  emptyStaffDocFile,
  staffDocStatusLabel,
  type StaffDocFile,
  type StaffDocKey,
  type StaffRecord,
} from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";
import { submitStaffDocForVerification } from "@/lib/profileDocVerification";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

function statusTone(status: StaffDocFile["status"]) {
  if (status === "verified") return "text-emerald-700";
  if (status === "pending") return "text-amber-700";
  if (status === "rejected") return "text-rose-700";
  return "text-[var(--muted)]";
}

/** Staff self-service: upload own docs and submit to HR / office / principal. */
export function StaffMyProfileDocs({
  staffId,
  actorName,
}: {
  staffId: string;
  actorName: string;
}) {
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staff = useMemo(() => {
    void tick;
    if (!staffId) return null;
    return loadMasters().staff.find((s) => s.id === staffId) ?? null;
  }, [staffId, tick]);

  useEffect(() => {
    setTick((n) => n + 1);
  }, [staffId]);

  async function onPick(key: StaffDocKey, file: File | null, row: StaffRecord) {
    if (!file) return;
    setError(null);
    const { uploadSchoolObject } = await import("@/lib/objectStorage");
    const uploaded = await uploadSchoolObject({
      path: `staff/docs/${row.id}_${key}_${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`,
      blob: file,
      contentType: file.type,
    });
    if (!uploaded.ok) {
      setError(uploaded.error);
      return;
    }
    const next: StaffDocFile = {
      ...emptyStaffDocFile("pending"),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      fileUrl: uploaded.url,
      uploadedAt: new Date().toISOString(),
    };
    const r = submitStaffDocForVerification({
      staffId: row.id,
      docKey: key,
      file: next,
      submittedBy: actorName || row.fullName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNotice("Submitted for HR / office verification");
    window.setTimeout(() => setNotice(null), 2500);
    setTick((n) => n + 1);
  }

  if (!staffId) {
    return (
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        Sign in with a staff login linked to your employee record to update
        documents.
      </p>
    );
  }
  if (!staff) {
    return (
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        Staff profile not found.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          My documents — {staff.fullName}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          Upload required docs. Office / principal will verify or reject with
          remarks.
        </p>
      </div>
      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        {STAFF_DOC_LABELS.map(({ key, label }) => (
          <StaffDocSelfRow
            key={key}
            label={label}
            value={staff.docs[key]}
            onPick={(f) => void onPick(key, f, staff)}
          />
        ))}
      </div>
    </div>
  );
}

function StaffDocSelfRow({
  label,
  value,
  onPick,
}: {
  label: string;
  value: StaffDocFile;
  onPick: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const has = !!value.fileUrl;

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">{label}</p>
          <p className={`text-[11px] font-medium ${statusTone(value.status)}`}>
            {staffDocStatusLabel(value.status)}
          </p>
          {value.reviewNote ? (
            <p className="mt-0.5 text-[11px] text-rose-700">
              Remark: {value.reviewNote}
            </p>
          ) : null}
        </div>
        <button type="button" className={btn} onClick={() => ref.current?.click()}>
          {has ? "Replace" : "Upload"}
        </button>
        <input
          ref={ref}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
