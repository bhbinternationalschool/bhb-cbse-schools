"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  GUARDIAN_RELATIONS,
  addGuardian,
  addSiblingEnquiry,
  createEnquiry,
  emptyAdmissionLead,
  fieldSurveyStats,
  findHouseholdByMobile,
  listFieldSurveyLeads,
  publicEnquiryAbsoluteUrl,
  registrationFeeHeads,
  siblingsOfHousehold,
  stageLabel,
  stageTagClass,
  todayYmd,
  updateLead,
  type AdmissionsState,
  type GuardianRelation,
  type TransportInterest,
} from "@/lib/admissions";
import {
  beatProgress,
  bulkPushSurveyToRegistration,
  checkInSurveyAgent,
  checkOutSurveyAgent,
  compressSurveyPhoto,
  enqueueOfflineSurvey,
  ensureSurveyMasters,
  flushOfflineSurveyQueue,
  loadOfflineQueue,
  removeOfflineItem,
  setSurveyBeatActive,
  surveyAgentProductivity,
  upsertSurveyBeat,
  type SurveyOfflineDraft,
} from "@/lib/fieldSurvey";
import { SurveyAgentWaInbox } from "@/components/admissions/SurveyAgentWaInbox";
import { type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { SisParentMatchBanner } from "@/components/admissions/SisParentMatchBanner";
import { AdmissionSurveyTeamPanel } from "@/components/admissions/AdmissionSurveyTeamPanel";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

const COVERAGE = [
  {
    phase: "Shipped",
    items: [
      "Walk-in-style household + multi-child survey form",
      "Survey team: school staff + outside survey-only",
      "Team leader · assign/unassign gates agent app",
      "Start/Break/End with GPS + worked hours analytics",
      "Beat / cluster master · TL can edit from phone",
      "Photo / consent · Offline queue · Bulk → Registration",
    ],
  },
  {
    phase: "Later possibilities",
    items: [
      "WhatsApp follow-up templates from beat",
      "Competitor / school preference tags",
      "Route planner map view",
      "Printable survey sheet + QR sticker pack",
    ],
  },
] as const;

type ChildRow = {
  key: string;
  childName: string;
  dob: string;
  gender: string;
  classSoughtId: string;
  transportInterest: TransportInterest;
  previousSchool: string;
};

function emptyChildRow(): ChildRow {
  return {
    key: `c_${Math.random().toString(36).slice(2, 9)}`,
    childName: "",
    dob: "",
    gender: "",
    classSoughtId: "",
    transportInterest: "undecided",
    previousSchool: "",
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export function AdmissionFieldSurveyPanel({
  state: rawState,
  masters,
  by,
  canEdit,
  onCommit,
  onOpenCrm,
  onOpenRegistration,
}: {
  state: AdmissionsState;
  masters: MastersState;
  by: string;
  canEdit: boolean;
  onCommit: (next: AdmissionsState, msg?: string) => void;
  onOpenCrm: (leadId: string) => void;
  onOpenRegistration?: () => void;
}) {
  const state = useMemo(() => ensureSurveyMasters(rawState), [rawState]);
  const stats = useMemo(() => fieldSurveyStats(state), [state]);
  const leads = useMemo(() => listFieldSurveyLeads(state), [state]);
  const productivity = useMemo(() => surveyAgentProductivity(state), [state]);
  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );
  const feeHeads = useMemo(() => registrationFeeHeads(masters), [masters]);
  const activeBeats = useMemo(
    () => state.surveyBeats.filter((b) => b.isActive),
    [state.surveyBeats],
  );

  const [beatFilter, setBeatFilter] = useState<string>("all");
  const [beatId, setBeatId] = useState("");
  const [draft, setDraft] = useState(() =>
    emptyAdmissionLead({
      source: "field_survey",
      leadDate: todayYmd(),
    }),
  );
  const [extraGuardian, setExtraGuardian] = useState({
    fullName: "",
    relation: "uncle" as GuardianRelation,
    mobile: "",
  });
  const [childrenRows, setChildrenRows] = useState<ChildRow[]>([
    emptyChildRow(),
  ]);
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [parentConsent, setParentConsent] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<SurveyOfflineDraft[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [feeHeadId, setFeeHeadId] = useState("");
  const [feeAmount, setFeeAmount] = useState("500");

  const [beatName, setBeatName] = useState("");
  const [beatArea, setBeatArea] = useState("");
  const [beatTarget, setBeatTarget] = useState("50");
  const [editBeatId, setEditBeatId] = useState("");

  const surveyUrl = useMemo(
    () => publicEnquiryAbsoluteUrl("field_survey"),
    [],
  );
  const selectedBeat = activeBeats.find((b) => b.id === beatId);

  const existingHh = useMemo(() => {
    if (!draft.mobile || draft.mobile.length !== 10) return null;
    return findHouseholdByMobile(state, draft.mobile);
  }, [state, draft.mobile]);

  const existingSiblings = useMemo(() => {
    if (!existingHh) return [];
    return siblingsOfHousehold(state, existingHh.id);
  }, [state, existingHh]);

  useEffect(() => {
    if (!existingHh) return;
    const father =
      existingHh.guardians.find((g) => g.relation === "father") ||
      existingHh.guardians.find((g) => g.isPrimary);
    const mother = existingHh.guardians.find((g) => g.relation === "mother");
    setDraft((d) => ({
      ...d,
      guardianName: d.guardianName || father?.fullName || "",
      motherName: d.motherName || mother?.fullName || "",
      locality: d.locality || existingHh.locality,
      address: d.address || existingHh.address,
      city: d.city || existingHh.city,
      email: d.email || existingHh.email,
    }));
  }, [existingHh]);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(surveyUrl, {
      width: 160,
      margin: 1,
      color: { dark: "#203050", light: "#ffffff" },
    }).then((d) => {
      if (!cancelled) setQr(d);
    });
    return () => {
      cancelled = true;
    };
  }, [surveyUrl]);

  useEffect(() => {
    setOfflineQueue(loadOfflineQueue());
    const sync = () =>
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!beatId && activeBeats[0]) setBeatId(activeBeats[0].id);
  }, [activeBeats, beatId]);

  useEffect(() => {
    if (!selectedBeat) return;
    setDraft((d) => ({
      ...d,
      campaignNote: selectedBeat.name,
      locality: d.locality || selectedBeat.area || selectedBeat.name,
      surveyBeatId: selectedBeat.id,
    }));
  }, [selectedBeat]);

  useEffect(() => {
    if (!feeHeadId && feeHeads[0]) setFeeHeadId(feeHeads[0].id);
  }, [feeHeads, feeHeadId]);

  const filtered = useMemo(() => {
    if (beatFilter === "all") return leads;
    return leads.filter((l) => {
      if (l.surveyBeatId && l.surveyBeatId === beatFilter) return true;
      const b =
        (l.campaignNote || "").trim() ||
        (l.locality || "").trim() ||
        "Unassigned beat";
      return b === beatFilter;
    });
  }, [leads, beatFilter]);

  const openSelectedIds = useMemo(
    () =>
      filtered
        .filter((l) => l.stage === "enquiry" && selected[l.id])
        .map((l) => l.id),
    [filtered, selected],
  );

  function resetForm() {
    setDraft(
      emptyAdmissionLead({
        source: "field_survey",
        leadDate: todayYmd(),
        surveyBeatId: beatId,
        campaignNote: selectedBeat?.name || "",
        locality: selectedBeat?.area || selectedBeat?.name || "",
      }),
    );
    setExtraGuardian({ fullName: "", relation: "uncle", mobile: "" });
    setChildrenRows([emptyChildRow()]);
    setPhotoDataUrl("");
    setParentConsent(false);
  }

  function updateChildRow(key: string, patch: Partial<ChildRow>) {
    setChildrenRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  async function onPhotoPick(file: File | null) {
    if (!file) return;
    try {
      const url = await compressSurveyPhoto(file);
      setPhotoDataUrl(url);
    } catch {
      onCommit(state, "Could not read photo — try a smaller image");
    }
  }

  function submitSurvey() {
    if (!canEdit) return;
    if (!parentConsent) {
      onCommit(state, "Parent consent is required");
      return;
    }
    const beat = selectedBeat;
    if (!beat) {
      onCommit(state, "Select a beat from the master");
      return;
    }
    const filled = childrenRows.filter((c) => c.childName.trim());
    if (filled.length === 0) {
      onCommit(state, "Add at least one child name");
      return;
    }
    const first = filled[0]!;
    if (!first.classSoughtId) {
      onCommit(state, "Class sought is required for the first child");
      return;
    }

    const householdDraft = {
      ...draft,
      source: "field_survey" as const,
      leadDate: draft.leadDate || todayYmd(),
      campaignNote: beat.name,
      locality: draft.locality || beat.area || beat.name,
      surveyBeatId: beat.id,
      surveyPhotoDataUrl: photoDataUrl,
      declarationAccepted: true,
      parentConsentAt: new Date().toISOString(),
      parentConsentBy: by,
      assignedTo: by,
      nextFollowUpAt: todayYmd(),
    };

    if (!online) {
      let q = loadOfflineQueue();
      for (const child of filled) {
        q = enqueueOfflineSurvey({
          beatId: beat.id,
          beatName: beat.name,
          childName: child.childName,
          guardianName: draft.guardianName,
          motherName: draft.motherName,
          mobile: draft.mobile,
          classSoughtId: child.classSoughtId,
          surveyPhotoDataUrl: photoDataUrl,
          parentConsent: true,
          by,
        });
      }
      setOfflineQueue(q);
      onCommit(
        state,
        `Queued ${filled.length} child(ren) offline (${q.length} in queue)`,
      );
      resetForm();
      return;
    }

    const r = createEnquiry(
      state,
      {
        ...householdDraft,
        childName: first.childName,
        dob: first.dob,
        gender: first.gender,
        classSoughtId: first.classSoughtId,
        transportInterest: first.transportInterest,
        previousSchool: first.previousSchool,
      },
      by,
    );
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }

    let next = r.state;
    let msg = r.linkedExisting
      ? `Survey ${r.lead.enquiryNo} linked to household ${r.household.code}`
      : `Survey ${r.lead.enquiryNo} · new household ${r.household.code}`;
    let siblingOk = 0;
    let siblingFail = "";

    if (extraGuardian.fullName.trim()) {
      const g = addGuardian(next, r.household.id, {
        fullName: extraGuardian.fullName,
        relation: extraGuardian.relation,
        mobile: extraGuardian.mobile,
        isPrimary: false,
      });
      if (g.ok) {
        next = g.state;
        msg += " · extra guardian added";
      }
    }

    for (const child of filled.slice(1)) {
      if (!child.classSoughtId) {
        siblingFail = `${child.childName}: class required`;
        break;
      }
      const s = addSiblingEnquiry(
        next,
        r.household.id,
        {
          childName: child.childName,
          dob: child.dob,
          gender: child.gender,
          classSoughtId: child.classSoughtId,
          source: "field_survey",
          transportInterest: child.transportInterest,
          previousSchool: child.previousSchool,
          campaignNote: beat.name,
        },
        by,
      );
      if (!s.ok) {
        siblingFail = `${child.childName}: ${s.reason}`;
        break;
      }
      next = updateLead(s.state, s.lead.id, {
        surveyBeatId: beat.id,
        surveyPhotoDataUrl: photoDataUrl,
        declarationAccepted: true,
        parentConsentAt: householdDraft.parentConsentAt,
        parentConsentBy: by,
        assignedTo: by,
        nextFollowUpAt: todayYmd(),
        locality: householdDraft.locality,
      });
      siblingOk += 1;
    }

    if (siblingOk > 0) msg += ` · +${siblingOk} sibling enquiry(ies)`;
    if (siblingFail) msg += ` — ${siblingFail}`;
    msg += ` · ${beat.name}`;

    onCommit(next, msg);
    resetForm();
    onOpenCrm(r.lead.id);
  }

  function onFlushQueue() {
    if (!canEdit || !online) return;
    const r = flushOfflineSurveyQueue(state, by);
    setOfflineQueue(r.remaining);
    const failNote =
      r.failed.length > 0 ? ` · ${r.failed.length} failed` : "";
    onCommit(
      r.state,
      r.synced > 0
        ? `Synced ${r.synced} offline survey lead(s)${failNote}`
        : r.failed.length
          ? `Sync failed for ${r.failed.length} draft(s)`
          : "Offline queue empty",
    );
  }

  function onCheckIn() {
    if (!canEdit || !by.trim()) return;
    onCommit(
      checkInSurveyAgent(state, by, beatId),
      `${by} checked in${selectedBeat ? ` · ${selectedBeat.name}` : ""}`,
    );
  }

  function onCheckOut() {
    if (!canEdit || !by.trim()) return;
    onCommit(checkOutSurveyAgent(state, by), `${by} checked out`);
  }

  function onSaveBeat() {
    if (!canEdit || !beatName.trim()) return;
    const next = upsertSurveyBeat(state, {
      id: editBeatId || undefined,
      name: beatName.trim(),
      area: beatArea.trim(),
      targetHouseholds: Math.round(Number(beatTarget) || 0),
    });
    onCommit(
      next,
      editBeatId
        ? `Beat updated: ${beatName.trim()}`
        : `Beat added: ${beatName.trim()}`,
    );
    setBeatName("");
    setBeatArea("");
    setBeatTarget("50");
    setEditBeatId("");
  }

  function onBulkPush() {
    if (!canEdit || openSelectedIds.length === 0) return;
    if (!feeHeadId) {
      onCommit(state, "Select a registration fee head");
      return;
    }
    const rupees = Math.max(0, Math.round(Number(feeAmount) || 0));
    const head = feeHeads.find((h) => h.id === feeHeadId);
    const r = bulkPushSurveyToRegistration(state, openSelectedIds, {
      feeHeadId,
      feeHeadName: head?.name || "Registration fee",
      feeAmountPaise: rupees * 100,
    });
    setSelected({});
    onCommit(
      r.state,
      `Pushed ${r.pushed} to Registration${r.skipped.length ? ` · skipped ${r.skipped.length}` : ""}`,
    );
    onOpenRegistration?.();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(surveyUrl);
      onCommit(state, "Survey form link copied");
    } catch {
      /* ignore */
    }
  }

  const myAttendance = state.surveyAttendance.find(
    (a) =>
      a.date === todayYmd() &&
      a.agentName.toLowerCase() === by.trim().toLowerCase(),
  );

  const filledChildCount = childrenRows.filter((c) => c.childName.trim())
    .length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {(
          [
            ["Today", stats.today],
            ["Open", stats.open],
            ["Registered", stats.registered],
            ["Admitted", stats.admitted],
            ["Beats", stats.beats],
            ["Offline", offlineQueue.length],
          ] as const
        ).map(([label, n]) => (
          <span
            key={label}
            className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-white px-2.5 py-1.5 font-medium text-[var(--brand-deep)]"
          >
            {label} <span className="text-[var(--muted)]">{n}</span>
          </span>
        ))}
        <span
          className={`rounded-lg px-2.5 py-1.5 font-semibold ${
            online
              ? "bg-[rgba(22,101,52,0.12)] text-[#166534]"
              : "bg-[rgba(154,52,18,0.12)] text-[#9a3412]"
          }`}
        >
          {online ? "Online" : "Offline — queue captures"}
        </span>
      </div>

      <AdmissionSurveyTeamPanel
        state={state}
        masters={masters}
        canEdit={canEdit}
        onCommit={onCommit}
      />

      <SurveyAgentWaInbox by={by} canEdit={canEdit} />

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersWorkCard
          title="Survey capture link & QR"
          hint={`Parents / tablets → ${TENANT.publicPortal}/apply?src=field_survey → Lead CRM`}
        >
          <div className="flex flex-wrap gap-3">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="Field survey QR"
                className="h-[120px] w-[120px] rounded-lg border border-[rgba(32,48,80,0.1)]"
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-all font-mono text-[11px] text-[var(--brand-deep)]">
                {surveyUrl}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                  onClick={() => void copyLink()}
                >
                  Copy link
                </button>
                <a
                  href={surveyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
                >
                  Open form
                </a>
                {qr ? (
                  <a
                    href={qr}
                    download="bhb-field-survey-qr.png"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
                  >
                    Download QR
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </MastersWorkCard>

        <MastersWorkCard
          title="Agent attendance (today)"
          hint="Check in before beat · productivity uses check-in + captures"
        >
          {canEdit ? (
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#166534] px-3 py-1.5 text-[11px] font-semibold text-white"
                onClick={onCheckIn}
              >
                Check in{selectedBeat ? ` · ${selectedBeat.name}` : ""}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
                onClick={onCheckOut}
                disabled={
                  !myAttendance?.checkInAt || !!myAttendance?.checkOutAt
                }
              >
                Check out
              </button>
              {myAttendance?.checkInAt ? (
                <span className="self-center text-[11px] text-[var(--muted)]">
                  In{" "}
                  {new Date(myAttendance.checkInAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {myAttendance.checkOutAt
                    ? ` · Out ${new Date(myAttendance.checkOutAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : " · on field"}
                </span>
              ) : null}
            </div>
          ) : null}
          {productivity.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">
              No attendance or captures today yet.
            </p>
          ) : (
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] text-[var(--muted)]">
                <tr>
                  <th className="py-1 pr-2">Agent</th>
                  <th className="py-1 pr-2">Captures</th>
                  <th className="py-1 pr-2">Open</th>
                  <th className="py-1 pr-2">Reg</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {productivity.map((p) => (
                  <tr
                    key={p.agentName}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
                    <td className="py-1.5 pr-2 font-medium">{p.agentName}</td>
                    <td className="py-1.5 pr-2">{p.captures}</td>
                    <td className="py-1.5 pr-2">{p.open}</td>
                    <td className="py-1.5 pr-2">{p.registered}</td>
                    <td className="py-1.5">
                      {p.checkedIn ? (
                        <span className="text-[#166534]">On field</span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MastersWorkCard>
      </div>

      <MastersWorkCard
        title="Beat / cluster master"
        hint="Areas + household targets · progress from survey captures"
      >
        {canEdit ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <input
              className={inp}
              placeholder="Beat name *"
              value={beatName}
              onChange={(e) => setBeatName(e.target.value)}
            />
            <input
              className={inp}
              placeholder="Area / cluster"
              value={beatArea}
              onChange={(e) => setBeatArea(e.target.value)}
            />
            <input
              className={inp}
              type="number"
              min={0}
              placeholder="Target HH"
              value={beatTarget}
              onChange={(e) => setBeatTarget(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white"
              onClick={onSaveBeat}
            >
              {editBeatId ? "Update beat" : "Add beat"}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBeatFilter("all")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              beatFilter === "all"
                ? "bg-[var(--brand-deep)] text-white"
                : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
            }`}
          >
            All
          </button>
          {state.surveyBeats.map((b) => {
            const prog = beatProgress(state, b.id);
            return (
              <div key={b.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setBeatFilter(b.id);
                    setBeatId(b.id);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    beatFilter === b.id
                      ? "bg-[#9a3412] text-white"
                      : b.isActive
                        ? "bg-[rgba(180,83,9,0.12)] text-[#9a3412]"
                        : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)] line-through"
                  }`}
                  title={`${b.area || "—"} · ${prog.captured}/${prog.target} (${prog.pct}%)`}
                >
                  {b.code} {b.name} · {prog.captured}/{prog.target || "—"}
                </button>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="text-[10px] text-[var(--muted)] underline"
                      onClick={() => {
                        setEditBeatId(b.id);
                        setBeatName(b.name);
                        setBeatArea(b.area);
                        setBeatTarget(String(b.targetHouseholds));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-[var(--muted)] underline"
                      onClick={() =>
                        onCommit(
                          setSurveyBeatActive(state, b.id, !b.isActive),
                          b.isActive
                            ? `Deactivated ${b.name}`
                            : `Activated ${b.name}`,
                        )
                      }
                    >
                      {b.isActive ? "Off" : "On"}
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </MastersWorkCard>

      <p className="text-[12px] text-[var(--muted)]">
        Desk form below matches <strong>walk-in enquiry</strong> (household +
        children), with source locked to Field survey, beat, photo &amp;
        consent. After save, work leads in Lead details (CRM).
      </p>

      {!canEdit ? (
        <p className="text-sm text-[var(--muted)]">
          Your role can view surveys but not create captures.
        </p>
      ) : (
        <>
          <MastersWorkCard
            title="1 · Field survey household / parents"
            hint="Primary mobile identifies the family. Matching an existing number links children as siblings."
          >
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <span className="rounded-full bg-[rgba(154,52,18,0.14)] px-2.5 py-1 text-[11px] font-semibold text-[#9a3412]">
                Source: Field survey
              </span>
              <Field label="Lead / enquiry date *">
                <input
                  type="date"
                  className={inp}
                  value={draft.leadDate || todayYmd()}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, leadDate: e.target.value }))
                  }
                />
              </Field>
              <Field label="Beat *">
                <select
                  className={inp}
                  value={beatId}
                  onChange={(e) => setBeatId(e.target.value)}
                >
                  <option value="">Select beat…</option>
                  {activeBeats.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                      {b.area ? ` (${b.area})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {existingHh ? (
                <div className="sm:col-span-2 rounded-lg border border-[rgba(197,160,40,0.55)] bg-[rgba(197,160,40,0.14)] px-3 py-2.5 text-[12px] text-[var(--brand-deep)]">
                  <strong>Existing household {existingHh.code}</strong>
                  <div className="mt-1 text-[var(--muted)]">
                    Already has {existingSiblings.length} child enquiry(ies):{" "}
                    {existingSiblings.map((s) => s.childName).join(", ") || "—"}
                    . Parents will be reused.
                  </div>
                </div>
              ) : (
                <div className="sm:col-span-2 rounded-lg border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-3 py-2 text-[11px] text-[var(--muted)]">
                  New household will be created (code AHH-####) when you save.
                </div>
              )}
              <div className="sm:col-span-2">
                <SisParentMatchBanner
                  guardianName={draft.guardianName}
                  motherName={draft.motherName}
                  mobile={draft.mobile}
                />
              </div>
              <Field label="Primary mobile * (family key)">
                <input
                  className={inp}
                  inputMode="numeric"
                  maxLength={10}
                  value={draft.mobile}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      mobile: e.target.value.replace(/\D/g, "").slice(0, 10),
                    }))
                  }
                  placeholder="10-digit mobile"
                />
              </Field>
              <Field label="Campaign / beat note">
                <input
                  className={inp}
                  value={draft.campaignNote}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      campaignNote: e.target.value,
                    }))
                  }
                  placeholder="Filled from beat · editable"
                />
              </Field>
              <Field label="Father / primary guardian *">
                <input
                  className={inp}
                  value={draft.guardianName}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      guardianName: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Mother name">
                <input
                  className={inp}
                  value={draft.motherName}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      motherName: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Locality / area">
                <input
                  className={inp}
                  value={draft.locality}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, locality: e.target.value }))
                  }
                />
              </Field>
              <Field label="Address">
                <input
                  className={inp}
                  value={draft.address}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, address: e.target.value }))
                  }
                />
              </Field>
              <Field label="Door / child photo (optional)">
                <input
                  className={inp}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void onPhotoPick(e.target.files?.[0] || null)}
                />
                {photoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoDataUrl}
                    alt="Survey photo"
                    className="mt-2 h-20 w-20 rounded-lg object-cover"
                  />
                ) : null}
              </Field>
              <div className="flex items-end">
                <label className="flex items-start gap-2 text-[12px] text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={parentConsent}
                    onChange={(e) => setParentConsent(e.target.checked)}
                  />
                  <span>
                    Parent / guardian consents to store contact details for
                    admission follow-up (required).
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
                Optional — another guardian on this household
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name">
                  <input
                    className={inp}
                    value={extraGuardian.fullName}
                    onChange={(e) =>
                      setExtraGuardian((g) => ({
                        ...g,
                        fullName: e.target.value,
                      }))
                    }
                    placeholder="e.g. uncle / aunt"
                  />
                </Field>
                <Field label="Relation">
                  <select
                    className={inp}
                    value={extraGuardian.relation}
                    onChange={(e) =>
                      setExtraGuardian((g) => ({
                        ...g,
                        relation: e.target.value as GuardianRelation,
                      }))
                    }
                  >
                    {GUARDIAN_RELATIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Mobile">
                  <input
                    className={inp}
                    inputMode="numeric"
                    maxLength={10}
                    value={extraGuardian.mobile}
                    onChange={(e) =>
                      setExtraGuardian((g) => ({
                        ...g,
                        mobile: e.target.value.replace(/\D/g, "").slice(0, 10),
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
          </MastersWorkCard>

          <MastersWorkCard
            title={`2 · Children (${childrenRows.length})`}
            hint="Same as walk-in — add as many children as needed. Each gets their own survey enquiry under this household."
          >
            <div className="space-y-4">
              {childrenRows.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
                      Child {idx + 1}
                      {idx === 0 ? (
                        <span className="ml-1 font-normal text-[var(--muted)]">
                          (primary)
                        </span>
                      ) : (
                        <span className="ml-1 font-normal text-[var(--muted)]">
                          (sibling)
                        </span>
                      )}
                    </p>
                    {childrenRows.length > 1 ? (
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[#b42318]"
                        onClick={() =>
                          setChildrenRows((rows) =>
                            rows.filter((r) => r.key !== row.key),
                          )
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Child name *">
                      <input
                        className={inp}
                        value={row.childName}
                        onChange={(e) =>
                          updateChildRow(row.key, {
                            childName: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Date of birth">
                      <input
                        type="date"
                        className={inp}
                        value={row.dob}
                        onChange={(e) =>
                          updateChildRow(row.key, { dob: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Gender">
                      <select
                        className={inp}
                        value={row.gender}
                        onChange={(e) =>
                          updateChildRow(row.key, {
                            gender: e.target.value,
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="M">Male</option>
                        <option value="F">Female</option>
                        <option value="O">Other</option>
                      </select>
                    </Field>
                    <Field label="Class sought *">
                      <select
                        className={inp}
                        value={row.classSoughtId}
                        onChange={(e) =>
                          updateChildRow(row.key, {
                            classSoughtId: e.target.value,
                          })
                        }
                      >
                        <option value="">Select class…</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Transport interest">
                      <select
                        className={inp}
                        value={row.transportInterest}
                        onChange={(e) =>
                          updateChildRow(row.key, {
                            transportInterest: e.target
                              .value as TransportInterest,
                          })
                        }
                      >
                        <option value="undecided">Undecided</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </Field>
                    <Field label="Previous school">
                      <input
                        className={inp}
                        value={row.previousSchool}
                        onChange={(e) =>
                          updateChildRow(row.key, {
                            previousSchool: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="rounded-lg border border-dashed border-[rgba(32,48,80,0.35)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--brand-deep)] hover:border-[rgba(197,160,40,0.55)]"
                onClick={() =>
                  setChildrenRows((rows) => [...rows, emptyChildRow()])
                }
              >
                + Add another child
              </button>
            </div>
          </MastersWorkCard>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[#9a3412] px-4 py-2.5 text-sm font-semibold text-white"
              onClick={submitSurvey}
            >
              {!online
                ? `Queue ${filledChildCount || 1} offline`
                : filledChildCount > 1
                  ? `Save household + ${filledChildCount} children → CRM`
                  : existingHh
                    ? "Save as sibling survey → CRM"
                    : "Save survey enquiry + household → CRM"}
            </button>
          </div>
        </>
      )}

      {offlineQueue.length > 0 ? (
        <MastersWorkCard
          title={`Offline queue (${offlineQueue.length})`}
          hint="Stored on this device · flush when connection returns"
        >
          <ul className="mb-3 space-y-1 text-[12px]">
            {offlineQueue.map((q) => (
              <li
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5"
              >
                <span>
                  <span className="font-medium">{q.childName}</span>
                  {" · "}
                  {q.beatName || "—"} · {q.mobile}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className="text-[10px] text-[#9a3412] underline"
                    onClick={() => setOfflineQueue(removeOfflineItem(q.id))}
                  >
                    Discard
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button
              type="button"
              disabled={!online}
              className="rounded-lg bg-[#166534] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
              onClick={onFlushQueue}
            >
              Sync queue → CRM
            </button>
          ) : null}
        </MastersWorkCard>
      ) : null}

      <MastersTableCard title="Survey leads → CRM">
        {canEdit && filtered.some((l) => l.stage === "enquiry") ? (
          <div className="mb-3 flex flex-wrap items-end gap-2 border-b border-[rgba(32,48,80,0.08)] pb-3">
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Fee head
              <select
                className={`${inp} mt-1 min-w-[160px]`}
                value={feeHeadId}
                onChange={(e) => setFeeHeadId(e.target.value)}
              >
                {feeHeads.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Amount (₹)
              <input
                className={`${inp} mt-1 w-28`}
                type="number"
                min={0}
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={openSelectedIds.length === 0}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
              onClick={onBulkPush}
            >
              Push {openSelectedIds.length || ""} to Registration
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
              onClick={() => {
                const next: Record<string, boolean> = {};
                filtered
                  .filter((l) => l.stage === "enquiry")
                  .forEach((l) => {
                    next[l.id] = true;
                  });
                setSelected(next);
              }}
            >
              Select all Open
            </button>
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No field survey leads in this beat yet.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="text-[11px] text-[var(--muted)]">
              <tr>
                {canEdit ? <th className="px-2 py-2"> </th> : null}
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Beat</th>
                <th className="px-3 py-2">Child / parent</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const beatLabel =
                  state.surveyBeats.find((b) => b.id === l.surveyBeatId)
                    ?.name ||
                  (l.campaignNote || "").trim() ||
                  (l.locality || "").trim() ||
                  "—";
                return (
                  <tr
                    key={l.id}
                    className="border-t border-[rgba(32,48,80,0.06)] hover:bg-[rgba(32,48,80,0.03)]"
                  >
                    {canEdit ? (
                      <td className="px-2 py-2">
                        {l.stage === "enquiry" ? (
                          <input
                            type="checkbox"
                            checked={!!selected[l.id]}
                            onChange={(e) =>
                              setSelected((s) => ({
                                ...s,
                                [l.id]: e.target.checked,
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td
                      className="cursor-pointer px-3 py-2 font-mono text-[12px]"
                      onClick={() => onOpenCrm(l.id)}
                    >
                      {l.enquiryNo}
                    </td>
                    <td className="px-3 py-2 text-[12px]">{beatLabel}</td>
                    <td
                      className="cursor-pointer px-3 py-2 text-[12px]"
                      onClick={() => onOpenCrm(l.id)}
                    >
                      <span className="font-medium text-[var(--brand-deep)]">
                        {l.childName}
                      </span>
                      <div className="text-[10px] text-[var(--muted)]">
                        {l.guardianName} · {l.mobile}
                        {l.parentConsentAt ? " · consent ✓" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTagClass(l.stage)}`}
                      >
                        {stageLabel(l.stage)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {l.assignedTo || l.createdBy || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {l.surveyPhotoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.surveyPhotoDataUrl}
                          alt=""
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-[var(--muted)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {(l.leadDate || "").slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </MastersTableCard>

      <MastersWorkCard
        title="What this tab covers — roadmap"
        hint="Field survey scope (shipped vs later)"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {COVERAGE.map((block) => (
            <div
              key={block.phase}
              className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                {block.phase}
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--muted)]">
                {block.items.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </MastersWorkCard>
    </div>
  );
}
