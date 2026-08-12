"use client";

import { useRef, useState } from "react";
import {
  DOC_ACCEPT,
  emptyDocFile,
  type DocStatus,
  type StudentDocFile,
} from "@/lib/sis";
import { useDocLocalPreview } from "@/lib/useDocLocalPreview";

type Props = {
  label: string;
  value: StudentDocFile;
  onChange: (next: StudentDocFile) => void;
  onError?: (message: string) => void;
  /** Docs upload to Google Drive against an existing student row — no id yet (new, unsaved student) means uploads are disabled. */
  studentId?: string;
  docKey: string;
  /** When true, file changes also drive the Basic tab passport photo. */
  isPhoto?: boolean;
};

function formatSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StudentDocUpload({
  label,
  value,
  onChange,
  onError,
  studentId,
  docKey,
  isPhoto,
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
    if (!studentId) {
      onError?.("Save the student first, then upload documents");
      return;
    }
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      onError?.("Use PDF or image (JPG/PNG/WebP)");
      return;
    }
    if (isPhoto && !file.type.startsWith("image/")) {
      onError?.("Passport photo must be an image");
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("subject", "student");
      formData.append("subjectId", studentId);
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

  function clearFile() {
    preview.clear();
    onChange(emptyDocFile("missing"));
  }

  function setStatus(status: DocStatus) {
    if (status === "received" || status === "verified") {
      if (!value.fileUrl) {
        onError?.("Upload a file before marking received/verified");
        return;
      }
    }
    onChange({ ...value, status });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--brand-deep)]">
            {label}
          </div>
          {hasFile ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.viewUrl}
                  alt=""
                  className="h-14 w-14 rounded-lg border border-[rgba(32,48,80,0.12)] object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  PDF
                </div>
              )}
              <div className="min-w-0">
                <a
                  href={preview.viewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs font-medium text-[var(--brand-mid)]"
                >
                  {value.fileName || "View file"}
                </a>
                <p className="text-[11px] text-[var(--muted)]">
                  {formatSize(value.size)}
                  {value.uploadedAt
                    ? ` · ${new Date(value.uploadedAt).toLocaleDateString("en-IN")}`
                    : ""}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {studentId
                ? "No file · PDF or image"
                : "Save the student first to upload documents"}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <select
            className="field max-w-[9rem] !py-1.5 !text-xs"
            value={value.status}
            onChange={(e) => setStatus(e.target.value as DocStatus)}
          >
            <option value="missing">Missing</option>
            <option value="received">Received</option>
            <option value="pending">Pending verification</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
              disabled={busy || !studentId}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Uploading…" : hasFile ? "Replace" : "Upload"}
            </button>
            {hasFile ? (
              <button
                type="button"
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--danger)]"
                onClick={clearFile}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={isPhoto ? "image/*" : DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void acceptFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </li>
  );
}
