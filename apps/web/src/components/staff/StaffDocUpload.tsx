"use client";

import { useRef, useState } from "react";
import {
  emptyStaffDocFile,
  type StaffDocFile,
  type StaffDocStatus,
} from "@/lib/foundationMasters";
import { useDocLocalPreview } from "@/lib/useDocLocalPreview";

const DOC_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

type Props = {
  label: string;
  value: StaffDocFile;
  onChange: (next: StaffDocFile) => void;
  onError?: (message: string) => void;
  /** Docs upload to Google Drive against an existing staff row — no id yet (new, unsaved staff) means uploads are disabled. */
  staffId?: string;
  docKey: string;
};

function formatSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StaffDocUpload({
  label,
  value,
  onChange,
  onError,
  staffId,
  docKey,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasFile = !!value.fileUrl;
  const isImage =
    value.mimeType.startsWith("image/") ||
    value.fileUrl.startsWith("data:image/");
  const preview = useDocLocalPreview(value.fileUrl, value.uploadedAt);

  async function acceptFile(file: File | null) {
    if (!file) return;
    if (!staffId) {
      onError?.("Save this staff record first, then upload documents");
      return;
    }
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      onError?.("Use PDF or image (JPG/PNG/WebP)");
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
        onError?.(body.error || "Upload failed");
        return;
      }
      const uploadedAt = body.uploadedAt || new Date().toISOString();
      preview.setFromFile(file, `${body.fileUrl}|${uploadedAt}`);
      onChange({
        status: value.status === "missing" ? "received" : value.status,
        fileName: body.fileName || file.name,
        mimeType: body.mimeType || file.type || "application/octet-stream",
        size: body.size ?? file.size,
        fileUrl: body.fileUrl,
        driveFileId: body.driveFileId || "",
        uploadedAt,
      });
    } catch {
      onError?.("Upload failed — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  function setStatus(status: StaffDocStatus) {
    if ((status === "received" || status === "verified") && !value.fileUrl) {
      onError?.("Upload a file before marking received/verified");
      return;
    }
    onChange({ ...value, status });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            {label}
          </div>
          {hasFile ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {value.fileName} · {formatSize(value.size)}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {staffId ? "Not uploaded" : "Save this staff record first"}
            </p>
          )}
        </div>
        <select
          className="field !py-1 text-xs"
          value={value.status}
          onChange={(e) => setStatus(e.target.value as StaffDocStatus)}
        >
          <option value="missing">Missing</option>
          <option value="received">Received</option>
          <option value="pending">Pending verification</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {hasFile && isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.viewUrl}
            alt=""
            className="h-12 w-12 rounded-lg object-cover"
          />
        ) : null}
        <button
          type="button"
          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={busy || !staffId}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Uploading…" : hasFile ? "Replace" : "Upload"}
        </button>
        {hasFile ? (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--danger)]"
            onClick={() => {
              preview.clear();
              onChange(emptyStaffDocFile("missing"));
            }}
          >
            Remove
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept={DOC_ACCEPT}
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
