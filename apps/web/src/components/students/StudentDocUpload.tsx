"use client";

import { useRef } from "react";
import {
  DOC_ACCEPT,
  DOC_MAX_BYTES,
  emptyDocFile,
  type DocStatus,
  type StudentDocFile,
} from "@/lib/sis";

type Props = {
  label: string;
  value: StudentDocFile;
  onChange: (next: StudentDocFile) => void;
  onError?: (message: string) => void;
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
  isPhoto,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasFile = !!value.fileUrl;
  const isImage =
    value.mimeType.startsWith("image/") ||
    value.fileUrl.startsWith("data:image/");

  function acceptFile(file: File | null) {
    if (!file) return;
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
    if (file.size > DOC_MAX_BYTES) {
      onError?.(`File must be under ${Math.round(DOC_MAX_BYTES / 1000)} KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      onChange({
        status: value.status === "missing" ? "received" : value.status,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        fileUrl: reader.result,
        uploadedAt: new Date().toISOString(),
      });
    };
    reader.onerror = () => onError?.("Could not read file");
    reader.readAsDataURL(file);
  }

  function clearFile() {
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
                  src={value.fileUrl}
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
                  href={value.fileUrl}
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
              No file · PDF or image · under{" "}
              {Math.round(DOC_MAX_BYTES / 1000)} KB
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
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
              onClick={() => fileRef.current?.click()}
            >
              {hasFile ? "Replace" : "Upload"}
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
          acceptFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </li>
  );
}
