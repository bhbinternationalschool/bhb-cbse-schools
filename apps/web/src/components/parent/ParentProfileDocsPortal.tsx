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
  DOC_MAX_BYTES,
  docHasFile,
  docStatusLabel,
  emptyDocFile,
  loadSis,
  type Household,
  type SisStudent,
  type StudentDocFile,
  type StudentDocKey,
} from "@/lib/sis";

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

  async function onPickDoc(key: StudentDocKey, file: File | null) {
    if (!household || !child || !file) return;
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      setError("Use PDF or image (JPG/PNG/WebP)");
      return;
    }
    if (key === "photo" && !file.type.startsWith("image/")) {
      setError("Passport photo must be an image");
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setError(`File must be under ${Math.round(DOC_MAX_BYTES / 1000)} KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const next: StudentDocFile = {
        ...emptyDocFile("pending"),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        fileUrl: reader.result,
        uploadedAt: new Date().toISOString(),
      };
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
    };
    reader.onerror = () => setError("Could not read file");
    reader.readAsDataURL(file);
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
                value={child.docs[key]}
                onPick={(f) => void onPickDoc(key, f)}
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
  value,
  onPick,
}: {
  label: string;
  docKey: StudentDocKey;
  value: StudentDocFile;
  onPick: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const has = docHasFile(value);
  const isImage =
    value.mimeType.startsWith("image/") ||
    value.fileUrl.startsWith("data:image/");

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
          className="shrink-0 rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[11px] font-semibold"
          onClick={() => ref.current?.click()}
        >
          {has ? "Replace & submit" : "Upload & submit"}
        </button>
        <input
          ref={ref}
          type="file"
          accept={docKey === "photo" ? "image/*" : DOC_ACCEPT}
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
      {has && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value.fileUrl}
          alt=""
          className="mt-2 h-16 w-16 rounded-md object-cover"
        />
      ) : has ? (
        <a
          href={value.fileUrl}
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
