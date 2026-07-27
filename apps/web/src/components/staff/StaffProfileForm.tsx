"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  STAFF_BLOOD_GROUPS,
  STAFF_CASTE_CATEGORIES,
  STAFF_CATEGORIES,
  STAFF_DOC_LABELS,
  STAFF_GENDERS,
  STAFF_JOB_TYPES,
  STAFF_MARITAL,
  STAFF_STREAMS,
  emptyStaffDraft,
  normalizeStaffRecord,
  staffQrPayload,
  type StaffRecord,
} from "@/lib/foundationMasters";
import { loadMasters, saveMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { StaffImageField } from "@/components/staff/StaffImageField";
import { StaffDocUpload } from "@/components/staff/StaffDocUpload";
import { StaffDutiesPanel } from "@/components/staff/StaffDutiesPanel";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  checkStaffRemoval,
  removeStaff,
  validateStaffProfile,
  type StaffFieldErrors,
} from "@/lib/staffResolve";

function printStaffIdCard(staffId: string) {
  const sheet = document.getElementById(`staff-idcard-${staffId}`);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-staff-idcard");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-staff-idcard");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

type Tab =
  | "basic"
  | "employment"
  | "identity"
  | "documents"
  | "duties"
  | "login"
  | "bank"
  | "statutory"
  | "idcard";

const TABS: {
  id: Tab;
  label: string;
  tone:
    | "navy"
    | "teal"
    | "sky"
    | "violet"
    | "green"
    | "amber"
    | "coral"
    | "rose"
    | "slate";
}[] = [
  { id: "basic", label: "Basic", tone: "navy" },
  { id: "employment", label: "Employment", tone: "teal" },
  { id: "identity", label: "IDs", tone: "sky" },
  { id: "documents", label: "Documents", tone: "violet" },
  { id: "duties", label: "Duties", tone: "coral" },
  { id: "login", label: "Login", tone: "slate" },
  { id: "bank", label: "Bank", tone: "green" },
  { id: "statutory", label: "PF & ESIC", tone: "amber" },
  { id: "idcard", label: "ID / QR", tone: "rose" },
];

type Props =
  | { mode: "create" }
  | { mode: "edit"; staffId: string };

