"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import {
  ADMISSION_SOURCES,
  ADMISSION_STAGES,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  GUARDIAN_RELATIONS,
  addGuardian,
  addSiblingEnquiry,
  assignCounsellor,
  captureYear,
  createEnquiry,
  emptyAdmissionLead,
  enrollLead,
  findHouseholdByMobile,
  followUpBucketClass,
  followUpChannelLabel,
  followUpCounts,
  followUpOutcomeLabel,
  funnelCounts,
  householdOf,
  isConvertedShowOnly,
  convertedLeadRowClass,
  isLeadCaller,
  leadFollowUpBucket,
  loadAdmissions,
  logFollowUp,
  mergeLeadsSameMobile,
  applyWhatsAppNamesToLeads,
  markLost,
  markVerified,
  promoteToRegistration,
  publicRegisterAbsoluteUrl,
  relationLabel,
  saveAdmissions,
  setLeadCallerAssigned,
  siblingsOfHousehold,
  sourceCounts,
  sourceLabel,
  sourceTagClass,
  stageLabel,
  stageTagClass,
  todayYmd,
  updateLead,
  type AdmissionKind,
  type AdmissionLead,
  type AdmissionSource,
  type AdmissionStage,
  type AdmissionsState,
  type FollowUpChannel,
  type FollowUpOutcome,
  type GuardianRelation,
  type TransportInterest,
} from "@/lib/admissions";
import { listSessionYearOptions, loadMasters, type MastersState } from "@/lib/masters";
import { admissionDocumentHref, buildAdmissionDocumentDetails } from "@/lib/admissionDocumentLinks";
import { leadConversionLikelihood } from "@/lib/admissionsAi";
import { pushToast } from "@/components/shell/Toast";
import { STUDENT_CATEGORIES, loadSis, type SisState } from "@/lib/sis";
import {
  closeSuspectedLeadNotMatch,
  keepSuspectedLeadOpen,
  reconcileLeadsWithSis,
  verifySuspectedLeadWithSis,
} from "@/lib/admissionsSisReconcile";
import { canAccessModule, hasPermission, loadRbac } from "@/lib/rbac";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { AddressAutocompleteField } from "@/components/maps/AddressAutocompleteField";
import { lazyNamedTabPanel } from "@/components/ui/lazyTabPanel";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { AdmissionCaptureLinks } from "@/components/admissions/AdmissionCaptureLinks";
import { SisParentMatchBanner } from "@/components/admissions/SisParentMatchBanner";
import {
  AdmissionSisMatchLists,
  LeadSisMatchDetailCard,
} from "@/components/admissions/AdmissionSisMatchLists";
import { StudentProfileModal } from "@/components/students/StudentProfileModal";
import { LeadMobileWaCheckPanel } from "@/components/admissions/LeadMobileWaCheckPanel";
import { AdmissionDocOcrPanel } from "@/components/admissions/AdmissionDocOcrPanel";
import { openWaMe } from "@/lib/waMe";

import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { AdmissionFieldSurveyPanel } from "@/components/admissions/AdmissionFieldSurveyPanel";
import { AdmissionImportPanel } from "@/components/admissions/AdmissionImportPanel";
import { AdmissionRegistrationPanel } from "@/components/admissions/AdmissionRegistrationPanel";
import { RteWorkspace } from "@/components/rte/RteWorkspace";
import { AdmissionCampaignsPanel } from "@/components/admissions/AdmissionCampaignsPanel";
import { AdmissionCrmChatInbox } from "@/components/admissions/AdmissionCrmChatInbox";
import { AdmissionsKbPanel } from "@/components/admissions/AdmissionsKbPanel";
import { LeadFollowupDraftPanel } from "@/components/admissions/LeadFollowupDraftPanel";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import { LEAD_CONCERNS, PREVIOUS_BOARDS } from "@/lib/admissionsEnquiryForm";
import { AdmissionReportsPanel } from "@/components/admissions/AdmissionReportsPanel";

type AdmTab =
  | "dashboard"
  | "enquiry"
  | "survey"
  | "leads"
  | "import"
  | "registration"
  | "rte"
  | "campaigns"
  | "crm_chat"
  | "kb"
  | "reports";

