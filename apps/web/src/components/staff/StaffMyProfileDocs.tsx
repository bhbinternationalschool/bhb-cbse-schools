"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  STAFF_DOC_LABELS,
  staffDocStatusLabel,
  type StaffDocFile,
  type StaffDocKey,
} from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";
import { submitStaffDocForVerification } from "@/lib/profileDocVerification";
import { btn } from "@/components/ui/erp-ui";
import { useDocLocalPreview } from "@/lib/useDocLocalPreview";

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

  function onDocUploaded(key: StaffDocKey, next: StaffDocFile) {
    const r = submitStaffDocForVerification({
      staffId,
      docKey: key,
      file: next,
      submittedBy: actorName || staff?.fullName || "",
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
            docKey={key}
            staffId={staffId}
            value={staff.docs[key]}
            onUploaded={(next) => onDocUploaded(key, next)}
            onError={setError}
          />
        ))}
      </div>
    </div>
  );
}

function StaffDocSelfRow({
  label,
  docKey,
  staffId,
  value,
  onUploaded,
  onError,
}: {
  label: string;
  docKey: StaffDocKey;
  staffId: string;
  value: StaffDocFile;
  onUploaded: (next: StaffDocFile) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = !!value.fileUrl;
  const isImage =
    value.mimeType.startsWith("image/") ||
    value.fileUrl.startsWith("data:image/");
  const preview = useDocLocalPreview(value.fileUrl, value.uploadedAt);

  async function acceptFile(file: File | null) {
    if (!file) return;
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      onError("Use PDF or image (JPG/PNG/WebP)");
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("subject", "staff");
      formData.append("subjectId", staffId);
      formData.append("docKey", docKey);
      formData.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fileUrl?: string;
        fileName?: string;
        mimeType?: string;
        size?: number;
        driveFileId?: string;
        uploadedAt?: string;
      };
      if (!res.ok || !body.ok || !body.fileUrl) {
        onError(body.error || "Upload failed");
        return;
      }
      const uploadedAt = body.uploadedAt || new Date().toISOString();
      preview.setFromFile(file, `${body.fileUrl}|${uploadedAt}`);
      onUploaded({
        status: "pending",
        fileName: body.fileName || file.name,
        mimeType: body.mimeType || file.type || "application/octet-stream",
        size: body.size ?? file.size,
        fileUrl: body.fileUrl,
        driveFileId: body.driveFileId || "",
        uploadedAt,
      });
    } catch {
      onError("Upload failed — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

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
          {has ? (
            <a
              href={preview.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-block text-[11px] font-semibold text-[var(--brand-deep)] underline"
            >
              View file
            </a>
          ) : null}
        </div>
        {has && isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.viewUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <button
          type="button"
          className={`${btn} disabled:opacity-50`}
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? "Uploading…" : has ? "Replace" : "Upload"}
        </button>
        <input
          ref={ref}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void acceptFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
