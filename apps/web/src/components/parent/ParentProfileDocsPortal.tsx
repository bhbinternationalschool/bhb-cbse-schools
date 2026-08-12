"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { classLabelForStudent, resolveParentHousehold } from "@/lib/parentPortal";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  submitStudentDocForVerification,
  updateParentHouseholdProfile,
} from "@/lib/profileDocVerification";
import {
  DOC_ACCEPT,
  DOC_LABELS,
  docHasFile,
  docStatusLabel,
  loadSis,
  type Household,
  type SisStudent,
  type StudentDocFile,
  type StudentDocKey,
} from "@/lib/sis";
import { useDocLocalPreview } from "@/lib/useDocLocalPreview";

function statusTone(status: StudentDocFile["status"]) {
  if (status === "verified") return "text-emerald-700";
  if (status === "pending") return "text-amber-700";
  if (status === "rejected") return "text-rose-700";
  return "text-[var(--muted)]";
}

export function ParentProfileDocsPortal({
  guardianDisplayName,
  householdId,
}: {
  guardianDisplayName: string;
  householdId?: string;
}) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hhDraft, setHhDraft] = useState({
    guardianName: "",
    altMobile: "",
    email: "",
    address: "",
    locality: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
  });

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const sis = loadSis();
    const hh =
      (householdId
        ? sis.households.find((h) => h.id === householdId) ?? null
        : null) ||
      resolveParentHousehold(sis, {
        guardianName: guardianDisplayName,
        mobile: "9876543210",
      });
    setHousehold(hh);
    if (!hh) {
      setChildren([]);
      setActiveId(null);
      return;
    }
    setHhDraft({
      guardianName: hh.guardianName,
      altMobile: hh.altMobile,
      email: hh.email,
      address: hh.address,
      locality: hh.locality,
      landmark: hh.landmark,
      city: hh.city,
      state: hh.state,
      pincode: hh.pincode,
    });
    const kids = sis.students.filter(
      (s) => s.householdId === hh.id && s.status === "active",
    );
    setChildren(kids);
    const aid =
      activeId && kids.some((k) => k.id === activeId)
        ? activeId
        : kids[0]?.id ?? null;
    setActiveId(aid);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName, householdId]);

  const child = useMemo(
    () => children.find((c) => c.id === activeId) ?? null,
    [children, activeId],
  );

  function saveHousehold() {
    if (!household) return;
    const r = updateParentHouseholdProfile({
      householdId: household.id,
      ...hhDraft,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    flash("Family profile saved — office can see the update");
    reload();
  }

  function onDocUploaded(key: StudentDocKey, next: StudentDocFile) {
    if (!household || !child) return;
    const r = submitStudentDocForVerification({
      householdId: household.id,
      studentId: child.id,
      docKey: key,
      file: next,
      submittedBy: guardianDisplayName || household.guardianName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    flash(`${DOC_LABELS.find((d) => d.key === key)?.label} sent for verification`);
    reload();
  }

  if (!household) {
    return (
      <p className="mx-4 mt-4 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        No household linked for this parent. Contact the school office.
      </p>
    );
  }

  return (
    <div className="space-y-4 px-4 py-3">
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

      <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Family profile
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Update contact details. Changes sync to the school office.
        </p>
        <div className="mt-3 grid gap-2">
          {(
            [
              ["guardianName", "Guardian name"],
              ["altMobile", "Alt mobile"],
              ["email", "Email"],
              ["address", "Address"],
              ["locality", "Locality"],
              ["landmark", "Landmark"],
              ["city", "City"],
              ["state", "State"],
              ["pincode", "PIN"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block text-[11px] font-medium text-[var(--muted)]">
              {label}
              <input
                className={`${field} mt-0.5`}
                value={hhDraft[k]}
                onChange={(e) =>
                  setHhDraft((d) => ({ ...d, [k]: e.target.value }))
                }
              />
            </label>
          ))}
          <button type="button" className={btn} onClick={saveHousehold}>
            Save family profile
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Child documents
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Upload and submit for class teacher / office verification.
        </p>
        {children.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  activeId === c.id
                    ? "bg-[var(--brand-deep)] text-white"
                    : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)]"
                }`}
              >
                {c.fullName.split(" ")[0]}
              </button>
            ))}
          </div>
        ) : null}
        {child ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[var(--muted)]">
              <StudentNameLabel student={child} /> ·{" "}
              {classLabelForStudent(child)}
            </p>
            {DOC_LABELS.map(({ key, label }) => (
              <DocRow
                key={key}
                label={label}
                docKey={key}
                studentId={child.id}
                value={child.docs[key]}
                onUploaded={(next) => onDocUploaded(key, next)}
                onError={setError}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">No active children.</p>
        )}
      </section>
    </div>
  );
}

function DocRow({
  label,
  docKey,
  studentId,
  value,
  onUploaded,
  onError,
}: {
  label: string;
  docKey: StudentDocKey;
  studentId: string;
  value: StudentDocFile;
  onUploaded: (next: StudentDocFile) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = docHasFile(value);
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
    if (docKey === "photo" && !file.type.startsWith("image/")) {
      onError("Passport photo must be an image");
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
    <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">{label}</p>
          <p className={`text-[11px] font-medium ${statusTone(value.status)}`}>
            {docStatusLabel(value.status)}
          </p>
          {value.reviewNote ? (
            <p className="mt-0.5 text-[11px] text-rose-700">
              Remark: {value.reviewNote}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? "Uploading…" : has ? "Replace & submit" : "Upload & submit"}
        </button>
        <input
          ref={ref}
          type="file"
          accept={docKey === "photo" ? "image/*" : DOC_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void acceptFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
      {has && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.viewUrl}
          alt=""
          className="mt-2 h-16 w-16 rounded-md object-cover"
        />
      ) : has ? (
        <a
          href={preview.viewUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[11px] font-semibold text-[var(--brand-deep)] underline"
        >
          View file
        </a>
      ) : null}
    </div>
  );
}
