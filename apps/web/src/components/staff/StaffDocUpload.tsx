"use client";

import { useRef } from "react";
import {
  emptyStaffDocFile,
  type StaffDocFile,
  type StaffDocStatus,
} from "@/lib/foundationMasters";

const DOC_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const DOC_MAX_BYTES = 1_200_000;

type Props = {
  label: string;
  value: StaffDocFile;
  onChange: (next: StaffDocFile) => void;
  onError?: (message: string) => void;
};

function formatSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StaffDocUpload({ label, value, onChange, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasFile = !!value.fileUrl;
  const isImage =
    value.mimeType.startsWith("image/") ||
    value.fileUrl.startsWith("data:image/");

  async function acceptFile(file: File | null) {
    if (!file) return;
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      onError?.("Use PDF or image (JPG/PNG/WebP)");
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      onError?.(`File must be under ${Math.round(DOC_MAX_BYTES / 1000)} KB`);
      return;
    }
    const { uploadSchoolObject } = await import("@/lib/objectStorage");
    const uploaded = await uploadSchoolObject({
      path: `staff/docs/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`,
      blob: file,
      contentType: file.type,
    });
    if (!uploaded.ok) {
      onError?.(uploaded.error);
      return;
    }
    onChange({
      status: value.status === "missing" ? "received" : value.status,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      fileUrl: uploaded.url,
      uploadedAt: new Date().toISOString(),
    });
  }

  function setStatus(status: StaffDocStatus) {
    if ((status === "received" || status === "verified") && !value.fileUrl) {
      onError?.("Upload a file before marking received/verified");
      return;
    }
    onChange({ ...value, status });
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3">
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
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">Not uploaded</p>
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
            src={value.fileUrl}
            alt=""
            className="h-12 w-12 rounded-lg object-cover"
          />
        ) : null}
        <button
          type="button"
          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={() => fileRef.current?.click()}
        >
          {hasFile ? "Replace" : "Upload"}
        </button>
        {hasFile ? (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--danger)]"
            onClick={() => onChange(emptyStaffDocFile("missing"))}
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
            acceptFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
