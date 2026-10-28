"use client";

import { useEffect, useRef, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  getExistingPushSubscription,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pushSubscribe";
import {
  ChildPicker,
  Flash,
  PARENT_PROFILE_KEY,
  ParentReadState,
  parentPost,
  useActiveChild,
  useFlash,
  useParentProfile,
  type ParentProfileView,
} from "@/components/parent/parentData";
import { useQueryClient } from "@tanstack/react-query";

function statusTone(status: string) {
  if (status === "verified") return "text-[var(--success)]";
  if (status === "pending") return "text-[var(--tone-amber)]";
  if (status === "rejected") return "text-[var(--danger)]";
  return "text-[var(--muted)]";
}

const HOUSEHOLD_FIELDS = [
  ["guardianName", "Guardian name"],
  ["altMobile", "Alt mobile"],
  ["email", "Email"],
  ["address", "Address"],
  ["locality", "Locality"],
  ["landmark", "Landmark"],
  ["city", "City"],
  ["state", "State"],
  ["pincode", "PIN"],
] as const;
type HouseholdField = (typeof HOUSEHOLD_FIELDS)[number][0];

/**
 * The family profile and each child's documents — GET /api/v1/profile, the
 * app's Profile screen. Contact details are saved by the server
 * (POST /api/v1/profile/household); a document goes to the server in one call
 * (POST /api/v1/profile/document), which checks it, files it and marks it
 * awaiting the office's verification.
 */
export function ParentProfileDocsPortal() {
  const profile = useParentProfile();
  return (
    <div className="space-y-4 px-4 py-3">
      <PushCard />
      <ParentReadState query={profile} what="your family's record">
        {(p) => <ProfileBody p={p} />}
      </ParentReadState>
    </div>
  );
}

function PushCard() {
  const flash = useFlash();
  const [pushState, setPushState] = useState<
    "unknown" | "unsupported" | "off" | "on" | "busy"
  >("unknown");
  useEffect(() => {
    if (!pushSupported()) {
      setPushState("unsupported");
      return;
    }
    void getExistingPushSubscription().then((sub) =>
      setPushState(sub ? "on" : "off"),
    );
  }, []);
  async function togglePush() {
    const was = pushState;
    setPushState("busy");
    if (was === "on") {
      await unsubscribeFromPush();
      setPushState("off");
      return flash.ok("Notifications turned off on this device");
    }
    const r = await subscribeToPush();
    if (!r.ok) {
      setPushState("off");
      return flash.fail(r.error || "Could not enable notifications");
    }
    setPushState("on");
    flash.ok("Notifications enabled on this device");
  }
  if (pushState === "unsupported") return null;
  return (
    <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3">
      <Flash notice={flash.notice} error={flash.error} />
      <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
        Notifications
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        Get a device notification for fee receipts, in addition to WhatsApp.
      </p>
      <button
        type="button"
        className={`${pushState === "on" ? btnOutline : btn} mt-3`}
        disabled={pushState === "busy" || pushState === "unknown"}
        onClick={() => void togglePush()}
      >
        {pushState === "on"
          ? "Notifications on — turn off"
          : pushState === "busy"
            ? "Working…"
            : "Enable notifications"}
      </button>
    </section>
  );
}

function ProfileBody({ p }: { p: ParentProfileView }) {
  const client = useQueryClient();
  const flash = useFlash();
  const editable = new Set(p.editableHouseholdFields);
  const initial = () =>
    Object.fromEntries(
      HOUSEHOLD_FIELDS.map(([k]) => [k, p.household[k] ?? ""]),
    ) as Record<HouseholdField, string>;
  const [draft, setDraft] = useState<Record<HouseholdField, string>>(initial);
  const [saving, setSaving] = useState(false);
  const { child, setActiveId, list } = useActiveChild(p.children);
  const kid = p.children.find((c) => c.id === child?.id) ?? null;

  async function save() {
    setSaving(true);
    const body = Object.fromEntries(
      Object.entries(draft).filter(([k]) => editable.has(k)),
    );
    const r = await parentPost("/api/v1/profile/household", body);
    setSaving(false);
    if (!r.ok) return flash.fail(r.error);
    await client.invalidateQueries({ queryKey: PARENT_PROFILE_KEY });
    flash.ok("Family profile saved — the office can see the update");
  }

  return (
    <>
      <Flash notice={flash.notice} error={flash.error} />
      <section
        className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3"
        data-testid="parent-profile"
      >
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Family profile
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          {p.household.code} · mobile {p.household.mobile || "—"}. Changes go to
          the school office.
        </p>
        <div className="mt-3 grid gap-2">
          {HOUSEHOLD_FIELDS.filter(([k]) => editable.has(k)).map(
            ([k, label]) => (
              <label
                key={k}
                className="block text-[11px] font-medium text-[var(--muted)]"
              >
                {label}
                <input
                  className={`${field} mt-0.5`}
                  name={k}
                  value={draft[k]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [k]: e.target.value }))
                  }
                />
              </label>
            ),
          )}
          <button
            type="button"
            className={btn}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save family profile"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Child documents
        </h2>
        <p className="mt-0.5 mb-2 text-[11px] text-[var(--muted)]">
          Upload for the office to verify.
        </p>
        <ChildPicker list={list} child={child} onPick={setActiveId} />
        {kid ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-[var(--muted)]">
              {kid.fullName} · {kid.classLabel} · Adm {kid.admissionNo || "—"}
            </p>
            {(kid.docs ?? []).map((d) => (
              <DocRow
                key={d.key}
                studentId={kid.id}
                doc={d}
                accept={p.documents.find((x) => x.key === d.key)?.accept}
                onDone={async (msg, ok) => {
                  if (!ok) return flash.fail(msg);
                  await client.invalidateQueries({
                    queryKey: PARENT_PROFILE_KEY,
                  });
                  flash.ok(msg);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No children on your family&apos;s record.
          </p>
        )}
      </section>
    </>
  );
}

function DocRow({
  studentId,
  doc,
  accept,
  onDone,
}: {
  studentId: string;
  doc: NonNullable<ParentProfileView["children"][number]["docs"]>[number];
  accept?: string;
  onDone: (message: string, ok: boolean) => void | Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("studentId", studentId);
    form.append("docKey", doc.key);
    form.append("file", file);
    const r = await parentPost("/api/v1/profile/document", form);
    setBusy(false);
    await onDone(r.ok ? `${doc.label} sent for verification` : r.error, r.ok);
  }
  return (
    <div
      className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-2.5"
      data-doc-key={doc.key}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {doc.label}
            {doc.required ? (
              <span className="ml-1 text-[10px] text-[var(--muted)]">
                required
              </span>
            ) : null}
          </p>
          <p className={`text-[11px] font-medium ${statusTone(doc.status)}`}>
            {doc.statusLabel}
            {doc.fileName ? ` · ${doc.fileName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy
            ? "Uploading…"
            : doc.fileName
              ? "Replace & submit"
              : "Upload & submit"}
        </button>
        <input
          ref={ref}
          type="file"
          accept={
            accept ||
            (doc.key === "photo" ? "image/*" : "application/pdf,image/*")
          }
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