export function AdmissionsWorkspace() {
  const session = useDemoSession();
  const sessionReadOnly = useSessionReadOnly();
  const [masters, setMasters] = useState<MastersState | null>(() =>
    typeof window !== "undefined" ? loadMasters() : null,
  );
  const [state, setState] = useState<AdmissionsState | null>(() =>
    typeof window !== "undefined" ? loadAdmissions() : null,
  );
  const [sis, setSis] = useState<SisState>(() => loadSis());
  const [sisMatchPanel, setSisMatchPanel] = useState<
    "" | "admitted" | "suspected"
  >("");
  const [profileStudentId, setProfileStudentId] = useState("");
  const [showLeadFilters, setShowLeadFilters] = useState(false);
  const [showWaCheck, setShowWaCheck] = useState(false);
  const [tab, setTab] = useState<AdmTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: AdmTab[] = [
      "dashboard",
      "enquiry",
      "survey",
      "leads",
      "import",
      "registration",
      "rte",
      "campaigns",
      "crm_chat",
      "kb",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as AdmTab);
  }, []);

  // Deep link from global search — open a specific lead by id.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openLeadId = new URLSearchParams(window.location.search).get(
      "openLead",
    );
    if (openLeadId) openLead(openLeadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [captureYearFilter, setCaptureYearFilter] = useState<string>("all");
  const [filter, setFilter] = useState<
    | AdmissionStage
    | AdmissionSource
    | "open"
    | "all"
    | "due_today"
    | "overdue"
    | "unassigned"
    | "mine"
  >("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leadDateFrom, setLeadDateFrom] = useState("");
  const [leadDateTo, setLeadDateTo] = useState("");
  const [localityQ, setLocalityQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(() =>
    emptyAdmissionLead({ source: "walk_in", leadDate: todayYmd() }),
  );
  const [extraGuardian, setExtraGuardian] = useState({
    fullName: "",
    relation: "uncle" as GuardianRelation,
    mobile: "",
  });
  const [childrenRows, setChildrenRows] = useState<
    {
      key: string;
      childName: string;
      dob: string;
      gender: string;
      classSoughtId: string;
      transportInterest: TransportInterest;
      previousSchool: string;
    }[]
  >([
    {
      key: "c1",
      childName: "",
      dob: "",
      gender: "",
      classSoughtId: "",
      transportInterest: "undecided",
      previousSchool: "",
    },
  ]);

  useEffect(() => {
    setMasters(loadMasters());
    const adm = loadAdmissions();
    setState(adm);
    const sisNow = loadSis();
    setSis(sisNow);

    // Always check open leads against the student register (all sessions)
    if (sisNow.students.length && adm.leads.length) {
      const rec = reconcileLeadsWithSis(adm, sisNow);
      if (rec.admitted.length || rec.suspected.length || rec.yearFixed > 0) {
        saveAdmissions(rec.state);
        setState(rec.state);
        const bits: string[] = [];
        if (rec.admitted.length) {
          bits.push(`${rec.admitted.length} marked Admitted`);
        }
        if (rec.suspected.length) {
          bits.push(`${rec.suspected.length} suspected in SIS`);
        }
        if (rec.yearFixed > 0) {
          bits.push(`${rec.yearFixed} admission year(s) corrected`);
        }
        if (bits.length) {
          setNotice(`SIS check: ${bits.join(" · ")}.`);
          window.setTimeout(() => setNotice(null), 5000);
        }
      }
    }

    let cancelled = false;
    void (async () => {
      try {
        const [{ ensureAdmissionsHydrated }, { withHydrationSlot }] =
          await Promise.all([
            import("@/lib/admissionsPersistence"),
            import("@/lib/deskHydrateGuard"),
          ]);
        const pulled = await withHydrationSlot(() => ensureAdmissionsHydrated());
        if (cancelled) return;
        const next = loadAdmissions();
        setState(next);
        if (pulled && next.leads.length > 0) {
          setNotice(`Synced ${next.leads.length} lead(s) from Supabase.`);
          window.setTimeout(() => setNotice(null), 6000);
        }
      } catch (e) {
        console.warn("[admissions] hydrate error", e);
        if (!cancelled) {
          const { reportLoadFailure } = await import("@/components/shell/Toast");
          reportLoadFailure("admissions data");
        }
      }
    })();

    const refresh = () => setState(loadAdmissions());
    const onHydrated = () => refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("bhb-admissions-hydrated", onHydrated);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bhb-admissions-hydrated", onHydrated);
    };
  }, []);

  const allowed = useMemo(() => {
    if (!masters) return false;
    return canAccessModule(session, masters, "admissions", loadRbac());
  }, [masters, session]);

  const canCreate = useMemo(() => {
    if (sessionReadOnly) return false;
    if (!masters) return false;
    return (
      hasPermission(session, masters, "admissions", "create") ||
      hasPermission(session, masters, "admissions", "edit")
    );
  }, [masters, session, sessionReadOnly]);

  const isAdmissionsManager = useMemo(() => {
    const code = (session.roleCode || "").toLowerCase();
    return ["owner", "principal", "admin", "office", "accounts"].some((c) =>
      code.includes(c),
    );
  }, [session.roleCode]);

  const callerOnly = useMemo(() => {
    if (!state || isAdmissionsManager) return false;
    return isLeadCaller(state, session.staffId);
  }, [state, isAdmissionsManager, session.staffId]);

  const canBrowseLeadLists = useMemo(() => {
    if (isAdmissionsManager) return true;
    if (!state) return false;
    return isLeadCaller(state, session.staffId);
  }, [state, isAdmissionsManager, session.staffId]);

  useEffect(() => {
    if (callerOnly && filter !== "mine") setFilter("mine");
  }, [callerOnly, filter]);

  useEffect(() => {
    if (
      !canBrowseLeadLists &&
      (tab === "leads" ||
        tab === "registration" ||
        tab === "rte" ||
        tab === "import" ||
        tab === "campaigns" ||
        tab === "crm_chat" ||
        tab === "kb" ||
        tab === "reports")
    ) {
      setTab("enquiry");
    }
  }, [canBrowseLeadLists, tab]);

  const counts = useMemo(
    () => (state ? funnelCounts(state) : null),
    [state],
  );

  const selected = useMemo(() => {
    const lead = state?.leads.find((l) => l.id === selectedId) ?? null;
    if (lead && isConvertedShowOnly(lead.stage)) return null;
    return lead;
  }, [state, selectedId]);

  const classes = useMemo(
    () => (masters?.classes ?? []).filter((c) => c.isActive),
    [masters],
  );

  const filtered = useMemo(() => {
    if (!state) return [];
    if (!canBrowseLeadLists) return [];
    const me = (session?.fullName || "").trim().toLowerCase();
    const list = state.leads.filter((l) => {
      const assigned = (l.assignedTo || "").trim().toLowerCase();
      if (callerOnly) {
        return (
          l.stage !== "enrolled" &&
          l.stage !== "lost" &&
          assigned === me
        );
      }
      if (
        captureYearFilter !== "all" &&
        (l.academicYearCode || "") !== captureYearFilter
      ) {
        return false;
      }
      const leadDate = String(l.leadDate || l.createdAt || "").slice(0, 10);
      if (leadDateFrom && leadDate && leadDate < leadDateFrom) return false;
      if (leadDateTo && leadDate && leadDate > leadDateTo) return false;
      if (
        localityQ.trim() &&
        !(l.locality || "").toLowerCase().includes(localityQ.trim().toLowerCase())
      ) {
        return false;
      }
      if (filter === "all") return true;
      if (filter === "open") {
        return l.stage !== "enrolled" && l.stage !== "lost";
      }
      if (filter === "due_today") {
        return leadFollowUpBucket(l) === "due_today";
      }
      if (filter === "overdue") {
        return leadFollowUpBucket(l) === "overdue";
      }
      if (filter === "unassigned") {
        return (
          l.stage !== "enrolled" &&
          l.stage !== "lost" &&
          !assigned
        );
      }
      if (filter === "mine") {
        return (
          l.stage !== "enrolled" &&
          l.stage !== "lost" &&
          assigned === me
        );
      }
      if (
        filter === "enquiry" ||
        filter === "applied" ||
        filter === "verified" ||
        filter === "enrolled" ||
        filter === "lost"
      ) {
        return l.stage === filter;
      }
      return l.source === filter;
    });
    return [...list].sort((a, b) => {
      const dateA = String(a.leadDate || a.createdAt || "");
      const dateB = String(b.leadDate || b.createdAt || "");
      const dateCmp = dateB.localeCompare(dateA);
      if (dateCmp !== 0) return dateCmp;
      const ba = leadFollowUpBucket(a);
      const bb = leadFollowUpBucket(b);
      const rank = (x: typeof ba) =>
        x === "overdue" ? 0 : x === "due_today" ? 1 : x === "scheduled" ? 2 : 3;
      return rank(ba) - rank(bb);
    });
  }, [
    state,
    filter,
    session.fullName,
    captureYearFilter,
    canBrowseLeadLists,
    callerOnly,
    leadDateFrom,
    leadDateTo,
    localityQ,
  ]);

  // Admission-year chips (derived from enquiry dates via the Oct→Sep rule)
  const captureYears = useMemo(() => {
    if (!state) return [] as string[];
    const set = new Set<string>();
    for (const l of state.leads) {
      if (l.academicYearCode) set.add(l.academicYearCode);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [state]);

  const sessionYears = useMemo(
    () => listSessionYearOptions(masters),
    [masters],
  );

  const bySource = useMemo(
    () => (state ? sourceCounts(state) : null),
    [state],
  );

  const fuCounts = useMemo(
    () => (state ? followUpCounts(state) : null),
    [state],
  );

  function commit(next: AdmissionsState, msg?: string) {
    setState(next);
    saveAdmissions(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2800);
    }
  }

  function runSisReconcile() {
    const cur = loadAdmissions();
    const r = reconcileLeadsWithSis(cur, loadSis());
    if (r.admitted.length === 0 && r.suspected.length === 0) {
      commit(
        r.state,
        `Checked ${r.checked} open lead(s) against SIS (incl. inactive students) — no matches found.${r.yearFixed ? ` ${r.yearFixed} admission year(s) corrected.` : ""}`,
      );
      return;
    }
    const parts: string[] = [];
    if (r.admitted.length) {
      parts.push(`${r.admitted.length} lead(s) marked Admitted (found in student register)`);
    }
    if (r.suspected.length) {
      parts.push(`${r.suspected.length} suspected in SIS (family / same name)`);
    }
    if (r.yearFixed > 0) {
      parts.push(`${r.yearFixed} admission year(s) corrected from enquiry date`);
    }
    commit(r.state, `SIS check: ${parts.join(" · ")} — of ${r.checked} open leads.`);
  }

  function doVerifySuspectedWithSis(leadId: string) {
    const cur = loadAdmissions();
    const sisNow = loadSis();
    setSis(sisNow);
    const r = verifySuspectedLeadWithSis(cur, leadId, sisNow);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(
      r.state,
      `Verified with SIS: lead updated from ${r.student.fullName} (Adm ${r.student.admissionNo || "—"}) — marked Admitted.`,
    );
    setSelectedId(null);
    setSisMatchPanel("admitted");
  }

  function doKeepSuspectedOpen(leadId: string) {
    const cur = loadAdmissions();
    const r = keepSuspectedLeadOpen(cur, leadId);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(r.state, "SIS suspect cleared — lead kept open for counsellor work.");
    if (selectedId === leadId) setSelectedId(leadId);
  }

  function doCloseSuspectedNotMatch(leadId: string) {
    const cur = loadAdmissions();
    const r = closeSuspectedLeadNotMatch(cur, leadId);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(r.state, "Lead closed — not matching this SIS student.");
    if (selectedId === leadId) setSelectedId(null);
  }

  function doRegisterLead(leadId: string) {
    const cur = loadAdmissions();
    const r = promoteToRegistration(cur, leadId);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(r.state, "Moved to Registered");
    openLead(leadId);
  }

  function doVerifyDocsLead(leadId: string) {
    const cur = loadAdmissions();
    const r = markVerified(cur, leadId);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(r.state, "Documents verified");
    openLead(leadId);
  }

  function doAdmitLead(leadId: string) {
    if (!masters) return;
    const cur = loadAdmissions();
    const r = enrollLead(cur, leadId, session.fullName, masters);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(
      r.state,
      `Sent to Students · Adm ${r.admissionNo} · ${r.srn} · ${r.admissionDate}`,
    );
    if (selectedId === leadId) setSelectedId(null);
  }

  function doAssignMeLead(leadId: string) {
    const cur = loadAdmissions();
    commit(
      assignCounsellor(cur, leadId, session.fullName),
      `Assigned to ${session.fullName}`,
    );
  }

  function doMarkLostLead(leadId: string) {
    const reason =
      typeof window !== "undefined"
        ? window.prompt("Lost reason?", "Withdrawn") || ""
        : "Withdrawn";
    if (!reason.trim()) return;
    const cur = loadAdmissions();
    commit(markLost(cur, leadId, reason), "Marked lost");
    if (selectedId === leadId) setSelectedId(null);
  }

  function doMergeSameMobile(leadIds: string[]) {
    const cur = loadAdmissions();
    const r = mergeLeadsSameMobile(cur, leadIds);
    if (!r.ok) {
      setNotice(r.reason);
      window.setTimeout(() => setNotice(null), 3500);
      return;
    }
    commit(
      r.state,
      `Merged ${r.mergedCount + 1} leads → ${r.keeper.enquiryNo}: ${r.childNames.join(", ")}`,
    );
    setSelectedId(r.keeper.id);
    setFilter("all");
    setLeadDateFrom("");
    setLeadDateTo("");
    setLocalityQ("");
    setShowWaCheck(true);
  }

  function doApplyWhatsAppNames(
    updates: { mobile: string; displayName: string; waId?: string }[],
  ) {
    const cur = loadAdmissions();
    const r = applyWhatsAppNamesToLeads(cur, updates, {
      alsoUpdateGuardianName: true,
    });
    commit(
      r.state,
      r.updated
        ? `Updated ${r.updated} lead(s) with WhatsApp names for campaigns ({{guardianName}}).`
        : "No lead names needed updating — already matched.",
    );
  }

  const tagListActions = useMemo(
    () => ({
      onOpenLead: (id: string) => {
        const lead = loadAdmissions().leads.find((l) => l.id === id);
        if (
          lead &&
          (lead.stage === "enrolled" || lead.sisMatch === "admitted")
        ) {
          const sid = lead.sisStudentId || lead.studentId;
          if (sid) {
            setProfileStudentId(sid);
            return;
          }
        }
        openLead(id);
      },
      onOpenStudent: (id: string) => setProfileStudentId(id),
      onRegister: doRegisterLead,
      onVerifyDocs: doVerifyDocsLead,
      onAdmitToSis: doAdmitLead,
      onAssignMe: doAssignMeLead,
      onMarkLost: doMarkLostLead,
      onVerifyWithSis: doVerifySuspectedWithSis,
      onKeepOpen: doKeepSuspectedOpen,
      onCloseNotMatch: doCloseSuspectedNotMatch,
      agentName: session.fullName,
      canEdit: canCreate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over latest state via load*
    [session.fullName, canCreate, masters, selectedId],
  );

  function openLead(id: string) {
    const lead = state?.leads.find((l) => l.id === id);
    if (lead && isConvertedShowOnly(lead.stage)) {
      setSelectedId(null);
      setTab("leads");
      setNotice(
        "Admitted leads are display-only (green) — not for further working",
      );
      window.setTimeout(() => setNotice(null), 2800);
      return;
    }
    // Clear list filters so the lead being opened isn't hidden by a stale
    // date-range/locality/stage filter left active from a previous view.
    setFilter("all");
    setCaptureYearFilter("all");
    setLeadDateFrom("");
    setLeadDateTo("");
    setLocalityQ("");
    setSelectedId(id);
    setTab("leads");
  }

  function doRegister() {
    if (!state || !selected) return;
    const r = promoteToRegistration(state, selected.id);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, "Moved to Registered");
  }

  function doVerify() {
    if (!state || !selected) return;
    const r = markVerified(state, selected.id);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, "Documents verified");
  }

  function doEnroll() {
    if (!state || !selected || !masters) return;
    const r = enrollLead(state, selected.id, session.fullName, masters);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(
      r.state,
      `Sent to Students · Adm ${r.admissionNo} · ${r.srn} · ${r.admissionDate}`,
    );
    setSelectedId(null);
  }

  function doAddSibling(child: {
    childName: string;
    dob: string;
    gender: string;
    classSoughtId: string;
  }) {
    if (!state || !selected?.householdId) return;
    const r = addSiblingEnquiry(
      state,
      selected.householdId,
      child,
      session.fullName,
    );
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, `Sibling enquiry ${r.lead.enquiryNo} added`);
    openLead(r.lead.id);
  }

  function doAddGuardian(g: {
    fullName: string;
    relation: GuardianRelation;
    mobile: string;
    isPrimary: boolean;
  }) {
    if (!state || !selected?.householdId) return;
    const r = addGuardian(state, selected.householdId, g);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, "Guardian added to household");
  }

  function patchSelected(patch: Partial<AdmissionLead>) {
    if (!state || !selected) return;
    commit(updateLead(state, selected.id, patch));
  }

  function doLost() {
    if (!state || !selected) return;
    const reason = window.prompt("Reason for withdrawal / lost lead?", "") || "";
    commit(markLost(state, selected.id, reason), "Marked lost");
  }

  function doAssign(name: string) {
    if (!state || !selected) return;
    commit(
      assignCounsellor(state, selected.id, name),
      name.trim() ? `Assigned to ${name.trim()}` : "Unassigned",
    );
  }

  function doLogFollowUp(input: {
    channel: FollowUpChannel;
    outcome: FollowUpOutcome;
    note: string;
    nextFollowUpAt: string;
    assignToSelf?: boolean;
  }) {
    if (!state || !selected) return;
    const r = logFollowUp(state, selected.id, input, session.fullName);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, "Follow-up logged");
  }

  const existingHh = useMemo(() => {
    if (!state || draft.mobile.length !== 10) return null;
    return findHouseholdByMobile(state, draft.mobile) || null;
  }, [state, draft.mobile]);

  const existingSiblings = useMemo(() => {
    if (!state || !existingHh) return [];
    return siblingsOfHousehold(state, existingHh.id);
  }, [state, existingHh]);

  // Prefill parents from matched household when mobile hits an existing family
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

  function emptyChildRow() {
    return {
      key: `c_${Math.random().toString(36).slice(2, 9)}`,
      childName: "",
      dob: "",
      gender: "",
      classSoughtId: "",
      transportInterest: "undecided" as TransportInterest,
      previousSchool: "",
    };
  }

  function updateChildRow(
    key: string,
    patch: Partial<(typeof childrenRows)[number]>,
  ) {
    setChildrenRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function submitEnquiry() {
    if (!state || !canCreate) return;
    const filled = childrenRows.filter((c) => c.childName.trim());
    if (filled.length === 0) {
      setNotice("Add at least one child name");
      return;
    }
    const first = filled[0]!;
    if (!first.classSoughtId) {
      setNotice("Class sought is required for the first child");
      return;
    }

    const r = createEnquiry(
      state,
      {
        ...draft,
        source: "walk_in",
        leadDate: draft.leadDate || todayYmd(),
        childName: first.childName,
        dob: first.dob,
        gender: first.gender,
        classSoughtId: first.classSoughtId,
        transportInterest: first.transportInterest,
        previousSchool: first.previousSchool,
      },
      session.fullName,
    );
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    let next = r.state;
    let msg = r.linkedExisting
      ? `Enquiry ${r.lead.enquiryNo} linked to household ${r.household.code}`
      : `Enquiry ${r.lead.enquiryNo} · new household ${r.household.code}`;
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
          source: "walk_in",
          transportInterest: child.transportInterest,
          previousSchool: child.previousSchool,
        },
        session.fullName,
      );
      if (!s.ok) {
        siblingFail = `${child.childName}: ${s.reason}`;
        break;
      }
      next = s.state;
      siblingOk += 1;
    }

    if (siblingOk > 0) msg += ` · +${siblingOk} sibling enquiry(ies)`;
    if (siblingFail) msg += ` — ${siblingFail}`;

    commit(next, msg);
    setDraft(emptyAdmissionLead({ source: "walk_in", leadDate: todayYmd() }));
    setExtraGuardian({ fullName: "", relation: "uncle", mobile: "" });
    setChildrenRows([emptyChildRow()]);
    openLead(r.lead.id);
  }

  if (!state || !masters) {
    return <p className="text-sm text-[var(--muted)]">Loading admissions…</p>;
  }

  if (!allowed) {
    return (
      <p className="rounded-xl border border-[rgba(180,35,24,0.25)] bg-[rgba(180,35,24,0.06)] px-4 py-3 text-sm text-[var(--brand-deep)]">
        Admissions CRM is restricted by your role. Ask Principal / Admin for
        access.
      </p>
    );
  }

  const sectionsFor = (classId: string) =>
    (masters.sections ?? []).filter(
      (s) => s.classId === classId && s.isActive,
    );

  return (
    <ErpWorkspaceShell
      title="Admissions"
      subtitle="Walk-in desk · QR / form links for digital sources · CRM by capture year"
      icon={<UserPlus className="size-6" aria-hidden />}
      notice={notice}
      actions={
        counts ? (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {fuCounts ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFilter("overdue");
                    setTab("leads");
                  }}
                  className="rounded-lg border border-[rgba(180,35,24,0.3)] bg-[rgba(180,35,24,0.06)] px-2.5 py-1.5 font-medium text-[#b42318]"
                >
                  Overdue{" "}
                  <span className="opacity-80">{fuCounts.overdue}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilter("due_today");
                    setTab("leads");
                  }}
                  className="rounded-lg border border-[rgba(180,83,9,0.35)] bg-[rgba(180,83,9,0.08)] px-2.5 py-1.5 font-medium text-[#9a3412]"
                >
                  Due today{" "}
                  <span className="opacity-80">{fuCounts.dueToday}</span>
                </button>
              </>
            ) : null}
            {(
              [
                ["enquiry", counts.enquiry],
                ["applied", counts.applied],
                ["verified", counts.verified],
                ["enrolled", counts.enrolled],
              ] as const
            ).map(([k, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setFilter(k);
                  setTab("leads");
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 font-medium text-[var(--brand-deep)]"
              >
                {stageLabel(k)}{" "}
                <span className="text-[var(--muted)]">{n}</span>
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <ModuleTabs
        aria-label="Admissions"
        value={tab}
        onChange={(id) => {
          const next = id as AdmTab;
          if (
            !canBrowseLeadLists &&
            (next === "leads" ||
              next === "registration" ||
              next === "rte" ||
              next === "import" ||
              next === "campaigns" ||
              next === "crm_chat" ||
              next === "kb" ||
              next === "reports")
          ) {
            setNotice(
              "Lead / registration lists stay hidden until you are assigned for lead calling",
            );
            window.setTimeout(() => setNotice(null), 3200);
            return;
          }
          setTab(next);
        }}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "enquiry", label: "Walk-in enquiry", tone: "teal" },
          { id: "survey", label: "Field survey", tone: "coral" },
          ...(canBrowseLeadLists
            ? ([
                { id: "leads", label: "Lead details (CRM)", tone: "navy" },
                { id: "import", label: "Upload leads", tone: "amber" },
                { id: "registration", label: "Registration", tone: "green" },
                { id: "rte", label: "RTE / EWS", tone: "sky" },
                { id: "campaigns", label: "WA campaigns", tone: "teal" },
                { id: "crm_chat", label: "CRM parent chat", tone: "navy" },
                { id: "kb", label: "Knowledge base", tone: "sky" },
                { id: "reports", label: "Report", tone: "green" },
              ] as const)
            : []),
        ]}
      />

      {!canBrowseLeadLists ? (
        <p className="rounded-lg border border-[rgba(154,52,18,0.25)] bg-[rgba(154,52,18,0.08)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">
          CRM / registration lists are hidden for your login until office
          assigns you under <strong>Field survey → Lead callers</strong>. Use
          Walk-in, Field survey, or{" "}
          <Link href="/field" className="font-semibold underline">
            Field app
          </Link>{" "}
          to capture leads &amp; collect UPI without browsing lists.
        </p>
      ) : null}

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="admissions"
          onNavigateTab={(t) => setTab(t as AdmTab)}
        />
      ) : null}

      {tab === "survey" ? (
        <AdmissionFieldSurveyPanel
          state={state}
          masters={masters}
          by={session.fullName}
          canEdit={canCreate}
          onCommit={commit}
          onOpenCrm={(id) => openLead(id)}
          onOpenRegistration={() => setTab("registration")}
        />
      ) : null}

      {tab === "leads" ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLeadFilters((v) => !v)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                    showLeadFilters
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  Filters {showLeadFilters ? "▴" : "▾"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowWaCheck((v) => !v)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                    showWaCheck
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  Mobile / WhatsApp check {showWaCheck ? "▴" : "▾"}
                </button>
                {/* Active filter summary while collapsed */}
                {filter !== "open" ? (
                  <span className="rounded-full bg-[rgba(197,160,40,0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                    {filter === "all"
                      ? "All statuses"
                      : (ADMISSION_STAGES.find((s) => s.value === filter)
                          ?.label ??
                        ADMISSION_SOURCES.find((s) => s.value === filter)
                          ?.label ??
                        filter)}
                  </span>
                ) : null}
                {captureYearFilter !== "all" ? (
                  <span className="rounded-full bg-[rgba(197,160,40,0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                    AY {captureYearFilter}
                  </span>
                ) : null}
                {leadDateFrom || leadDateTo ? (
                  <span className="rounded-full bg-[rgba(197,160,40,0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                    {leadDateFrom || "…"}–{leadDateTo || "…"}
                  </span>
                ) : null}
                {localityQ.trim() ? (
                  <span className="rounded-full bg-[rgba(197,160,40,0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                    Locality “{localityQ.trim()}”
                  </span>
                ) : null}
                {filter !== "open" ||
                captureYearFilter !== "all" ||
                leadDateFrom ||
                leadDateTo ||
                localityQ.trim() ? (
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-[#b42318] underline"
                    onClick={() => {
                      setFilter("open");
                      setCaptureYearFilter("all");
                      setLeadDateFrom("");
                      setLeadDateTo("");
                      setLocalityQ("");
                    }}
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              {canCreate ? (
                <button
                  type="button"
                  onClick={runSisReconcile}
                  className="rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110"
                  title="Match open leads against the student register (all sessions) and mark admitted"
                >
                  Check admitted in SIS
                </button>
              ) : null}
            </div>

            {showLeadFilters ? (
              <div className="space-y-2 border-t border-[var(--border)] pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Admission year
                  </span>
                  <button
                    type="button"
                    onClick={() => setCaptureYearFilter("all")}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      captureYearFilter === "all"
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                    }`}
                  >
                    All years
                  </button>
                  {captureYears.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setCaptureYearFilter(y)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        captureYearFilter === y
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Lead date
                  </span>
                  <input
                    type="date"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                    value={leadDateFrom}
                    onChange={(e) => setLeadDateFrom(e.target.value)}
                    aria-label="Lead date from"
                  />
                  <span className="text-[11px] text-[var(--muted)]">–</span>
                  <input
                    type="date"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                    value={leadDateTo}
                    onChange={(e) => setLeadDateTo(e.target.value)}
                    aria-label="Lead date to"
                  />
                  <input
                    className="min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                    placeholder="Locality…"
                    value={localityQ}
                    onChange={(e) => setLocalityQ(e.target.value)}
                    aria-label="Filter by locality"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Counsellor queue
                  </span>
                  {(
                    [
                      ["due_today", "Due today", fuCounts?.dueToday],
                      ["overdue", "Overdue", fuCounts?.overdue],
                      ["mine", "My leads", null],
                      ["unassigned", "Unassigned", fuCounts?.unassigned],
                    ] as const
                  ).map(([id, label, n]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        filter === id
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : id === "overdue"
                            ? "bg-[rgba(180,35,24,0.12)] text-[#b42318]"
                            : id === "due_today"
                              ? "bg-[rgba(180,83,9,0.14)] text-[#9a3412]"
                              : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                      }`}
                    >
                      {label}
                      {typeof n === "number" ? (
                        <span className="ml-1 opacity-80">{n}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Status tags
                  </span>
                  {(
                    [
                      ["open", "Open"],
                      ["all", "All"],
                      ...ADMISSION_STAGES.map(
                        (s) => [s.value, s.label] as const,
                      ),
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id as typeof filter)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        filter === id
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : id === "open" || id === "all"
                            ? "bg-[var(--surface-sunken)] text-[var(--muted)]"
                            : stageTagClass(id as AdmissionStage)
                      }`}
                    >
                      {label}
                      {counts &&
                      id !== "open" &&
                      id !== "all" &&
                      id in counts ? (
                        <span className="ml-1 opacity-80">
                          {counts[id as AdmissionStage]}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Source tags
                  </span>
                  {ADMISSION_SOURCES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setFilter(s.value)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        filter === s.value
                          ? "bg-[#1e40af] text-white"
                          : sourceTagClass(s.value)
                      }`}
                    >
                      {s.label}
                      {bySource ? (
                        <span className="ml-1 opacity-80">
                          {bySource[s.value]}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {showWaCheck && state ? (
              <LeadMobileWaCheckPanel
                leads={state.leads}
                actions={tagListActions}
                canEdit={canCreate}
                onMergeSameMobile={doMergeSameMobile}
                onApplyWhatsAppNames={doApplyWhatsAppNames}
              />
            ) : null}

            {state ? (
              <AdmissionSisMatchLists
                leads={state.leads}
                sis={sis}
                masters={masters}
                openPanel={sisMatchPanel}
                onTogglePanel={setSisMatchPanel}
                actions={tagListActions}
              />
            ) : null}
          </div>

          <MastersTableCard title="Leads">
            {filtered.length === 0 ? (
              <MastersEmptyRow label="No leads in this view — use New enquiry to capture." />
            ) : (
              <ErpTable minWidth="min-w-full">
                <ErpTableHead>
                  <tr>
                    <th className="px-4 py-2.5 font-bold">Lead no.</th>
                    <th className="px-4 py-2.5 font-bold">Lead date</th>
                    <th className="px-4 py-2.5 font-bold">Adm. year</th>
                    <th className="px-4 py-2.5 font-bold">Status</th>
                    <th className="px-4 py-2.5 font-bold">Source</th>
                    <th className="px-4 py-2.5 font-bold">Child</th>
                    <th className="px-4 py-2.5 font-bold">Guardian / mobile</th>
                    <th className="px-4 py-2.5 font-bold">Counsellor</th>
                    <th className="px-4 py-2.5 font-bold">Next follow-up</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {filtered.map((l) => {
                    const hh = householdOf(state, l.householdId);
                    const showOnly = isConvertedShowOnly(l.stage);
                    const active =
                      selectedId === l.id && !showOnly;
                    const bucket = leadFollowUpBucket(l);
                    const rowGreen = convertedLeadRowClass(l.stage);
                    const greened =
                      l.stage === "applied" ||
                      l.stage === "verified" ||
                      l.stage === "enrolled";
                    return (
                      <tr
                        key={l.id}
                        title={
                          showOnly
                            ? "Admitted — display only (not for working)"
                            : greened
                              ? "Registered / Verified — open only to Verify or Admit"
                              : "Open to work this lead"
                        }
                        className={`border-t border-[var(--border)] ${
                          showOnly
                            ? `${rowGreen} cursor-default`
                            : greened
                              ? `${rowGreen} cursor-pointer hover:brightness-95`
                              : `cursor-pointer ${
                                  active
                                    ? "bg-[rgba(197,160,40,0.12)]"
                                    : "hover:bg-[var(--surface-sunken)]"
                                }`
                        }`}
                        onClick={() => {
                          if (!showOnly) openLead(l.id);
                        }}
                      >
                        <td className="px-3 py-2 font-mono text-[12px]">
                          {l.enquiryNo}
                          {hh ? (
                            <div className="text-[10px] opacity-70">
                              {hh.code}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[12px]">
                          {(l.leadDate || l.createdAt || "").slice(0, 10) || "—"}
                        </td>
                        <td className="px-3 py-2 text-[12px] font-medium">
                          {l.academicYearCode || "—"}
                          <div className="text-[10px] opacity-70">
                            Enq {captureYear(l)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTagClass(l.stage)}`}
                          >
                            {stageLabel(l.stage)}
                          </span>
                          {l.sisMatch === "admitted" ? (
                            <button
                              type="button"
                              title={l.sisStudentInfo || "Open admitted SIS list"}
                              className={`mt-0.5 ml-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                l.sisStudentStatus === "inactive"
                                  ? "bg-[rgba(71,85,105,0.15)] text-[#334155]"
                                  : "bg-[rgba(21,128,61,0.15)] text-[#166534]"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSisMatchPanel("admitted");
                              }}
                            >
                              SIS:{" "}
                              {l.sisStudentStatus === "inactive"
                                ? "Inactive"
                                : "Active"}
                            </button>
                          ) : l.sisMatch === "suspected" ? (
                            <button
                              type="button"
                              title={l.sisStudentInfo || "Open suspected SIS list"}
                              className="mt-0.5 ml-1 inline-block rounded-full bg-[rgba(180,83,9,0.14)] px-2 py-0.5 text-[10px] font-semibold text-[#9a3412]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSisMatchPanel("suspected");
                                openLead(l.id);
                              }}
                            >
                              Suspected in SIS ·{" "}
                              {l.sisStudentStatus === "inactive"
                                ? "Inactive"
                                : "Active"}
                            </button>
                          ) : null}
                          {showOnly ? (
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide opacity-70">
                              Display only
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${sourceTagClass(l.source)}`}
                          >
                            {sourceLabel(l.source)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {l.sisMatch === "admitted" &&
                          (l.sisStudentId || l.studentId) ? (
                            <button
                              type="button"
                              className="text-left font-medium text-[#0f766e] underline-offset-2 hover:underline"
                              title="Open SIS student details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProfileStudentId(
                                  l.sisStudentId || l.studentId,
                                );
                              }}
                            >
                              {l.childName}
                            </button>
                          ) : l.sisMatch === "suspected" && l.sisStudentId ? (
                            <button
                              type="button"
                              className="text-left font-medium text-[#9a3412] underline-offset-2 hover:underline"
                              title="Open suspected SIS student"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProfileStudentId(l.sisStudentId);
                              }}
                            >
                              {l.childName}
                            </button>
                          ) : (
                            l.childName
                          )}
                        </td>
                        <td className="px-3 py-2 text-[12px]">
                          {l.guardianName}
                          <div className="text-[10px] opacity-70">{l.mobile}</div>
                        </td>
                        <td className="px-3 py-2 text-[12px]">
                          {l.assignedTo || <span className="opacity-60">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {showOnly || greened ? (
                            <span className="text-[11px] opacity-60">—</span>
                          ) : bucket === "none" ? (
                            <span className="text-[11px] text-[var(--muted)]">
                              Not set
                            </span>
                          ) : (
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${followUpBucketClass(bucket)}`}
                            >
                              {bucket === "overdue"
                                ? "Overdue"
                                : bucket === "due_today"
                                  ? "Due today"
                                  : "Scheduled"}{" "}
                              {(l.nextFollowUpAt || "").slice(0, 10)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable>
            )}
          </MastersTableCard>

          {!selected ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-6 text-center text-sm text-[var(--muted)]">
              Select an <strong>Open</strong> lead for counsellor work, or a
              green <strong>Registered / Verified</strong> lead to Verify /
              Admit. <strong>Admitted</strong> rows are display-only. Fee
              collection lives under the <strong>Registration</strong> tab.
            </p>
          ) : (
            <LeadDetail
              lead={selected}
              state={state}
              masters={masters}
              sis={sis}
              classes={classes}
              sectionsFor={sectionsFor}
              canEdit={canCreate}
              agentName={session.fullName}
              onPatch={patchSelected}
              onRegister={doRegister}
              onVerify={doVerify}
              onEnroll={doEnroll}
              onLost={doLost}
              onOpenLead={openLead}
              onOpenStudent={(id) => setProfileStudentId(id)}
              tagActions={tagListActions}
              onAddSibling={doAddSibling}
              onAddGuardian={doAddGuardian}
              onAssign={doAssign}
              onLogFollowUp={doLogFollowUp}
            />
          )}
        </div>
      ) : null}

      {tab === "registration" ? (
        <AdmissionRegistrationPanel
          state={state}
          masters={masters}
          by={session.fullName}
          canEdit={canCreate}
          onCommit={commit}
          onOpenCrmLead={(id) => openLead(id)}
        />
      ) : null}

      {tab === "rte" ? <RteWorkspace embedded /> : null}

      {tab === "campaigns" ? (
        <AdmissionCampaignsPanel
          admissions={state}
          masters={masters}
          by={session.fullName}
          canEdit={canCreate}
          onAdmissionsCommit={commit}
        />
      ) : null}

      {tab === "crm_chat" ? (
        <AdmissionCrmChatInbox by={session.fullName} canEdit={canCreate} />
      ) : null}

      {tab === "kb" ? (
        <AdmissionsKbPanel masters={masters} canEdit={canCreate} by={session.fullName} />
      ) : null}

      {tab === "reports" ? (
        <AdmissionReportsPanel
          tick={(state?.leads.length || 0) + (state?.surveySessions?.length || 0)}
          onNotice={(msg) => {
            setNotice(msg);
            window.setTimeout(() => setNotice(null), 4000);
          }}
        />
      ) : null}

      {tab === "enquiry" ? (
        <div className="space-y-4">
          <MastersWorkCard
            title="Digital capture — QR & form links"
            hint="Website · Google · Social · Field survey. Parents fill the public form; lead lands in CRM with ENQ lead number."
          >
            <AdmissionCaptureLinks />
          </MastersWorkCard>

          <p className="text-[12px] text-[var(--muted)]">
            Desk form below is for <strong>walk-in</strong> only. After save,
            work the lead in{" "}
            <button
              type="button"
              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
              onClick={() => setTab("leads")}
            >
              Lead details (CRM)
            </button>
            . Older leads:{" "}
            <button
              type="button"
              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
              onClick={() => setTab("import")}
            >
              Upload leads
            </button>
            .
          </p>

          {!canCreate ? (
            <p className="text-sm text-[var(--muted)]">
              Your role can view admissions but not create enquiries.
            </p>
          ) : (
            <>
              <MastersWorkCard
                title="1 · Walk-in household / parents"
                hint="Primary mobile identifies the family. Matching an existing number links this child as a sibling."
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[rgba(15,118,110,0.14)] px-2.5 py-1 text-[11px] font-semibold text-[#0f766e]">
                    Source: Walk-in
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
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {existingHh ? (
                    <div className="sm:col-span-2 rounded-lg border border-[rgba(197,160,40,0.55)] bg-[rgba(197,160,40,0.14)] px-3 py-2.5 text-[12px] text-[var(--brand-deep)]">
                      <strong>Existing household {existingHh.code}</strong>
                      <div className="mt-1 text-[var(--muted)]">
                        Already has {existingSiblings.length} child
                        enquiry(ies):{" "}
                        {existingSiblings.map((s) => s.childName).join(", ") ||
                          "—"}
                        . Parents will be reused.
                      </div>
                    </div>
                  ) : (
                    <div className="sm:col-span-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--muted)]">
                      New household will be created (code AHH-####) when you
                      save.
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
                          mobile: e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 10),
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
                      placeholder="e.g. Murdaha beat · Google form · WhatsApp"
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
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3">
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
                            mobile: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 10),
                          }))
                        }
                      />
                    </Field>
                  </div>
                </div>
              </MastersWorkCard>

              <MastersWorkCard
                title={`2 · Children (${childrenRows.length})`}
                hint="Add as many children as needed. Each gets their own enquiry under this household."
              >
                <div className="space-y-4">
                  {childrenRows.map((row, idx) => (
                    <div
                      key={row.key}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3"
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
                    className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[12px] font-semibold text-[var(--brand-deep)] hover:border-[rgba(197,160,40,0.55)]"
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
                  className="rounded-lg bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-semibold text-white"
                  onClick={submitEnquiry}
                >
                  {childrenRows.filter((c) => c.childName.trim()).length > 1
                    ? `Save household + ${childrenRows.filter((c) => c.childName.trim()).length} children`
                    : existingHh
                      ? "Save as sibling enquiry"
                      : "Save enquiry + household"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === "import" ? (
        <MastersWorkCard
          title="Upload older leads"
          hint="CSV import with default source / status / session tags. Leads stay available in every session via capture year filter."
        >
          {!canCreate ? (
            <p className="text-sm text-[var(--muted)]">
              Your role cannot import leads.
            </p>
          ) : (
            <AdmissionImportPanel
              state={state}
              academicYears={sessionYears}
              classes={classes}
              by={session.fullName}
              onImported={(next, msg) => {
                commit(next, msg);
                setTab("leads");
                setFilter("all");
                setCaptureYearFilter("all");
                setLeadDateFrom("");
                setLeadDateTo("");
                setLocalityQ("");
              }}
            />
          )}
        </MastersWorkCard>
      ) : null}

      {profileStudentId
        ? (() => {
            const ps = sis.students.find((s) => s.id === profileStudentId);
            if (!ps || !masters) return null;
            const cls =
              masters.classes.find((c) => c.id === ps.classId)?.name || "—";
            const sec =
              masters.sections.find((s) => s.id === ps.sectionId)?.name || "";
            const feeGroupLabel =
              masters.feeGroups?.find((g) => g.id === ps.feeGroupId)?.name ||
              "—";
            return (
              <StudentProfileModal
                student={ps}
                sis={sis}
                masters={masters}
                classLabel={sec ? `${cls} · ${sec}` : cls}
                feeGroupLabel={feeGroupLabel}
                onClose={() => setProfileStudentId("")}
                onOpenStudent={(id) => setProfileStudentId(id)}
              />
            );
          })()
        : null}
    </ErpWorkspaceShell>
  );
}

const inp =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm";

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

function LeadDetail({
  lead,
  state,
  masters,
  sis,
  classes,
  sectionsFor,
  canEdit,
  agentName,
  onPatch,
  onRegister,
  onVerify,
  onEnroll,
  onLost,
  onOpenLead,
  onOpenStudent,
  tagActions,
  onAddSibling,
  onAddGuardian,
  onAssign,
  onLogFollowUp,
}: {
  lead: AdmissionLead;
  state: AdmissionsState;
  masters: MastersState | null;
  sis: SisState;
  classes: { id: string; name: string }[];
  sectionsFor: (classId: string) => { id: string; name: string }[];
  canEdit: boolean;
  agentName: string;
  onPatch: (p: Partial<AdmissionLead>) => void;
  onRegister: () => void;
  onVerify: () => void;
  onEnroll: () => void;
  onLost: () => void;
  onOpenLead: (id: string) => void;
  onOpenStudent: (studentId: string) => void;
  tagActions: import("@/components/admissions/LeadTagListActions").LeadTagListActionHandlers;
  onAddSibling: (child: {
    childName: string;
    dob: string;
    gender: string;
    classSoughtId: string;
  }) => void;
  onAddGuardian: (g: {
    fullName: string;
    relation: GuardianRelation;
    mobile: string;
    isPrimary: boolean;
  }) => void;
  onAssign: (name: string) => void;
  onLogFollowUp: (input: {
    channel: FollowUpChannel;
    outcome: FollowUpOutcome;
    note: string;
    nextFollowUpAt: string;
    assignToSelf?: boolean;
  }) => void;
}) {
  const classId = lead.classAdmittedId || lead.classSoughtId;
  const sections = sectionsFor(classId);
  const locked = lead.stage === "enrolled" || lead.stage === "lost";
  const hh = householdOf(state, lead.householdId);
  const siblings = siblingsOfHousehold(state, lead.householdId, lead.id);
  const bucket = leadFollowUpBucket(lead);
  const likelihood = leadConversionLikelihood(lead);

  const [aiSuggestion, setAiSuggestion] = useState<
    { nextAction: string; outreachMessage: string; generationId?: string } | null
  >(null);
  function acceptSuggestion() {
    if (aiSuggestion?.generationId) {
      reportAiOutcome({ ids: [aiSuggestion.generationId], outcome: "accepted", targetType: "admission_lead", targetId: lead.id });
      setAiSuggestion({ ...aiSuggestion, generationId: undefined });
    }
  }
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiSuggestionError, setAiSuggestionError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setAiSuggestion(null);
    setAiSuggestionError(null);
  }, [lead.id]);

  async function suggestNextAction() {
    setAiSuggestionLoading(true);
    setAiSuggestionError(null);
    setAiSuggestion(null);
    try {
      const days = lead.leadDate
        ? Math.max(
            0,
            Math.round(
              (Date.now() - new Date(`${lead.leadDate}T00:00:00`).getTime()) /
                86_400_000,
            ),
          )
        : 0;
      const followUpSummary = lead.followUps
        .slice(-3)
        .map(
          (f) =>
            `${followUpChannelLabel(f.channel)}: ${followUpOutcomeLabel(f.outcome)}${f.note ? ` (${f.note})` : ""}`,
        )
        .join("; ");
      const res = await fetch("/api/ai/lead-next-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childName: lead.childName,
          classSoughtLabel:
            classes.find((c) => c.id === classId)?.name || "",
          stageLabel: stageLabel(lead.stage),
          sourceLabel: sourceLabel(lead.source),
          daysSinceEnquiry: days,
          followUpSummary,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        nextAction?: string;
        outreachMessage?: string;
      };
      if (!json.ok || !json.nextAction || !json.outreachMessage) {
        setAiSuggestionError(json.error || "Suggestion failed");
        return;
      }
      setAiSuggestion({
        nextAction: json.nextAction,
        outreachMessage: json.outreachMessage,
        generationId: (json as { generationId?: string }).generationId,
      });
    } catch (e) {
      setAiSuggestionError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setAiSuggestionLoading(false);
    }
  }

  const [sibName, setSibName] = useState("");
  const [sibDob, setSibDob] = useState("");
  const [sibGender, setSibGender] = useState("");
  const [sibClass, setSibClass] = useState("");
  const [gName, setGName] = useState("");
  const [gRelation, setGRelation] = useState<GuardianRelation>("mother");
  const [gMobile, setGMobile] = useState("");
  const [gPrimary, setGPrimary] = useState(false);
  const [fuChannel, setFuChannel] = useState<FollowUpChannel>("call");
  const [fuOutcome, setFuOutcome] = useState<FollowUpOutcome>("connected");
  const [fuNote, setFuNote] = useState("");
  const [fuNext, setFuNext] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return todayYmd(d);
  });
  const [assignDraft, setAssignDraft] = useState(lead.assignedTo);

  useEffect(() => {
    setAssignDraft(lead.assignedTo);
  }, [lead.id, lead.assignedTo]);

  function submitFollowUp() {
    onLogFollowUp({
      channel: fuChannel,
      outcome: fuOutcome,
      note: fuNote,
      nextFollowUpAt: fuNext,
      assignToSelf: !lead.assignedTo.trim(),
    });
    setFuNote("");
    const d = new Date();
    d.setDate(d.getDate() + 2);
    setFuNext(todayYmd(d));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {lead.childName}
              </h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${stageTagClass(lead.stage)}`}
              >
                {stageLabel(lead.stage)}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sourceTagClass(lead.source)}`}
              >
                {sourceLabel(lead.source)}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                  likelihood.tone === "good"
                    ? "bg-[rgba(21,128,61,0.1)] text-[#15803d]"
                    : likelihood.tone === "warn"
                      ? "bg-[rgba(180,131,0,0.12)] text-[#8a6400]"
                      : "bg-[rgba(180,35,24,0.1)] text-[var(--danger)]"
                }`}
                title="Heuristic estimate from stage, payment, follow-up outcomes, and document completeness — not a guarantee"
              >
                {likelihood.label} · {likelihood.score}%
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
              {lead.enquiryNo}
              {lead.applicationNo ? ` · ${lead.applicationNo}` : ""}
              {lead.admissionNo ? ` · Adm ${lead.admissionNo}` : ""}
              {hh ? ` · ${hh.code}` : ""}
            </p>
          </div>
          {canEdit && !locked ? (
            <div className="flex flex-wrap gap-2">
              {lead.stage === "enquiry" ? (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                  onClick={onRegister}
                >
                  → Register
                </button>
              ) : null}
              {lead.stage === "applied" ? (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                  onClick={onVerify}
                >
                  → Verify docs
                </button>
              ) : null}
              {lead.stage === "verified" || lead.stage === "applied" ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-[11px] font-semibold text-white"
                  onClick={onEnroll}
                >
                  → Admit to SIS
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-[rgba(180,35,24,0.35)] px-3 py-1.5 text-[11px] font-semibold text-[#b42318]"
                onClick={onLost}
              >
                Mark lost
              </button>
            </div>
          ) : null}
          {lead.stage === "enrolled" && lead.studentId ? (
            <button
              type="button"
              onClick={() => onOpenStudent(lead.studentId)}
              className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
            >
              Open student →
            </button>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2 lg:grid-cols-5 text-[11px]">
          <div>
            <div className="text-[var(--muted)]">Lead date / year</div>
            <div className="font-medium text-[var(--brand-deep)]">
              {(lead.leadDate || lead.createdAt || "").slice(0, 10) || "—"}
            </div>
            <div className="text-[var(--muted)]">
              Year {captureYear(lead)} · AY {lead.academicYearCode || "—"}
            </div>
          </div>
          <div>
            <div className="text-[var(--muted)]">Guardian</div>
            <div className="font-medium text-[var(--brand-deep)]">
              {lead.guardianName || "—"}
            </div>
            <div className="text-[var(--muted)]">{lead.mobile || "—"}</div>
          </div>
          <div>
            <div className="text-[var(--muted)]">Mother</div>
            <div className="font-medium text-[var(--brand-deep)]">
              {lead.motherName || "—"}
            </div>
          </div>
          <div>
            <div className="text-[var(--muted)]">Class / section</div>
            <div className="font-medium text-[var(--brand-deep)]">
              {classes.find((c) => c.id === (lead.classAdmittedId || lead.classSoughtId))
                ?.name || "—"}
              {lead.sectionId
                ? ` · ${sections.find((s) => s.id === lead.sectionId)?.name || ""}`
                : " · section pending"}
            </div>
          </div>
          <div>
            <div className="text-[var(--muted)]">Reg / admit dates</div>
            <div className="font-medium text-[var(--brand-deep)]">
              Reg {(lead.registrationDate || "—").slice(0, 10)}
            </div>
            <div className="text-[var(--muted)]">
              Admit {(lead.admissionDate || "—").slice(0, 10)}
            </div>
          </div>
        </div>

        {!locked ? (
          <div className="mt-3">
            <SisParentMatchBanner
              guardianName={lead.guardianName}
              motherName={lead.motherName}
              mobile={lead.mobile}
            />
          </div>
        ) : null}

        <LeadSisMatchDetailCard
          lead={lead}
          sis={sis}
          masters={masters}
          actions={tagActions}
        />

        {canEdit && !locked ? (
          <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
            <Field label="Lead / enquiry date">
              <input
                type="date"
                className={inp}
                value={(lead.leadDate || "").slice(0, 10)}
                onChange={(e) => onPatch({ leadDate: e.target.value })}
              />
            </Field>
            <Field label="Academic session (AY)">
              <input
                className={inp}
                value={lead.academicYearCode}
                onChange={(e) => onPatch({ academicYearCode: e.target.value })}
                placeholder="2025-26"
              />
            </Field>
          </div>
        ) : null}

        {canEdit && !locked ? (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase text-[var(--muted)]">
              Change source
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ADMISSION_SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => onPatch({ source: s.value })}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    lead.source === s.value
                      ? "bg-[#1e40af] text-white"
                      : sourceTagClass(s.value)
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <MastersWorkCard
        title="Counsellor / calling agent"
        hint="Assign ownership, log every call or WhatsApp attempt, and set the next follow-up date. Use Due today / Overdue filters in the list."
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Assigned counsellor">
            <input
              className={inp}
              disabled={!canEdit || locked}
              value={assignDraft}
              placeholder={agentName || "Agent name"}
              onChange={(e) => setAssignDraft(e.target.value)}
            />
          </Field>
          {canEdit && !locked ? (
            <>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                onClick={() => onAssign(assignDraft)}
              >
                Save assign
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)]"
                onClick={() => {
                  setAssignDraft(agentName);
                  onAssign(agentName);
                }}
              >
                Assign to me
              </button>
            </>
          ) : null}
          <div className="ml-auto text-[11px]">
            {bucket === "none" ? (
              <span className="text-[var(--muted)]">No next follow-up set</span>
            ) : (
              <span
                className={`rounded-full px-2.5 py-1 font-semibold ${followUpBucketClass(bucket)}`}
              >
                {bucket === "overdue"
                  ? "Overdue"
                  : bucket === "due_today"
                    ? "Due today"
                    : "Scheduled"}{" "}
                · {(lead.nextFollowUpAt || "").slice(0, 10)}
              </span>
            )}
          </div>
        </div>

        {canEdit && !locked ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
            <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
              Log follow-up attempt
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Channel">
                <select
                  className={inp}
                  value={fuChannel}
                  onChange={(e) =>
                    setFuChannel(e.target.value as FollowUpChannel)
                  }
                >
                  {FOLLOW_UP_CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Outcome">
                <select
                  className={inp}
                  value={fuOutcome}
                  onChange={(e) =>
                    setFuOutcome(e.target.value as FollowUpOutcome)
                  }
                >
                  {FOLLOW_UP_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Next follow-up date">
                <input
                  type="date"
                  className={inp}
                  value={fuNext}
                  onChange={(e) => setFuNext(e.target.value)}
                />
              </Field>
              <Field label="Notes from call">
                <input
                  className={inp}
                  value={fuNote}
                  placeholder="Parent said… / promised visit…"
                  onChange={(e) => setFuNote(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
                onClick={submitFollowUp}
              >
                Save follow-up
              </button>
              <a
                href={`tel:${lead.mobile}`}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)]"
              >
                Call {lead.mobile || "—"}
              </a>
              {lead.mobile ? (
                <button
                  type="button"
                  onClick={() =>
                    openWaMe(
                      lead.mobile,
                      `Hello ${lead.guardianName || "Parent"}, regarding admission enquiry for ${lead.childName || "your child"} at BHB International School.`,
                    )
                  }
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                >
                  WhatsApp Business
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {masters ? (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
              Documents · AI drafted on letterhead
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(
                [
                  ["admission_offer", "Offer letter"],
                  ["fee_structure_letter", "Fee structure"],
                  ["welcome_packet", "Welcome packet"],
                ] as const
              ).map(([type, label]) => (
                <Link
                  key={type}
                  href={admissionDocumentHref(
                    type,
                    buildAdmissionDocumentDetails({
                      type,
                      lead,
                      masters,
                      className: classes.find((c) => c.id === classId)?.name || "",
                    }),
                  )}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                >
                  {label} →
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {canEdit && !locked ? (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                AI suggestion
              </p>

              <button
                type="button"
                disabled={aiSuggestionLoading}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                onClick={() => void suggestNextAction()}
              >
                {aiSuggestionLoading
                  ? "Thinking…"
                  : aiSuggestion
                    ? "Re-suggest"
                    : "Suggest next action"}
              </button>
            </div>
            {aiSuggestionError ? (
              <p className="mt-1 text-[11px] text-[var(--danger)]">
                {aiSuggestionError}
              </p>
            ) : null}
            {aiSuggestion ? (
              <div className="mt-2 space-y-2">
                <div className="rounded-lg bg-[var(--surface)] p-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Next action
                  </span>
                  <p className="mt-1 text-[12px] font-medium text-[var(--brand-deep)]">
                    {aiSuggestion.nextAction}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--surface)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      Outreach message
                    </span>
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(aiSuggestion.outreachMessage)
                          .then(
                            () => {
                              acceptSuggestion();
                              pushToast({
                                kind: "success",
                                message: "Outreach message copied",
                              });
                            },
                            () =>
                              pushToast({
                                kind: "error",
                                message: "Could not copy",
                              }),
                          )
                      }
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                    {aiSuggestion.outreachMessage}
                  </p>
                  {lead.mobile ? (
                    <button
                      type="button"
                      onClick={() => {
                        acceptSuggestion();
                        openWaMe(lead.mobile, aiSuggestion.outreachMessage);
                      }}
                      className="mt-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                    >
                      Open in WhatsApp
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {canEdit && !locked ? (
          <LeadFollowupDraftPanel
            lead={lead}
            classLabel={classes.find((c) => c.id === classId)?.name || ""}
            counsellorName={agentName}
            registerUrl={publicRegisterAbsoluteUrl("counsellor")}
            canEdit={canEdit}
            onLogFollowUp={(input) => onLogFollowUp(input)}
            onFlash={(message) => pushToast({ kind: "success", message })}
            onError={(message) => pushToast({ kind: "error", message })}
          />
        ) : null}

        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase text-[var(--muted)]">
            Activity timeline
          </p>
          {(lead.followUps || []).length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">
              No follow-ups yet — calling agent should log the first contact.
            </p>
          ) : (
            <ul className="space-y-2">
              {lead.followUps.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[12px]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {followUpChannelLabel(f.channel)} ·{" "}
                      {followUpOutcomeLabel(f.outcome)}
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {f.at.slice(0, 16).replace("T", " ")}
                      {f.by ? ` · ${f.by}` : ""}
                    </span>
                  </div>
                  {f.note ? (
                    <p className="mt-0.5 text-[var(--brand-deep)]">{f.note}</p>
                  ) : null}
                  {f.nextFollowUpAt ? (
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      Next: {f.nextFollowUpAt.slice(0, 10)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </MastersWorkCard>

      {hh ? (
        <MastersWorkCard
          title={`Household ${hh.code}`}
          hint="One family card — many guardians, many child enquiries. Enroll shares one SIS household."
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[12px]">
              <div className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                Guardians
              </div>
              <ul className="mt-1 space-y-1">
                {hh.guardians.length === 0 ? (
                  <li className="text-[var(--muted)]">None yet</li>
                ) : (
                  hh.guardians.map((g) => (
                    <li key={g.id}>
                      <span className="font-medium text-[var(--brand-deep)]">
                        {g.fullName}
                      </span>{" "}
                      <span className="text-[var(--muted)]">
                        · {relationLabel(g.relation)}
                        {g.isPrimary ? " · primary" : ""}
                        {g.mobile ? ` · ${g.mobile}` : ""}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[12px]">
              <div className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                Children / enquiries
              </div>
              <ul className="mt-1 space-y-1">
                <li>
                  <button
                    type="button"
                    className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
                    onClick={() => onOpenLead(lead.id)}
                  >
                    {lead.childName}
                  </button>{" "}
                  <span className="text-[var(--muted)]">
                    (this) · {stageLabel(lead.stage)}
                  </span>
                </li>
                {siblings.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
                      onClick={() => onOpenLead(s.id)}
                    >
                      {s.childName}
                    </button>{" "}
                    <span className="text-[var(--muted)]">
                      · {stageLabel(s.stage)} · {s.enquiryNo}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {canEdit ? (
            <div className="grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
                  + Add sibling (same household)
                </p>
                <div className="space-y-2">
                  <input
                    className={inp}
                    placeholder="Child name *"
                    value={sibName}
                    onChange={(e) => setSibName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className={inp}
                      value={sibDob}
                      onChange={(e) => setSibDob(e.target.value)}
                    />
                    <select
                      className={inp}
                      value={sibGender}
                      onChange={(e) => setSibGender(e.target.value)}
                    >
                      <option value="">Gender</option>
                      <option value="M">M</option>
                      <option value="F">F</option>
                      <option value="O">O</option>
                    </select>
                  </div>
                  <select
                    className={inp}
                    value={sibClass}
                    onChange={(e) => setSibClass(e.target.value)}
                  >
                    <option value="">Class sought *</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                    onClick={() => {
                      onAddSibling({
                        childName: sibName,
                        dob: sibDob,
                        gender: sibGender,
                        classSoughtId: sibClass,
                      });
                      setSibName("");
                      setSibDob("");
                      setSibGender("");
                      setSibClass("");
                    }}
                  >
                    Add sibling enquiry
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
                  + Add guardian (same household)
                </p>
                <div className="space-y-2">
                  <input
                    className={inp}
                    placeholder="Full name *"
                    value={gName}
                    onChange={(e) => setGName(e.target.value)}
                  />
                  <select
                    className={inp}
                    value={gRelation}
                    onChange={(e) =>
                      setGRelation(e.target.value as GuardianRelation)
                    }
                  >
                    {GUARDIAN_RELATIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inp}
                    placeholder="Mobile (optional)"
                    inputMode="numeric"
                    maxLength={10}
                    value={gMobile}
                    onChange={(e) =>
                      setGMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                  />
                  <label className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={gPrimary}
                      onChange={(e) => setGPrimary(e.target.checked)}
                    />
                    Set as primary (fee / WhatsApp)
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => {
                      onAddGuardian({
                        fullName: gName,
                        relation: gRelation,
                        mobile: gMobile,
                        isPrimary: gPrimary,
                      });
                      setGName("");
                      setGMobile("");
                      setGPrimary(false);
                    }}
                  >
                    Add guardian
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </MastersWorkCard>
      ) : null}

      <MastersWorkCard title="Child & class">
        {!locked && canEdit ? (
          <div className="mb-3">
            <AdmissionDocOcrPanel
              disabled={locked || !canEdit}
              onApply={(patch) => onPatch(patch)}
              onApplyApplication={(f) => {
                // Only overwrite with what the form actually says; class by name match.
                const cls = f.classSought
                  ? classes.find(
                      (c) => c.name.trim().toLowerCase() === f.classSought.trim().toLowerCase(),
                    )
                  : undefined;
                const patch: Partial<AdmissionLead> = {};
                if (f.studentName) patch.childName = f.studentName;
                if (f.dob) patch.dob = f.dob;
                if (f.gender) patch.gender = f.gender;
                if (cls) patch.classSoughtId = cls.id;
                if (f.fatherName || f.guardianName) patch.guardianName = f.guardianName || f.fatherName;
                if (f.motherName) patch.motherName = f.motherName;
                if (f.mobile) patch.mobile = f.mobile;
                if (f.email) patch.email = f.email;
                if (f.address) patch.address = f.address;
                if (f.pincode) patch.pincode = f.pincode;
                if (f.previousSchool) patch.previousSchool = f.previousSchool;
                if (f.category) patch.category = f.category;
                if (f.aadhaarLast4) {
                  patch.docsAadhaar = true;
                  patch.registrationFeeNote = [lead.registrationFeeNote, `Aadhaar ····${f.aadhaarLast4} (from form)`]
                    .filter(Boolean)
                    .join(" · ");
                }
                if (f.classSought && !cls) {
                  patch.campaignNote = [lead.campaignNote, `Form says class: ${f.classSought}`].filter(Boolean).join(" · ");
                }
                onPatch(patch);
              }}
            />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Child name">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.childName}
              onChange={(e) => onPatch({ childName: e.target.value })}
            />
          </Field>
          <Field label="DOB">
            <input
              type="date"
              className={inp}
              disabled={locked || !canEdit}
              value={lead.dob}
              onChange={(e) => onPatch({ dob: e.target.value })}
            />
          </Field>
          <Field label="Class sought">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.classSoughtId}
              onChange={(e) => onPatch({ classSoughtId: e.target.value })}
            >
              <option value="">—</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Class admitted">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.classAdmittedId || lead.classSoughtId}
              onChange={(e) =>
                onPatch({
                  classAdmittedId: e.target.value,
                  sectionId: "",
                })
              }
            >
              <option value="">—</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Section (required to enroll)">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.sectionId}
              onChange={(e) => onPatch({ sectionId: e.target.value })}
            >
              <option value="">—</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Admission kind">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.admissionKind}
              onChange={(e) =>
                onPatch({
                  admissionKind: e.target.value as AdmissionKind,
                })
              }
            >
              <option value="new">New</option>
              <option value="transfer">Transfer</option>
              <option value="readmission">Re-admission</option>
            </select>
          </Field>
          <Field label="Admission date">
            <input
              type="date"
              className={inp}
              disabled={locked || !canEdit}
              value={lead.admissionDate}
              onChange={(e) => onPatch({ admissionDate: e.target.value })}
            />
          </Field>
          <Field label="Medium">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.medium}
              onChange={(e) => onPatch({ medium: e.target.value })}
            >
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
            </select>
          </Field>
        </div>
      </MastersWorkCard>

      <MastersWorkCard title="Family preferences & attribution">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Language for school messages">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.preferredLanguage}
              onChange={(e) => onPatch({ preferredLanguage: e.target.value })}
            >
              <option value="">Not asked</option>
              {HOUSEHOLD_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {l.native}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Previous board (Class VI+)">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.previousBoard}
              onChange={(e) => onPatch({ previousBoard: e.target.value })}
            >
              <option value="">Not asked</option>
              {PREVIOUS_BOARDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">What matters most to the family</span>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_CONCERNS.map((c) => {
                const on = lead.concerns.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={locked || !canEdit}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`}
                    onClick={() =>
                      onPatch({ concerns: on ? lead.concerns.filter((x) => x !== c.id) : [...lead.concerns, c.id] })
                    }
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Campaign id (attribution)">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.campaignId}
              onChange={(e) => onPatch({ campaignId: e.target.value.trim().slice(0, 80) })}
              placeholder="from the ad / link, blank = unknown"
            />
          </Field>
          <Field label="Consent (DPDP)">
            <p className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs">
              {lead.parentConsentAt
                ? `Given ${new Date(lead.parentConsentAt).toLocaleString("en-IN")}${lead.parentConsentBy ? ` · ${lead.parentConsentBy}` : ""}`
                : "Not recorded — ask before marketing messages"}
            </p>
          </Field>
        </div>
      </MastersWorkCard>

      <MastersWorkCard title="Parents & address (synced from household)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Primary guardian / father">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.guardianName}
              onChange={(e) => onPatch({ guardianName: e.target.value })}
            />
          </Field>
          <Field label="Mother (required for registration)">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.motherName}
              onChange={(e) => onPatch({ motherName: e.target.value })}
            />
          </Field>
          <Field label="Primary mobile">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.mobile}
              onChange={(e) =>
                onPatch({
                  mobile: e.target.value.replace(/\D/g, "").slice(0, 10),
                })
              }
            />
          </Field>
          <Field label="Category">
            <select
              className={inp}
              disabled={locked || !canEdit}
              value={lead.category}
              onChange={(e) => onPatch({ category: e.target.value })}
            >
              {STUDENT_CATEGORIES.map((c) => (
                <option key={c.value || "empty"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Locality">
            <input
              className={inp}
              disabled={locked || !canEdit}
              value={lead.locality}
              onChange={(e) => onPatch({ locality: e.target.value })}
            />
          </Field>
          <Field label="Home address">
            <AddressAutocompleteField
              disabled={locked || !canEdit}
              value={lead.address}
              onChange={(v) => onPatch({ address: v })}
              onResolved={(place) =>
                onPatch({
                  address: place.address,
                  locality: place.locality || lead.locality,
                  city: place.city || lead.city || "Varanasi",
                  pincode: place.pincode || lead.pincode,
                })
              }
              inputClassName={inp}
            />
          </Field>
          <Field label="PIN code">
            <input
              className={inp}
              disabled={locked || !canEdit}
              inputMode="numeric"
              maxLength={6}
              value={lead.pincode}
              onChange={(e) =>
                onPatch({
                  pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                })
              }
            />
          </Field>
        </div>
      </MastersWorkCard>

      <MastersWorkCard
        title="Registration checklist"
        hint="Required before moving enquiry → Registered"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["docsBirthCert", "Birth certificate"],
              ["docsPhoto", "Passport photo"],
              ["docsAadhaar", "Aadhaar (child)"],
              ["docsTc", "TC (if transfer)"],
              ["docsCategory", "Category certificate"],
              ["declarationAccepted", "Parent declaration accepted"],
              ["registrationFeePaid", "Registration fee paid / waived"],
              ["rte", "Admission under RTE"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 text-sm text-[var(--brand-deep)]"
            >
              <input
                type="checkbox"
                disabled={locked || !canEdit}
                checked={!!lead[key]}
                onChange={(e) => onPatch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        {lead.rte ? (
          <Field label="Govt RTE application no. (official list)">
            <input
              className={`${inp} mt-2`}
              disabled={locked || !canEdit}
              value={lead.rteGovtApplicationNo}
              onChange={(e) =>
                onPatch({ rteGovtApplicationNo: e.target.value.trim() })
              }
              placeholder="e.g. UPRTE2025-00123 — required before SIS"
            />
          </Field>
        ) : null}
        <Field label="Registration fee note">
          <input
            className={`${inp} mt-2`}
            disabled={locked || !canEdit}
            value={lead.registrationFeeNote}
            onChange={(e) =>
              onPatch({ registrationFeeNote: e.target.value })
            }
            placeholder="Receipt no. or waiver reference"
          />
        </Field>
      </MastersWorkCard>
    </div>
  );
}