export function StaffProfileForm(props: Props) {
  const router = useRouter();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [tab, setTab] = useState<Tab>("basic");
  const [draft, setDraft] = useState<StaffRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [sameAddress, setSameAddress] = useState(false);

  useEffect(() => {
    const m = loadMasters();
    setMasters(m);
    if (props.mode === "create") {
      const id = emptyStaffDraft().id;
      setDraft(
        emptyStaffDraft({
          id,
          nationality: "Indian",
          loginEnabled: true,
          qrPayload: staffQrPayload("", id),
        }),
      );
    } else {
      const existing = m.staff.find((s) => s.id === props.staffId);
      if (!existing) {
        setError("Staff not found");
        return;
      }
      setDraft(normalizeStaffRecord(existing));
    }

    void (async () => {
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const did = await ensureStaffHydrated();
      if (!did) return;
      const next = loadMasters();
      setMasters(next);
      if (props.mode === "edit") {
        const existing = next.staff.find((s) => s.id === props.staffId);
        if (existing) setDraft(normalizeStaffRecord(existing));
      }
    })();
  }, [props]);

  useEffect(() => {
    if (!draft) return;
    const payload =
      draft.qrPayload || staffQrPayload(draft.empCode || "NEW", draft.id);
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      color: { dark: "#1e293b", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [draft?.id, draft?.empCode, draft?.qrPayload]);

  function patch(p: Partial<StaffRecord>) {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
  }

  function save() {
    if (!masters || !draft) return;
    const validation = validateStaffProfile(draft);
    if (Object.keys(validation).length > 0) {
      setFieldErrors(validation);
      setError("Fix the highlighted fields before saving");
      if (validation.empCode || validation.fullName || validation.mobile) {
        setTab("basic");
      } else if (validation.aadhaarNo || validation.panNo) {
        setTab("identity");
      } else if (validation.bankIfsc) {
        setTab("bank");
      } else if (validation.loginUsername) {
        setTab("login");
      }
      return;
    }
    setFieldErrors({});
    const code = draft.empCode.trim().toUpperCase();
    const dup = masters.staff.find(
      (s) =>
        s.empCode.toUpperCase() === code &&
        (props.mode === "create" || s.id !== draft.id),
    );
    if (dup) {
      setError(`Employee code ${code} already exists`);
      setTab("basic");
      return;
    }

    const row = normalizeStaffRecord({
      ...draft,
      empCode: code,
      fullName: draft.fullName.trim(),
      addressPermanent: sameAddress
        ? draft.addressCurrent
        : draft.addressPermanent,
      qrPayload: staffQrPayload(code, draft.id),
      loginUsername:
        draft.loginUsername.trim() ||
        code.toLowerCase().replace(/[^a-z0-9._-]/g, ""),
    });

    const staff =
      props.mode === "create"
        ? [...masters.staff, row]
        : masters.staff.map((s) => (s.id === row.id ? row : s));
    const next = { ...masters, staff };
    saveMasters(next);
    setMasters(next);
    setDraft(row);
    setError(null);
    setNotice(props.mode === "create" ? "Staff created" : "Staff updated");
    window.setTimeout(() => setNotice(null), 2000);
    if (props.mode === "create") {
      router.push(`/staff/${row.id}/edit`);
      router.refresh();
    }
  }

  function setActiveStatus(status: "active" | "inactive") {
    if (!masters || !draft || props.mode !== "edit") return;
    const row = normalizeStaffRecord({ ...draft, status });
    const next = {
      ...masters,
      staff: masters.staff.map((s) => (s.id === row.id ? row : s)),
    };
    saveMasters(next);
    setMasters(next);
    setDraft(row);
    setNotice(status === "active" ? "Staff activated" : "Staff inactivated");
    window.setTimeout(() => setNotice(null), 2000);
  }

  function onRemove() {
    if (!masters || !draft || props.mode !== "edit") return;
    const result = removeStaff(masters, draft.id);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    saveMasters(result.state);
    router.push("/staff");
    router.refresh();
  }

  const depName = useMemo(() => {
    if (!masters || !draft?.departmentId) return "";
    return masters.departments.find((d) => d.id === draft.departmentId)?.name ?? "";
  }, [masters, draft?.departmentId]);

  const desName = useMemo(() => {
    if (!masters || !draft?.designationId) return "";
    return (
      masters.designations.find((d) => d.id === draft.designationId)?.name ?? ""
    );
  }, [masters, draft?.designationId]);

  if (!masters || !draft) {
    return (
      <p className="text-sm text-[var(--muted)]">
        {error ?? "Loading staff profile…"}
      </p>
    );
  }

  const field = "field mt-1 w-full !py-2";
  const labelCls = "text-xs font-semibold text-[var(--muted)]";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <Link href="/staff" className="hover:underline">
              Staff
            </Link>{" "}
            / {props.mode === "create" ? "Add" : "Edit"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--brand-deep)]">
            {props.mode === "create"
              ? "Add staff profile"
              : draft.fullName || draft.empCode}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Complete school HR profile · documents, class/subject duties, vehicle
            mapping, bank, PF & ESIC
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice ? (
            <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
              {notice}
            </span>
          ) : null}
          {props.mode === "edit" ? (
            <>
              <button
                type="button"
                className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={() =>
                  setActiveStatus(
                    draft.status === "active" ? "inactive" : "active",
                  )
                }
              >
                {draft.status === "active" ? "Inactivate" : "Activate"}
              </button>
              <RemoveControl
                check={checkStaffRemoval(masters, draft.id)}
                onRemove={onRemove}
              />
            </>
          ) : null}
          <Link
            href="/staff"
            className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
          >
            Back to roster
          </Link>
          <button
            type="button"
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
            onClick={save}
          >
            Save profile
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      <ModuleTabs
        aria-label="Staff profile sections"
        size="lg"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={TABS}
      />

      <div className="mt-5 space-y-4 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-5 shadow-sm">
        {tab === "basic" ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <StaffImageField
                label="Photo"
                value={draft.photoUrl}
                onChange={(photoUrl) =>
                  patch({
                    photoUrl,
                    docs: {
                      ...draft.docs,
                      photo: photoUrl
                        ? {
                            ...draft.docs.photo,
                            status:
                              draft.docs.photo.status === "missing"
                                ? "received"
                                : draft.docs.photo.status,
                            fileUrl: photoUrl,
                            mimeType: "image/jpeg",
                            fileName: draft.docs.photo.fileName || "photo.jpg",
                            uploadedAt: new Date().toISOString(),
                          }
                        : draft.docs.photo,
                    },
                  })
                }
                onError={setError}
              />
              <StaffImageField
                label="Signature"
                value={draft.signatureUrl}
                aspect="wide"
                onChange={(signatureUrl) => patch({ signatureUrl })}
                onError={setError}
                hint="Sign on paper and upload, or capture"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelCls}>
                Emp code *
                <input
                  className={field}
                  value={draft.empCode}
                  onChange={(e) => patch({ empCode: e.target.value })}
                  disabled={props.mode === "edit"}
                />
                {fieldErrors.empCode ? (
                  <span className="mt-1 block text-[11px] text-[#b91c1c]">
                    {fieldErrors.empCode}
                  </span>
                ) : null}
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Full name *
                <input
                  className={field}
                  value={draft.fullName}
                  onChange={(e) => patch({ fullName: e.target.value })}
                />
                {fieldErrors.fullName ? (
                  <span className="mt-1 block text-[11px] text-[#b91c1c]">
                    {fieldErrors.fullName}
                  </span>
                ) : null}
              </label>
              <label className={labelCls}>
                Gender
                <select
                  className={field}
                  value={draft.gender}
                  onChange={(e) =>
                    patch({ gender: e.target.value as StaffRecord["gender"] })
                  }
                >
                  <option value="">Select…</option>
                  {STAFF_GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Date of birth
                <input
                  type="date"
                  className={field}
                  value={draft.dateOfBirth}
                  onChange={(e) => patch({ dateOfBirth: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Blood group
                <select
                  className={field}
                  value={draft.bloodGroup}
                  onChange={(e) => patch({ bloodGroup: e.target.value })}
                >
                  <option value="">Select…</option>
                  {STAFF_BLOOD_GROUPS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Religion
                <input
                  className={field}
                  value={draft.religion}
                  onChange={(e) => patch({ religion: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Caste category
                <select
                  className={field}
                  value={draft.casteCategory}
                  onChange={(e) =>
                    patch({
                      casteCategory: e.target
                        .value as StaffRecord["casteCategory"],
                    })
                  }
                >
                  <option value="">Select…</option>
                  {STAFF_CASTE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Marital status
                <select
                  className={field}
                  value={draft.maritalStatus}
                  onChange={(e) =>
                    patch({
                      maritalStatus: e.target
                        .value as StaffRecord["maritalStatus"],
                    })
                  }
                >
                  <option value="">Select…</option>
                  {STAFF_MARITAL.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Nationality
                <input
                  className={field}
                  value={draft.nationality}
                  onChange={(e) => patch({ nationality: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Father&apos;s name
                <input
                  className={field}
                  value={draft.fatherName}
                  onChange={(e) => patch({ fatherName: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Spouse name
                <input
                  className={field}
                  value={draft.spouseName}
                  onChange={(e) => patch({ spouseName: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Mobile *
                <input
                  className={field}
                  value={draft.mobile}
                  onChange={(e) => patch({ mobile: e.target.value })}
                />
                {fieldErrors.mobile ? (
                  <span className="mt-1 block text-[11px] text-[#b91c1c]">
                    {fieldErrors.mobile}
                  </span>
                ) : null}
              </label>
              <label className={labelCls}>
                Alternate mobile
                <input
                  className={field}
                  value={draft.altMobile}
                  onChange={(e) => patch({ altMobile: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Email
                <input
                  type="email"
                  className={field}
                  value={draft.email}
                  onChange={(e) => patch({ email: e.target.value })}
                />
                {fieldErrors.email ? (
                  <span className="mt-1 block text-[11px] text-[#b91c1c]">
                    {fieldErrors.email}
                  </span>
                ) : null}
              </label>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className={labelCls}>
                Current address
                <textarea
                  className={`${field} min-h-[5rem]`}
                  value={draft.addressCurrent}
                  onChange={(e) => {
                    const addressCurrent = e.target.value;
                    patch(
                      sameAddress
                        ? { addressCurrent, addressPermanent: addressCurrent }
                        : { addressCurrent },
                    );
                  }}
                />
              </label>
              <label className={labelCls}>
                Permanent address
                <textarea
                  className={`${field} min-h-[5rem]`}
                  value={draft.addressPermanent}
                  disabled={sameAddress}
                  onChange={(e) => patch({ addressPermanent: e.target.value })}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={sameAddress}
                onChange={(e) => {
                  setSameAddress(e.target.checked);
                  if (e.target.checked) {
                    patch({ addressPermanent: draft.addressCurrent });
                  }
                }}
              />
              Permanent address same as current
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelCls}>
                City
                <input
                  className={field}
                  value={draft.city}
                  onChange={(e) => patch({ city: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                State
                <input
                  className={field}
                  value={draft.state}
                  onChange={(e) => patch({ state: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                PIN code
                <input
                  className={field}
                  value={draft.pincode}
                  onChange={(e) => patch({ pincode: e.target.value })}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelCls}>
                Emergency contact
                <input
                  className={field}
                  value={draft.emergencyContactName}
                  onChange={(e) =>
                    patch({ emergencyContactName: e.target.value })
                  }
                />
              </label>
              <label className={labelCls}>
                Emergency mobile
                <input
                  className={field}
                  value={draft.emergencyContactMobile}
                  onChange={(e) =>
                    patch({ emergencyContactMobile: e.target.value })
                  }
                />
              </label>
              <label className={labelCls}>
                Relation
                <input
                  className={field}
                  value={draft.emergencyRelation}
                  onChange={(e) => patch({ emergencyRelation: e.target.value })}
                  placeholder="Spouse / Parent / …"
                />
              </label>
            </div>
          </>
        ) : null}

        {tab === "employment" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelCls}>
              Stream
              <select
                className={field}
                value={draft.stream}
                onChange={(e) =>
                  patch({ stream: e.target.value as StaffRecord["stream"] })
                }
              >
                {STAFF_STREAMS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Employment type
              <select
                className={field}
                value={draft.category}
                onChange={(e) =>
                  patch({
                    category: e.target.value as StaffRecord["category"],
                  })
                }
              >
                {STAFF_CATEGORIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Job type
              <select
                className={field}
                value={draft.jobType}
                onChange={(e) =>
                  patch({
                    jobType: e.target.value as StaffRecord["jobType"],
                  })
                }
              >
                <option value="">Select…</option>
                {STAFF_JOB_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Status
              <select
                className={field}
                value={draft.status}
                onChange={(e) =>
                  patch({
                    status: e.target.value as StaffRecord["status"],
                  })
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className={labelCls}>
              Campus
              <select
                className={field}
                value={draft.campusId ?? ""}
                onChange={(e) => patch({ campusId: e.target.value || null })}
              >
                <option value="">Select…</option>
                {masters.campuses
                  .filter((c) => c.isActive !== false)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelCls}>
              Branch name
              <input
                className={field}
                value={draft.branchName}
                onChange={(e) => patch({ branchName: e.target.value })}
                placeholder="From vendor export if not linked to campus"
              />
            </label>
            <label className={labelCls}>
              Department
              <select
                className={field}
                value={draft.departmentId ?? ""}
                onChange={(e) =>
                  patch({ departmentId: e.target.value || null })
                }
              >
                <option value="">Select…</option>
                {masters.departments
                  .filter((d) => d.isActive)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelCls}>
              Designation
              <select
                className={field}
                value={draft.designationId ?? ""}
                onChange={(e) =>
                  patch({ designationId: e.target.value || null })
                }
              >
                <option value="">Select…</option>
                {masters.designations
                  .filter((d) => d.isActive)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelCls}>
              Joining date
              <input
                type="date"
                className={field}
                value={draft.joiningDate}
                onChange={(e) => patch({ joiningDate: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Leaving date
              <input
                type="date"
                className={field}
                value={draft.leavingDate}
                onChange={(e) => patch({ leavingDate: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Staff added on
              <input
                type="date"
                className={field}
                value={draft.staffAddedOn}
                onChange={(e) => patch({ staffAddedOn: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Basic pay (₹)
              <input
                className={field}
                value={draft.basicPay}
                onChange={(e) => patch({ basicPay: e.target.value })}
                inputMode="decimal"
              />
            </label>
            <label className={labelCls}>
              Experience (years)
              <input
                className={field}
                value={draft.experienceYears}
                onChange={(e) => patch({ experienceYears: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Experience detail
              <input
                className={field}
                value={draft.experienceDetail}
                onChange={(e) => patch({ experienceDetail: e.target.value })}
                placeholder="e.g. 5year 6month"
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Qualification
              <input
                className={field}
                value={draft.qualification}
                onChange={(e) => patch({ qualification: e.target.value })}
                placeholder="B.Ed, M.A., …"
              />
            </label>
            <label className={`${labelCls} sm:col-span-2 lg:col-span-3`}>
              Experience description
              <textarea
                className={`${field} min-h-[3.5rem]`}
                value={draft.experienceDescription}
                onChange={(e) =>
                  patch({ experienceDescription: e.target.value })
                }
                placeholder="Roles / institutions summary"
              />
            </label>
            <label className={`${labelCls} sm:col-span-2 lg:col-span-3`}>
              Subjects taught (teaching staff)
              <input
                className={field}
                value={draft.subjectsTaught}
                onChange={(e) => patch({ subjectsTaught: e.target.value })}
                placeholder="Maths, Science, …"
              />
            </label>
            <label className={labelCls}>
              Biometric ID
              <input
                className={field}
                value={draft.biometricId}
                onChange={(e) => patch({ biometricId: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              RFID / card no.
              <input
                className={field}
                value={draft.rfidNo}
                onChange={(e) => patch({ rfidNo: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              OASIS ID
              <input
                className={field}
                value={draft.oasisId}
                onChange={(e) => patch({ oasisId: e.target.value })}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2 lg:col-span-3`}>
              Remarks
              <textarea
                className={`${field} min-h-[4rem]`}
                value={draft.remarks}
                onChange={(e) => patch({ remarks: e.target.value })}
              />
            </label>
          </div>
        ) : null}

        {tab === "identity" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelCls}>
              Aadhaar no.
              <input
                className={field}
                value={draft.aadhaarNo}
                onChange={(e) => patch({ aadhaarNo: e.target.value })}
                maxLength={12}
              />
              {fieldErrors.aadhaarNo ? (
                <span className="mt-1 block text-[11px] text-[#b91c1c]">
                  {fieldErrors.aadhaarNo}
                </span>
              ) : null}
            </label>
            <label className={labelCls}>
              PAN
              <input
                className={field}
                value={draft.panNo}
                onChange={(e) => patch({ panNo: e.target.value.toUpperCase() })}
                maxLength={10}
              />
              {fieldErrors.panNo ? (
                <span className="mt-1 block text-[11px] text-[#b91c1c]">
                  {fieldErrors.panNo}
                </span>
              ) : null}
            </label>
            <label className={labelCls}>
              Voter ID
              <input
                className={field}
                value={draft.voterId}
                onChange={(e) => patch({ voterId: e.target.value })}
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <StaffImageField
                label="Signature"
                value={draft.signatureUrl}
                aspect="wide"
                onChange={(signatureUrl) => patch({ signatureUrl })}
                onError={setError}
              />
            </div>
          </div>
        ) : null}

        {tab === "documents" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-[var(--muted)]">
              Upload PDF or image · mark received / verified for HR checklist
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {STAFF_DOC_LABELS.map(({ key, label }) => (
                <StaffDocUpload
                  key={key}
                  label={label}
                  value={draft.docs[key]}
                  onError={setError}
                  onChange={(next) => {
                    const docs = { ...draft.docs, [key]: next };
                    const patchDocs: Partial<StaffRecord> = { docs };
                    if (key === "photo" && next.fileUrl) {
                      patchDocs.photoUrl = next.fileUrl;
                    }
                    patch(patchDocs);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {tab === "duties" ? (
          <StaffDutiesPanel
            draft={draft}
            masters={masters}
            onChange={patch}
          />
        ) : null}

        {tab === "login" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)] sm:col-span-2 lg:col-span-3">
              <input
                type="checkbox"
                checked={draft.loginEnabled}
                onChange={(e) => patch({ loginEnabled: e.target.checked })}
              />
              Portal / app login enabled
            </label>
            <label className={labelCls}>
              Username
              <input
                className={field}
                value={draft.loginUsername}
                onChange={(e) => patch({ loginUsername: e.target.value })}
                placeholder="Defaults to emp code"
                autoComplete="off"
              />
              {fieldErrors.loginUsername ? (
                <span className="mt-1 block text-[11px] text-[#b91c1c]">
                  {fieldErrors.loginUsername}
                </span>
              ) : null}
            </label>
            <label className={labelCls}>
              Password
              <input
                type="password"
                className={field}
                value={draft.loginPassword}
                onChange={(e) => patch({ loginPassword: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <p className="sm:col-span-2 lg:col-span-3 text-[11px] text-[var(--muted)]">
              Sign in on the Staff tab with emp code / username / email and this
              password. Leave login fields blank on the login screen for the
              default demo user.
            </p>
          </div>
        ) : null}

        {tab === "bank" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelCls}>
              Account holder name
              <input
                className={field}
                value={draft.bankAccountName}
                onChange={(e) => patch({ bankAccountName: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Bank name
              <input
                className={field}
                value={draft.bankName}
                onChange={(e) => patch({ bankName: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Branch
              <input
                className={field}
                value={draft.bankBranch}
                onChange={(e) => patch({ bankBranch: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Account number
              <input
                className={field}
                value={draft.bankAccountNo}
                onChange={(e) => patch({ bankAccountNo: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              IFSC
              <input
                className={field}
                value={draft.bankIfsc}
                onChange={(e) =>
                  patch({ bankIfsc: e.target.value.toUpperCase() })
                }
                maxLength={11}
              />
              {fieldErrors.bankIfsc ? (
                <span className="mt-1 block text-[11px] text-[#b91c1c]">
                  {fieldErrors.bankIfsc}
                </span>
              ) : null}
            </label>
            <label className={labelCls}>
              UPI ID
              <input
                className={field}
                value={draft.upiId}
                onChange={(e) => patch({ upiId: e.target.value })}
              />
            </label>
          </div>
        ) : null}

        {tab === "statutory" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelCls}>
              PF number
              <input
                className={field}
                value={draft.pfNumber}
                onChange={(e) => patch({ pfNumber: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              UAN
              <input
                className={field}
                value={draft.uanNumber}
                onChange={(e) => patch({ uanNumber: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              PF joining date
              <input
                type="date"
                className={field}
                value={draft.pfJoiningDate}
                onChange={(e) => patch({ pfJoiningDate: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              ESIC number
              <input
                className={field}
                value={draft.esicNumber}
                onChange={(e) => patch({ esicNumber: e.target.value })}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              ESIC dispensary
              <input
                className={field}
                value={draft.esicDispensary}
                onChange={(e) => patch({ esicDispensary: e.target.value })}
              />
            </label>
          </div>
        ) : null}

        {tab === "idcard" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--muted)]">
                Printable staff identity card · save profile first for latest
                photo / QR
              </p>
              <button
                type="button"
                className="rounded-xl bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
                onClick={() => printStaffIdCard(draft.id)}
              >
                Print ID card
              </button>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div
                id={`staff-idcard-${draft.id}`}
                className="staff-idcard-sheet rounded-2xl border border-[rgba(32,48,80,0.15)] bg-gradient-to-br from-[#0f2744] to-[#1e3a5f] p-5 text-white shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5d78e]">
                      {TENANT.shortName || "School"}
                    </p>
                    <p className="mt-1 text-xs text-white/70">Staff identity card</p>
                  </div>
                  {draft.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.photoUrl}
                      alt=""
                      className="h-16 w-16 rounded-lg object-cover ring-2 ring-white/40"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-white/10 text-xs font-bold">
                      PHOTO
                    </div>
                  )}
                </div>
                <h3 className="mt-4 text-lg font-bold">
                  {draft.fullName || "Staff name"}
                </h3>
                <p className="text-sm text-white/80">
                  {desName || "Designation"}
                  {depName ? ` · ${depName}` : ""}
                </p>
                <p className="mt-2 font-mono text-sm tracking-wide text-[#f5d78e]">
                  {draft.empCode || "EMP-CODE"}
                </p>
                <p className="mt-1 text-[11px] text-white/60">
                  {draft.stream === "teaching" ? "Teaching" : "Non-teaching"}
                  {draft.mobile ? ` · ${draft.mobile}` : ""}
                </p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  {draft.signatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.signatureUrl}
                      alt="Signature"
                      className="h-10 w-28 rounded bg-white/90 object-contain p-1"
                    />
                  ) : (
                    <span />
                  )}
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrDataUrl}
                      alt=""
                      className="h-16 w-16 rounded bg-white p-1"
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col items-center justify-center rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)] p-5">
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  Staff QR code
                </h3>
                <p className="mt-1 text-center text-[11px] text-[var(--muted)]">
                  For attendance / ID scan · encodes emp code + staff id
                </p>
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="Staff QR"
                    className="mt-3 h-44 w-44 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-2"
                  />
                ) : (
                  <div className="mt-3 h-44 w-44 animate-pulse rounded-xl bg-[rgba(32,48,80,0.08)]" />
                )}
                <p className="mt-2 font-mono text-xs text-[var(--muted)]">
                  {draft.empCode || "—"}
                </p>
                <button
                  type="button"
                  className="mt-3 text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                  onClick={() => {
                    if (!qrDataUrl) return;
                    const a = document.createElement("a");
                    a.href = qrDataUrl;
                    a.download = `${draft.empCode || "staff"}_qr.png`;
                    a.click();
                  }}
                >
                  Download QR PNG
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-40"
          disabled={tab === "basic"}
          onClick={() => {
            const i = TABS.findIndex((t) => t.id === tab);
            if (i > 0) setTab(TABS[i - 1]!.id);
          }}
        >
          Previous
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
            onClick={save}
          >
            Save profile
          </button>
          <button
            type="button"
            className="rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-40"
            disabled={tab === "idcard"}
            onClick={() => {
              const i = TABS.findIndex((t) => t.id === tab);
              if (i < TABS.length - 1) setTab(TABS[i + 1]!.id);
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
