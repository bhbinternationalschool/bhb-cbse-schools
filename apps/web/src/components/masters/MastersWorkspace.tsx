"use client";
// ratchet-allow: grids_without_row_menu — rows carry EditControl (which shows which row is open in the form beside it) and RemoveControl (which holds the check explaining why a row cannot be deleted); neither survives being folded into a menu

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import {
  FEE_FREQUENCIES,
  currentAcademicYearCode,
  checkCampusRemoval,
  checkClassRemoval,
  checkFeeHeadCategoryRemoval,
  checkFeeHeadRemoval,
  checkSectionRemoval,
  feeHeadCategoryLabel,
  listConcessionPolicies,
  normalizeMastersRead,
  newId,
  removeCampus,
  removeClass,
  removeFeeHead,
  removeFeeHeadCategory,
  removeSection,
  resolveFeeHeadCategories,
  type Campus,
  type FeeHead,
  type FeeHeadCategory,
  type FeeHeadCategoryDef,
  type FeeFrequency,
  type MastersState,
  type SchoolClass,
  type Section,
  CLASS_GROUPS,
  classesInGroup,
  classGroupCodeForName,
} from "@/lib/masters";
import { CustomFieldsPanel } from "@/components/masters/CustomFieldsPanel";
import { QueryError } from "@/components/data/QueryError";
import { useScreenMasters } from "@/components/data/useScreenMasters";
import { TutorPassesPanel } from "@/components/masters/TutorPassesPanel";
import {
  pendingAfterAnswer,
  pendingAfterSave,
  pendingRevision,
  withPending,
  type PendingElement,
} from "@/components/masters/mastersElementPending";
import { useMasters } from "@/lib/data/client/hooks";
import { planMastersElementCommit, type MastersCommitOpts } from "@/lib/data/client/mastersElementPlan";
import { useMastersElementWrites } from "@/lib/data/client/writeHooks";
import { useStaffBookWrites } from "@/lib/data/client/staffBookWrites";
import type { StaffBook } from "@/lib/data/client/staffBookPlan";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { SectionTeachersPanel } from "@/components/masters/SectionTeachersPanel";
import {
  FeeGroupsPanel,
  InstallmentsPanel,
  LateFeePanel,
  FeeBackdatePolicyPanel,
  MidYearFeePolicyPanel,
} from "@/components/masters/FeeSetupPanels";
import { FeeStructurePanel } from "@/components/masters/FeeStructureBoard";
import { SpecialFeesPanel } from "@/components/masters/SpecialFeesPanel";
import { ConcessionsPanel } from "@/components/masters/ConcessionsPanel";
import {
  AcademicPanel,
  HolidaysPanel,
  LeaveMastersPanel,
  NumberSeriesPanel,
  SchoolProfilePanel,
  StaffMastersPanel,
} from "@/components/masters/FoundationPanels";
import { SubjectsPanel } from "@/components/masters/SubjectsPanel";
import { SalarySetupPanel } from "@/components/masters/SalarySetupPanel";
import { RolesPermissionsPanel } from "@/components/masters/RolesPermissionsPanel";
import { WaTemplatesPanel } from "@/components/masters/WaTemplatesPanel";
import { AutomationPanel } from "@/components/masters/AutomationPanel";
import { WaChatbotPanel } from "@/components/masters/WaChatbotPanel";
import { SchoolBrandAssetsPanel } from "@/components/masters/SchoolBrandAssetsPanel";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { ModuleTabGroups, type ModuleTabGroup } from "@/components/ui/ModuleTabs";
import { StepChainGuide, StepTabs, type StepDef } from "@/components/ui/StepTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import {
  canAccessMastersTab,
  canConfigureRbac,
  loadRbac,
} from "@/lib/rbac";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SubjectRequestsCard } from "@/components/masters/SubjectRequestsCard";

/** Masters keys owned by the Staff module: written as staff rows (data-layer 2.2d). */
const STAFF_SETUP_KEYS = ["staff", "departments", "designations"] as const;

type Tab =
  | "overview"
  | "school"
  | "academic"
  | "campuses"
  | "classes"
  | "subjects"
  | "series"
  | "holidays"
  | "staff"
  | "leave"
  | "salary"
  | "roles"
  | "fee-heads"
  | "fee-groups"
  | "fee-structure"
  | "special-fees"
  | "concessions"
  | "installments"
  | "late-fee"
  | "mid-year"
  | "tutor-passes"
  | "wa-templates"
  | "automation"
  | "wa-chatbot"
  | "brand"
  | "custom-fields";

const TAB_GROUPS: ModuleTabGroup[] = [
  {
    id: "home",
    label: "Overview",
    tone: "navy",
    tabs: [{ id: "overview", label: "Dashboard", tone: "navy" }],
  },
  {
    id: "institution",
    label: "Institution",
    tone: "teal",
    tabs: [
      { id: "school", label: "School", tone: "teal" },
      { id: "brand", label: "Brand & stamps", tone: "teal" },
      { id: "campuses", label: "Campuses", tone: "teal" },
      { id: "staff", label: "Staff setup", tone: "slate" },
      { id: "roles", label: "Roles & permissions", tone: "navy" },
      { id: "leave", label: "Leave setup", tone: "coral" },
      { id: "salary", label: "Salary setup", tone: "green" },
      { id: "series", label: "Numbering", tone: "slate" },
      { id: "custom-fields", label: "Custom fields", tone: "violet" },
    ],
  },
  {
    id: "academic",
    label: "Academic",
    tone: "sky",
    tabs: [
      { id: "academic", label: "Session", tone: "sky" },
      { id: "classes", label: "Classes & sections", tone: "sky" },
      { id: "subjects", label: "Subjects", tone: "violet" },
      { id: "holidays", label: "Holidays", tone: "amber" },
    ],
  },
  {
    id: "fees",
    label: "Fee setup",
    tone: "green",
    tabs: [
      { id: "fee-heads", label: "Fee heads", tone: "green" },
      { id: "fee-groups", label: "Fee groups", tone: "green" },
      { id: "fee-structure", label: "Fee structure", tone: "green" },
      { id: "special-fees", label: "Special fees", tone: "teal" },
      { id: "concessions", label: "Concessions", tone: "teal" },
      { id: "installments", label: "Due dates", tone: "amber" },
      { id: "late-fee", label: "Late fee", tone: "rose" },
      { id: "mid-year", label: "Fee rules", tone: "rose" },
      { id: "tutor-passes", label: "Tutor passes", tone: "teal" },
    ],
  },
  {
    id: "comms-automation",
    label: "Comms & automation",
    tone: "violet",
    tabs: [
      { id: "wa-templates", label: "WhatsApp templates", tone: "violet" },
      { id: "automation", label: "Automation", tone: "amber" },
      { id: "wa-chatbot", label: "WhatsApp chatbot", tone: "teal" },
    ],
  },
];

/**
 * Two chains in Masters run across separate tabs, each needing the one
 * before: fees are built head → group → structure → … → rules, and the
 * academic year session → classes → subjects → holidays. A step guide over
 * the tabs says where you are and what comes next; the tabs still work
 * on their own.
 */
const FEE_SETUP_STEPS: StepDef<Tab>[] = [
  { id: "fee-heads", title: "Fee heads", what: "The kinds of charge — tuition, admission, exam, transport, annual — every fee line is booked to one." },
  { id: "fee-groups", title: "Fee groups", what: "Bands of classes that pay the same fees (e.g. Nursery–UKG, I–V, VI–VIII)." },
  { id: "fee-structure", title: "Fee structure", what: "The amounts for each group, month by month, per student type (new, promoted, mid-year, RTE). Publish a group to use it at the counter." },
  { id: "special-fees", title: "Special fees", what: "One-off charges outside the structure for chosen classes or students." },
  { id: "concessions", title: "Concessions", what: "Discount policies and who receives them — sibling, staff ward, merit, need." },
  { id: "installments", title: "Due dates", what: "When each month's or term's fees fall due — the pattern and the individual dates." },
  { id: "late-fee", title: "Late fee", what: "What is charged after a due date passes, and from when." },
  { id: "mid-year", title: "Fee rules", what: "How fees work for a child joining mid-year, and who may enter a back-dated receipt." },
];

const ACADEMIC_STEPS: StepDef<Tab>[] = [
  { id: "academic", title: "Session", what: "The academic years and their terms. The current session is what every other screen works in." },
  { id: "classes", title: "Classes & sections", what: "The classes the school runs, their sections, and the class teachers." },
  { id: "subjects", title: "Subjects", what: "Subjects and their components, linked to classes, with periods per week for the timetable." },
  { id: "holidays", title: "Holidays", what: "The holiday calendar — import the government list, draft the school's, and publish it." },
];

export function MastersWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [tab, setTab] = useState<Tab>("overview");
  const [rbac, setRbac] = useState(() =>
    typeof window === "undefined" ? null : loadRbac(),
  );
  // data-layer 2.1h — READS: the server's book + the access copy's staff side
  // (useScreenMasters, kept fresh by the versions poll), normalised exactly as
  // loadMasters() normalised the page copy, so every panel sees the same shape.
  // data-layer 2.2c — WRITES of the Foundation (campuses, years, terms,
  // classes, sections, subjects, streams, class subjects, numbering,
  // holidays, school profile / timing / statutory setup) and of the class /
  // subject teacher links are ELEMENT writes: commit() works out what the
  // action changed (mastersElementPlan) and sends only those elements, each on
  // the `_rev` the view served. Until an answer serves an element at the
  // revision its save answered, the element as sent is laid over the answer
  // (./mastersElementPending). Staff setup (departments, designations) is
  // written as staff rows since 2.2d (useStaffBookWrites). Fee setup is
  // element writes too since 2.2e (fee heads, groups, structure lines,
  // instalments, late fee, special fees, concessions and grants, the mid-year
  // policy): nothing in this editor saves the whole book any more.
  const {
    masters: screenMasters,
    error: mastersError,
    retry: retryMasters,
  } = useScreenMasters();
  const view = useMasters().data ?? null;
  const read = useMemo(
    () => (screenMasters ? normalizeMastersRead(screenMasters) : null),
    [screenMasters],
  );
  const [pending, setPendingState] = useState<PendingElement[]>([]);
  const pendingRef = useRef<PendingElement[]>([]);
  const setPending = (next: PendingElement[]) => {
    pendingRef.current = next;
    setPendingState(next);
  };
  const saveSeq = useRef(0);
  const writeElements = useMastersElementWrites();
  const staffWrites = useStaffBookWrites();
  const state = useMemo(() => {
    if (!read) return null;
    // Rows laid on from a save are the editor's own (normalised) elements, but
    // a dropped key travels as null: normalise the result like every answer.
    return pending.length ? normalizeMastersRead(withPending(read, pending)) : read;
  }, [read, pending]);
  const [notice, setNotice] = useState<string | null>(null);

  // Element saves: every answer drops the elements it serves at (or past)
  // the revision their save answered. While some are unproven, ask again
  // every 2.5 s (an identical answer keeps React Query's data object, so
  // the tick — not the answer — re-runs this); an entry no answer proves
  // within HOLD_MS goes anyway (mastersElementPending).
  const [pendingTick, setPendingTick] = useState(0);
  useEffect(() => {
    if (!pendingRef.current.length) return;
    const left = pendingAfterAnswer(pendingRef.current, view?.masters, view?.stamps, Date.now());
    if (left !== pendingRef.current) setPending(left);
    const unproven = left.some((p) => p.savedAt > 0 && p.kind !== "staff");
    // A save still in flight is re-checked too (an answer that never comes
    // is given up after SEND_TIMEOUT_MS), without asking for the view.
    if (!unproven && !left.some((p) => p.savedAt === 0)) return;
    const t = window.setTimeout(() => {
      if (unproven) void retryMasters();
      setPendingTick((n) => n + 1);
    }, 2_500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryMasters is React Query's refetch (stable)
  }, [view, pending, pendingTick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: Tab[] = [
      "overview",
      "school",
      "academic",
      "campuses",
      "classes",
      "subjects",
      "series",
      "holidays",
      "staff",
      "leave",
      "salary",
      "roles",
      "fee-heads",
      "fee-groups",
      "fee-structure",
      "special-fees",
      "concessions",
      "installments",
      "late-fee",
      "mid-year",
      "tutor-passes",
      "wa-templates",
      "automation",
      "wa-chatbot",
      "brand",
      "custom-fields",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as Tab);
  }, []);

  useEffect(() => {
    void (async () => {
      const [
        { ensureStaffHydrated },
        { ensureRbacHydrated },
        { withHydrationSlot },
      ] = await Promise.all([
        import("@/lib/staffPersistence"),
        import("@/lib/rbacPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await Promise.all([
        withHydrationSlot(() => ensureStaffHydrated()),
        withHydrationSlot(() => ensureRbacHydrated()),
      ]);
      setRbac(loadRbac());
    })();
  }, []);

  const visibleTabGroups = useMemo(() => {
    const r = rbac ?? loadRbac();
    const masters = state;
    return TAB_GROUPS.map((g) => ({
      ...g,
      tabs: g.tabs.filter((t) => {
        if (t.id === "overview") return true;
        if (!masters) return false;
        if (t.id === "roles") {
          return canConfigureRbac(session, masters, r);
        }
        return canAccessMastersTab(session, masters, t.id, r);
      }),
    })).filter((g) => g.tabs.length > 0);
  }, [session, state, rbac]);

  useEffect(() => {
    if (!state) return;
    const r = rbac ?? loadRbac();
    if (tab !== "overview" && !canAccessMastersTab(session, state, tab, r)) {
      if (tab === "roles" && canConfigureRbac(session, state, r)) return;
      setTab("overview");
    }
  }, [tab, session, state, rbac]);

  function flash(msg: string, ms = 2200) {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), ms);
  }

  function commit(next: MastersState, msg?: string, opts?: MastersCommitOpts) {
    const onDone = opts?.onDone;
    if (readOnly) {
      flash("Selected session is closed — masters are read-only", 2800);
      onDone?.(false);
      return;
    }
    if (!state) {
      onDone?.(false);
      return;
    }
    const plan = planMastersElementCommit({
      shown: state,
      next,
      served: view?.masters,
      stamps: view?.stamps,
      revisionOf: (key, id) => pendingRevision(pendingRef.current, key, id),
      objectBases: opts?.objectBases,
    });
    if (!plan.ok) {
      flash(plan.reason, 5000);
      onDone?.(false);
      return;
    }
    if (opts?.guardEmptyYear) {
      // A clone is always several lists → one batch; the guard rides on it.
      for (const r of plan.requests) if (r.kind === "batch") r.guard = { noActiveFeeGroupsIn: opts.guardEmptyYear };
    }
    const elementWork = plan.requests.length > 0 || plan.staff.length > 0;
    // Staff setup (departments, designations — and any other change to a
    // staff record) is written as staff rows (data-layer 2.2d). Every other
    // key is an element write (2.2e): a key with no element home (the fee
    // back-dating switch, which has never had a place in the database) is
    // refused, nothing sent — never the old whole-book save.
    const staffRest = plan.rest.filter((k) => (STAFF_SETUP_KEYS as readonly string[]).includes(k));
    const homeless = plan.rest.filter((k) => !(STAFF_SETUP_KEYS as readonly string[]).includes(k));
    if (homeless.length) {
      flash(
        `Not saved — ${homeless.join(", ")} ${homeless.length === 1 ? "has" : "have"} no place in the school's database yet, so ${homeless.length === 1 ? "it" : "they"} cannot be saved from here.`,
        7000,
      );
      onDone?.(false);
      return;
    }
    if (!elementWork && plan.rest.length === 0) {
      // Nothing changed: panels pass the book unchanged with a message
      // ("Campus code already exists", "Already linked to V").
      if (msg) flash(msg);
      onDone?.(true);
      return;
    }
    // The success notice must wait for the database, not for React. Showing
    // it synchronously is what made 16 refused writes look like 16 saves on
    // 2026-08-09.
    if (msg) setNotice("Saving…");
    let waiting = (elementWork ? 1 : 0) + (staffRest.length ? 1 : 0);
    let failed = false;
    const done = (ok: boolean, why?: string) => {
      waiting -= 1;
      if (!ok) failed = true;
      if (!ok && why) flash(why, 6000);
      if (waiting > 0) return;
      if (!failed && msg) flash(msg);
      onDone?.(!failed);
    };

    if (staffRest.length) {
      const pick = (book: MastersState) =>
        Object.fromEntries(staffRest.map((k) => [k, (book as unknown as Record<string, unknown>)[k]])) as StaffBook;
      void staffWrites.commit(pick(state), pick(next)).then((r) => done(r.ok, r.ok ? undefined : r.message));
    }

    if (elementWork) {
      const saveId = ++saveSeq.current;
      const sent: PendingElement[] = [];
      const sentAt = Date.now();
      for (const r of plan.requests) {
        r.ops.forEach((op, i) => {
          const sliceKey = r.kind === "batch" ? (r.parts?.[i]?.sliceKey ?? r.sliceKey) : r.sliceKey;
          sent.push({
            sliceKey,
            id: op.id,
            kind: r.kind === "object" ? "object" : "slice",
            value: op.op === "delete" ? null : ((r.kind === "object" ? (next as unknown as Record<string, unknown>)[r.sliceKey] : (op as { row: Record<string, unknown> }).row) as Record<string, unknown>),
            revision: "",
            saveId,
            savedAt: 0,
            sentAt,
          });
        });
      }
      for (const c of plan.staff) {
        const member = (next.staff ?? []).find((s) => s.id === c.staffId) as unknown as Record<string, unknown> | undefined;
        sent.push({
          sliceKey: "staff",
          id: c.staffId,
          kind: "staff",
          value: member ? { [c.field]: member[c.field] } : null,
          revision: "",
          saveId,
          savedAt: 0,
          sentAt,
        });
      }
      setPending([...pendingRef.current, ...sent]);
      void writeElements(plan.requests, plan.staff).then((outcome) => {
        const now = Date.now();
        let after = pendingRef.current;
        // Staff link entries go once the roster was re-read (the write's own
        // bridge); masters elements once an answer serves them.
        after = after.filter((p) => !(p.saveId === saveId && p.kind === "staff"));
        if (outcome.ok) {
          after = pendingAfterSave(after, saveId, { ok: true, versions: outcome.versions }, now);
        } else {
          // What landed before the failure stays held until served; the rest
          // was not stored and goes now.
          const landed = new Set<string>();
          plan.requests.slice(0, Math.max(0, outcome.failedAt)).forEach((r) => {
            r.ops.forEach((op, i) => landed.add(`${r.kind === "batch" ? (r.parts?.[i]?.sliceKey ?? r.sliceKey) : r.sliceKey}|${op.id}`));
          });
          after = after
            .filter((p) => p.saveId !== saveId || landed.has(`${p.sliceKey}|${p.id}`))
            .map((p) =>
              p.saveId === saveId
                ? { ...p, revision: p.value === null ? "deleted" : String(outcome.versions[`${p.sliceKey}|${p.id}`] ?? ""), savedAt: now }
                : p,
            );
        }
        setPending(after);
        done(outcome.ok, outcome.ok ? undefined : `Not saved — ${outcome.message}`);
      });
    }
  }

  if (!state && mastersError) {
    return <QueryError what="the school's Masters" error={mastersError} retry={retryMasters} />;
  }
  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading masters…</p>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Masters"
      subtitle={`Institution, academic, subjects, holidays, staff setup, and fee setup · selected session ${session.academicYearCode}`}
      icon={<SlidersHorizontal className="size-6" aria-hidden />}
      notice={notice}
    >
      <ModuleTabGroups
        aria-label="Masters"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        groups={visibleTabGroups}
      />

      <StepChainGuide
        chains={[
          { label: "Fee setup", steps: FEE_SETUP_STEPS },
          { label: "Academic setup", steps: ACADEMIC_STEPS },
        ]}
        value={tab}
        onChange={setTab}
        visible={visibleTabGroups.flatMap((g) => g.tabs.map((t) => t.id))}
      />

      <div className="mt-5">
        {tab === "overview" ? (
          <Overview state={state} onGo={setTab} commit={commit} />
        ) : null}
        {tab === "school" ? (
          <SchoolProfilePanel state={state} commit={commit} />
        ) : null}
        {tab === "brand" ? (
          <SchoolBrandAssetsPanel state={state} commit={commit} />
        ) : null}
        {tab === "academic" ? (
          <AcademicPanel state={state} commit={commit} />
        ) : null}
        {tab === "campuses" ? (
          <CampusesPanel state={state} commit={commit} />
        ) : null}
        {tab === "classes" ? (
          <ClassesPanel state={state} commit={commit} />
        ) : null}
        {tab === "subjects" ? (
          <div className="space-y-3">
            <SubjectRequestsCard
              subjects={state.subjects ?? []}
              canEdit={!readOnly}
              onMastersChanged={() => {
                // The card changed Masters on the server: ask now. An open
                // element pending entries stay until an answer holds them.
                void retryMasters();
              }}
            >
              <SubjectsPanel state={state} commit={commit} />
            </SubjectRequestsCard>
          </div>
        ) : null}
        {tab === "custom-fields" ? (
          <CustomFieldsPanel
            canEdit={!readOnly && canAccessMastersTab(session, state, "custom-fields", rbac ?? undefined, "edit")}
          />
        ) : null}
        {tab === "series" ? (
          <NumberSeriesPanel state={state} commit={commit} />
        ) : null}
        {tab === "holidays" ? (
          <HolidaysPanel state={state} commit={commit} />
        ) : null}
        {tab === "staff" ? (
          <StaffMastersPanel state={state} commit={commit} />
        ) : null}
        {tab === "leave" ? <LeaveMastersPanel /> : null}
        {tab === "roles" ? <RolesPermissionsPanel /> : null}
        {tab === "salary" ? <SalarySetupPanel /> : null}
        {tab === "fee-heads" ? (
          <FeeHeadsPanel state={state} commit={commit} />
        ) : null}
        {tab === "fee-groups" ? (
          <FeeGroupsPanel state={state} commit={commit} />
        ) : null}
        {tab === "fee-structure" ? (
          <FeeStructurePanel state={state} commit={commit} />
        ) : null}
        {tab === "special-fees" ? (
          <SpecialFeesPanel state={state} commit={commit} />
        ) : null}
        {tab === "concessions" ? (
          <ConcessionsPanel state={state} commit={commit} />
        ) : null}
        {tab === "installments" ? (
          <InstallmentsPanel state={state} commit={commit} />
        ) : null}
        {tab === "late-fee" ? (
          <LateFeePanel state={state} commit={commit} />
        ) : null}
        {tab === "mid-year" ? (
          <div className="space-y-4">
            <MidYearFeePolicyPanel state={state} commit={commit} />
            <FeeBackdatePolicyPanel state={state} commit={commit} />
          </div>
        ) : null}
        {tab === "tutor-passes" ? (
          <TutorPassesPanel state={state} canEdit={!readOnly} />
        ) : null}
        {tab === "wa-templates" ? (
          canAccessMastersTab(session, state, "wa-templates", rbac ?? undefined) ? (
            <WaTemplatesPanel />
          ) : (
            <MastersAccessDenied label="WhatsApp templates" />
          )
        ) : null}
        {tab === "automation" ? (
          canAccessMastersTab(session, state, "automation", rbac ?? undefined) ? (
            <AutomationPanel />
          ) : (
            <MastersAccessDenied label="Automation" />
          )
        ) : null}
        {tab === "wa-chatbot" ? (
          canAccessMastersTab(session, state, "wa-chatbot", rbac ?? undefined) ? (
            <WaChatbotPanel />
          ) : (
            <MastersAccessDenied label="WhatsApp chatbot" />
          )
        ) : null}
      </div>
    </ErpWorkspaceShell>
  );
}

function MastersAccessDenied({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      You do not have permission to open <strong>{label}</strong>. Ask your
      principal to grant access under Masters → Roles & permissions →{" "}
      <em>WhatsApp & automation</em>.
    </p>
  );
}

function Overview({
  state,
  onGo,
  commit,
}: {
  state: MastersState;
  onGo: (t: Tab) => void;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const activeClasses = state.classes.filter((c) => c.isActive).length;
  const activeSections = state.sections.filter((s) => s.isActive).length;
  const activeHeads = state.feeHeads.filter((f) => f.isActive).length;
  const campuses = state.campuses.filter((c) => c.isActive).length;
  const groups = state.feeGroups.filter(
    (g) => g.isActive && g.academicYearCode === ay,
  ).length;
  const installments = state.installments.filter(
    (i) => i.isActive && i.academicYearCode === ay,
  ).length;

  const specialCount =
    state.specialFees?.filter(
      (f) => f.isActive && f.academicYearCode === ay,
    ).length ?? 0;
  const concessionCount =
    listConcessionPolicies(state, { preferAy: ay }).filter((c) => c.isActive)
      .length ?? 0;

  const subjectCount = state.subjects?.filter((s) => s.isActive).length ?? 0;
  const deptCount =
    state.departments?.filter((d) => d.isActive).length ?? 0;
  const holidayPub =
    state.holidays?.filter(
      (h) => h.isPublished && h.academicYearCode === ay,
    ).length ?? 0;

  const rbacState = loadRbac();
  const cards = [
    { label: "Campuses", value: campuses, tab: "campuses" as Tab },
    { label: "Classes", value: activeClasses, tab: "classes" as Tab },
    { label: "Sections", value: activeSections, tab: "classes" as Tab },
    { label: "Subjects", value: subjectCount, tab: "subjects" as Tab },
    { label: "Departments", value: deptCount, tab: "staff" as Tab },
    { label: "Holidays (pub)", value: holidayPub, tab: "holidays" as Tab },
    { label: "Fee heads", value: activeHeads, tab: "fee-heads" as Tab },
    { label: "Fee groups", value: groups, tab: "fee-groups" as Tab },
    { label: "Special fees", value: specialCount, tab: "special-fees" as Tab },
    { label: "Concessions", value: concessionCount, tab: "concessions" as Tab },
    { label: "Due dates", value: installments, tab: "installments" as Tab },
    { label: "Mid-year & back-dating", value: "Edit", tab: "mid-year" as Tab },
    { label: "WA templates", value: "EN+HI", tab: "wa-templates" as Tab },
    { label: "Automation", value: "Rules", tab: "automation" as Tab },
    { label: "WA chatbot", value: "Flows", tab: "wa-chatbot" as Tab },
  ].filter((c) => canAccessMastersTab(session, state, c.tab, rbacState));

  return (
    <div className="space-y-6">
      <ModuleDashboardHost
        moduleId="masters"
        onNavigateTab={(t) => onGo(t as Tab)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => onGo(c.tab)}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4 text-left transition hover:border-[rgba(197,160,40,0.45)]"
          >
            <div className="text-2xl font-semibold text-[var(--brand-deep)]">
              {c.value}
            </div>
            <div className="mt-1 text-sm text-[var(--muted)]">{c.label}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onGo("school")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          School profile →
        </button>
        <button
          type="button"
          onClick={() => onGo("fee-structure")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Edit fee structure →
        </button>
        <Link
          href="/students"
          className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Import students (CSV) →
        </Link>
        <button
          type="button"
          onClick={() => onGo("holidays")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Holidays →
        </button>
        <Link
          href="/staff"
          className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Staff module →
        </Link>
        <button
          type="button"
          onClick={() => onGo("staff")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Staff setup →
        </button>
        <button
          type="button"
          onClick={() => onGo("roles")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Roles &amp; permissions →
        </button>
        <button
          type="button"
          onClick={() => onGo("leave")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Leave setup →
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Fee setup for {ay}: heads → groups →{" "}
        <strong>fee structure</strong> (class amounts + publish) → concessions
        → due dates → late fee. Published structure bills in Fee Take.
      </p>
    </div>
  );
}

function CampusesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setAddress("");
    setMakePrimary(false);
  }

  function startEdit(c: Campus) {
    setEditingId(c.id);
    setCode(c.code);
    setName(c.name);
    setAddress(c.address ?? "");
    setMakePrimary(c.isPrimary);
  }

  function saveCampus(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.campuses.some(
        (c) =>
          c.code.toUpperCase() === nextCode &&
          c.id !== editingId,
      )
    ) {
      commit(state, "Campus code already exists");
      return;
    }

    if (editingId) {
      const wantPrimary = makePrimary;
      commit(
        {
          ...state,
          campuses: state.campuses.map((c) => {
            if (c.id === editingId) {
              return {
                ...c,
                code: nextCode,
                name: name.trim(),
                address: address.trim() || undefined,
                isPrimary: wantPrimary || c.isPrimary,
              };
            }
            if (wantPrimary) return { ...c, isPrimary: false };
            return c;
          }),
        },
        "Campus updated",
      );
      resetForm();
      return;
    }

    const campus: Campus = {
      id: newId("cam"),
      code: nextCode,
      name: name.trim(),
      address: address.trim() || undefined,
      isPrimary: state.campuses.length === 0 || makePrimary,
      isActive: true,
    };
    commit(
      {
        ...state,
        campuses: [
          ...(makePrimary
            ? state.campuses.map((c) => ({ ...c, isPrimary: false }))
            : state.campuses),
          campus,
        ],
      },
      "Campus added",
    );
    resetForm();
  }

  const campusCols: DataTableColumn<(typeof state.campuses)[number]>[] = [
    {
      key: "name", header: "Campus", sortable: true,
      value: (c) => c.name,
      render: (c) => (
        <span>
          <span className="font-medium text-[var(--brand-deep)]">{c.name}</span>
          {c.isPrimary ? (
            <span className="ml-2 rounded bg-[rgba(197,160,40,0.2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
              Primary
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "code", header: "Code", sortable: true, value: (c) => c.code },
    { key: "address", header: "Address", value: (c) => c.address || "—" },
    {
      key: "status", header: "Status", sortable: true,
      value: (c) => (c.isActive ? "Active" : "Inactive"),
    },
    {
      key: "actions", header: "",
      render: (c) => (
        <div className="flex items-center justify-end gap-1.5">
          <EditControl active={editingId === c.id} onEdit={() => startEdit(c)} />
          <button
            type="button"
            className="text-xs font-medium text-[var(--brand-mid)]"
            onClick={() =>
              commit(
                {
                  ...state,
                  campuses: state.campuses.map((x) =>
                    x.id === c.id ? { ...x, isActive: !x.isActive } : x,
                  ),
                },
                c.isActive ? "Campus inactivated" : "Campus activated",
              )
            }
          >
            {c.isActive ? "Inactivate" : "Activate"}
          </button>
          <RemoveControl
            check={checkCampusRemoval(state, c.id)}
            onRemove={() => {
              const result = removeCampus(state, c.id);
              if (!result.ok) {
                commit(state, result.reason);
                return;
              }
              if (editingId === c.id) resetForm();
              commit(result.state, "Campus removed");
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={1}>
          <MastersTableCard title="Campuses">
            <DataTable
              columns={campusCols}
              rows={state.campuses}
              rowKey={(c) => c.id}
              minWidth="min-w-[640px]"
              emptyTitle="No campuses yet"
            />
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard
          title={editingId ? "Edit campus" : "Add campus"}
          hint="Working form"
        >
          <form onSubmit={saveCampus} className="max-w-xl space-y-1">
            <Field label="Code">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="field"
                placeholder="MAIN"
                required
              />
            </Field>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
                placeholder="Main Campus"
                required
              />
            </Field>
            <Field label="Address">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="field"
                placeholder="Varanasi, Uttar Pradesh"
              />
            </Field>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={makePrimary}
                onChange={(e) => setMakePrimary(e.target.checked)}
              />
              Primary campus
            </label>
            <div className="mt-4 flex gap-2">
              {editingId ? (
                <button
                  type="button"
                  className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                {editingId ? "Update campus" : "Save campus"}
              </button>
            </div>
          </form>
        </MastersWorkCard>
      }
    />
  );
}

/**
 * Classes, then their sections, then who teaches each section: a section
 * belongs to a class, and teachers are assigned per section. The class list
 * stays on every step — it is how a class is picked for its sections.
 */
type ClassesStep = "classes" | "sections" | "teachers";

const CLASSES_STEPS: StepDef<ClassesStep>[] = [
  {
    id: "classes",
    title: "Classes",
    what: "Add, rename or remove classes. A new class starts with sections A and B; its group (Pre-Primary to Senior) follows from its name.",
  },
  {
    id: "sections",
    title: "Sections",
    what: "Pick a class in the list, then add, rename, inactivate or remove its sections.",
  },
  {
    id: "teachers",
    title: "Class & subject teachers",
    what: "Pick a section's Teachers, then set its class teacher and a teacher for each subject.",
  },
];

function ClassesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const [classStep, setClassStep] = useState<ClassesStep>("classes");
  const [className, setClassName] = useState("");
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState(
    state.classes[0]?.id ?? "",
  );
  const [sectionName, setSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [teachersSectionId, setTeachersSectionId] = useState<string | null>(
    null,
  );

  const selected = useMemo(
    () => state.classes.find((c) => c.id === selectedClassId),
    [state.classes, selectedClassId],
  );
  const sectionsForClass = state.sections.filter(
    (s) => s.classId === selectedClassId,
  );
  const teachersSection = useMemo(() => {
    const sec = state.sections.find((s) => s.id === teachersSectionId);
    if (!sec) return null;
    const cls = state.classes.find((c) => c.id === sec.classId);
    if (!cls) return null;
    return { ...sec, className: cls.name };
  }, [state.sections, state.classes, teachersSectionId]);

  function resetClassForm() {
    setEditingClassId(null);
    setClassName("");
  }

  function startEditClass(c: SchoolClass) {
    setSelectedClassId(c.id);
    setEditingClassId(c.id);
    setClassName(c.name);
  }

  function saveClass(e: React.FormEvent) {
    e.preventDefault();
    if (!className.trim()) return;
    const nextName = className.trim();
    if (
      state.classes.some(
        (c) =>
          c.name.toLowerCase() === nextName.toLowerCase() &&
          c.id !== editingClassId,
      )
    ) {
      commit(state, "Class already exists");
      return;
    }

    if (editingClassId) {
      commit(
        {
          ...state,
          classes: state.classes.map((c) =>
            c.id === editingClassId
              ? {
                  ...c,
                  name: nextName,
                  groupCode: classGroupCodeForName(nextName),
                }
              : c,
          ),
        },
        "Class updated",
      );
      resetClassForm();
      return;
    }

    const cls: SchoolClass = {
      id: newId("cls"),
      name: nextName,
      sortOrder: state.classes.length + 1,
      isActive: true,
      groupCode: classGroupCodeForName(nextName),
    };
    const secs: Section[] = ["A", "B"].map((name) => ({
      id: newId("sec"),
      classId: cls.id,
      name,
      isActive: true,
    }));
    commit(
      {
        ...state,
        classes: [...state.classes, cls],
        sections: [...state.sections, ...secs],
      },
      `Class ${cls.name} added with A & B`,
    );
    setSelectedClassId(cls.id);
    resetClassForm();
  }

  function resetSectionForm() {
    setEditingSectionId(null);
    setSectionName("");
  }

  function startEditSection(s: Section) {
    setEditingSectionId(s.id);
    setSectionName(s.name);
  }

  function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClassId || !sectionName.trim()) return;
    const nextName = sectionName.trim().toUpperCase();
    if (
      sectionsForClass.some(
        (s) =>
          s.name.toLowerCase() === nextName.toLowerCase() &&
          s.id !== editingSectionId,
      )
    ) {
      commit(state, "Section already exists");
      return;
    }

    if (editingSectionId) {
      commit(
        {
          ...state,
          sections: state.sections.map((s) =>
            s.id === editingSectionId ? { ...s, name: nextName } : s,
          ),
        },
        "Section updated",
      );
      resetSectionForm();
      return;
    }

    const sec: Section = {
      id: newId("sec"),
      classId: selectedClassId,
      name: nextName,
      isActive: true,
    };
    commit(
      { ...state, sections: [...state.sections, sec] },
      `Section ${sec.name} added`,
    );
    resetSectionForm();
  }

  return (
    <StepTabs
      aria-label="Classes & sections steps"
      steps={CLASSES_STEPS}
      value={classStep}
      onChange={setClassStep}
    >
    <MastersTabStack
      intro="Classes are grouped: Pre-Primary (Nursery–UKG), Primary (I–V), Middle (VI–VIII), Secondary (IX–X), Senior (XI–XII)."
      tables={
        <MastersTablesRow cols={classStep === "classes" ? 1 : 2}>
          <MastersTableCard title="Classes by group" maxHeight="max-h-[min(70vh,560px)]">
            {CLASS_GROUPS.map((g) => {
              const rows = classesInGroup(state.classes, g.code);
              return (
                <div key={g.code}>
                  <div className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2">
                    <div className="text-xs font-bold text-[var(--brand-deep)]">
                      {g.label}{" "}
                      <span className="font-semibold text-[var(--muted)]">
                        · {g.shortLabel}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--muted)]">{g.nepHint}</p>
                  </div>
                  <ul className="divide-y divide-[var(--border)]">
                    {rows.map((c) => {
                      const classSections = state.sections.filter(
                        (s) => s.classId === c.id,
                      );
                      const count = classSections.filter((s) => s.isActive).length;
                      const inactiveCount = classSections.length - count;
                      const active = c.id === selectedClassId;
                      return (
                        <li
                          key={c.id}
                          className={`flex items-start justify-between gap-2 px-4 py-2.5 ${
                            active ? "bg-[var(--surface-sunken)]" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedClassId(c.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="font-medium text-[var(--brand-deep)]">
                              {c.name}
                              {!c.isActive ? (
                                <span className="ml-2 text-xs text-[var(--muted)]">
                                  inactive
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--muted)]">
                              {count} section{count === 1 ? "" : "s"}
                              {inactiveCount > 0
                                ? ` (+${inactiveCount} inactive)`
                                : ""}
                            </span>
                          </button>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <EditControl
                              active={editingClassId === c.id}
                              onEdit={() => startEditClass(c)}
                            />
                            <RemoveControl
                              check={checkClassRemoval(state, c.id)}
                              onRemove={() => {
                                const result = removeClass(state, c.id);
                                if (!result.ok) {
                                  commit(state, result.reason);
                                  return;
                                }
                                const nextId =
                                  result.state.classes.find(
                                    (x) => x.id === selectedClassId,
                                  )?.id ??
                                  result.state.classes[0]?.id ??
                                  "";
                                setSelectedClassId(nextId);
                                if (editingClassId === c.id) resetClassForm();
                                commit(result.state, "Class removed");
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                    {rows.length === 0 ? (
                      <li className="px-4 py-3 text-xs text-[var(--muted)]">
                        No classes in this group
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </MastersTableCard>

          {classStep !== "classes" ? (
          <MastersTableCard title={`Sections · ${selected?.name ?? "—"}`}>
            <ul className="divide-y divide-[var(--border)]">
              {sectionsForClass.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="font-medium text-[var(--brand-deep)]">
                    {selected?.name}-{s.name}
                    {!s.isActive ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        inactive
                      </span>
                    ) : null}
                  </span>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      className={`text-xs font-semibold ${
                        teachersSectionId === s.id
                          ? "text-[var(--brand-deep)]"
                          : "text-[var(--brand-mid)]"
                      }`}
                      onClick={() => {
                        if (classStep !== "teachers") {
                          setTeachersSectionId(s.id);
                          setClassStep("teachers");
                          return;
                        }
                        setTeachersSectionId(
                          teachersSectionId === s.id ? null : s.id,
                        );
                      }}
                    >
                      Teachers
                    </button>
                    <EditControl
                      active={editingSectionId === s.id}
                      onEdit={() => startEditSection(s)}
                    />
                    <button
                      type="button"
                      className="text-xs text-[var(--brand-mid)]"
                      onClick={() =>
                        commit(
                          {
                            ...state,
                            sections: state.sections.map((x) =>
                              x.id === s.id
                                ? { ...x, isActive: !x.isActive }
                                : x,
                            ),
                          },
                          s.isActive
                            ? "Section inactivated"
                            : "Section activated",
                        )
                      }
                    >
                      {s.isActive ? "Inactivate" : "Activate"}
                    </button>
                    <RemoveControl
                      check={checkSectionRemoval(state, s.id)}
                      onRemove={() => {
                        const result = removeSection(state, s.id);
                        if (!result.ok) {
                          commit(state, result.reason);
                          return;
                        }
                        if (editingSectionId === s.id) resetSectionForm();
                        if (teachersSectionId === s.id)
                          setTeachersSectionId(null);
                        commit(result.state, "Section removed");
                      }}
                    />
                  </div>
                </li>
              ))}
              {sectionsForClass.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No sections yet
                </li>
              ) : null}
            </ul>
          </MastersTableCard>
          ) : null}
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          {classStep === "classes" ? (
          <MastersWorkCard
            title={editingClassId ? "Edit class" : "Add class"}
          >
            <form onSubmit={saveClass} className="flex flex-wrap gap-2">
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="field min-w-[8rem] flex-1"
                placeholder={
                  editingClassId ? "Rename class" : "New class (e.g. XIII)"
                }
              />
              {editingClassId ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={resetClassForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
              >
                {editingClassId ? "Update" : "Add"}
              </button>
            </form>
          </MastersWorkCard>
          ) : null}
          {classStep === "sections" ? (
          <MastersWorkCard
            title={
              editingSectionId
                ? `Edit section · ${selected?.name ?? ""}`
                : `Add section · ${selected?.name ?? "—"}`
            }
          >
            <form onSubmit={saveSection} className="flex flex-wrap gap-2">
              <input
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                className="field min-w-[8rem] flex-1"
                placeholder={
                  editingSectionId ? "Rename section" : "Section (e.g. C)"
                }
                disabled={!selectedClassId}
              />
              {editingSectionId ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={resetSectionForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                disabled={!selectedClassId}
              >
                {editingSectionId ? "Update" : "Add"}
              </button>
            </form>
          </MastersWorkCard>
          ) : null}

          {classStep === "teachers" && !teachersSection ? (
            <p className="text-sm text-[var(--muted)]">
              Pick a class, then press Teachers on one of its sections.
            </p>
          ) : null}
          {classStep === "teachers" && teachersSection ? (
            <MastersWorkCard
              title={`Teachers · ${teachersSection.className}-${teachersSection.name}`}
            >
              <SectionTeachersPanel
                state={state}
                commit={commit}
                classId={teachersSection.classId}
                sectionId={teachersSection.id}
                className={teachersSection.className}
                sectionName={teachersSection.name}
              />
            </MastersWorkCard>
          ) : null}
        </div>
      }
    />
    </StepTabs>
  );
}

function FeeHeadsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const categories = resolveFeeHeadCategories(state);
  const activeCategories = categories.filter((c) => c.isActive);
  const defaultCat = activeCategories[0]?.code ?? categories[0]?.code ?? "misc";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<FeeHeadCategory>(defaultCat);
  const [frequency, setFrequency] = useState<FeeFrequency>(
    FEE_FREQUENCIES[1]!.value,
  );
  const [optional, setOptional] = useState(false);
  const [refundable, setRefundable] = useState(false);

  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catCode, setCatCode] = useState("");
  const [catLabel, setCatLabel] = useState("");

  function resetForm() {
    setEditingId(null);
    setCode("");
    setNameEn("");
    setCategory(defaultCat);
    setFrequency(FEE_FREQUENCIES[1]!.value);
    setOptional(false);
    setRefundable(false);
  }

  function resetCatForm() {
    setCatEditingId(null);
    setCatCode("");
    setCatLabel("");
  }

  function startEdit(f: FeeHead) {
    setEditingId(f.id);
    setCode(f.code);
    setNameEn(f.nameEn);
    setCategory(f.category);
    setFrequency(f.frequency);
    setOptional(f.isOptional);
    setRefundable(!!f.isRefundable);
  }

  function startEditCategory(c: FeeHeadCategoryDef) {
    setCatEditingId(c.id);
    setCatCode(c.code);
    setCatLabel(c.label);
  }

  function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catCode.trim() || !catLabel.trim()) return;
    const nextCode = catCode
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!nextCode) {
      commit(state, "Category code is invalid");
      return;
    }
    const list = resolveFeeHeadCategories(state);
    if (list.some((c) => c.code === nextCode && c.id !== catEditingId)) {
      commit(state, "Category code already exists");
      return;
    }

    if (catEditingId) {
      const prev = list.find((c) => c.id === catEditingId);
      const oldCode = prev?.code ?? nextCode;
      commit(
        {
          ...state,
          feeHeadCategories: list.map((c) =>
            c.id === catEditingId
              ? { ...c, code: nextCode, label: catLabel.trim() }
              : c,
          ),
          feeHeads:
            oldCode === nextCode
              ? state.feeHeads
              : state.feeHeads.map((h) =>
                  h.category === oldCode ? { ...h, category: nextCode } : h,
                ),
        },
        "Fee category updated",
      );
      resetCatForm();
      return;
    }

    const row: FeeHeadCategoryDef = {
      id: newId("fhc"),
      code: nextCode,
      label: catLabel.trim(),
      isActive: true,
      sortOrder: (list.at(-1)?.sortOrder ?? 0) + 10,
    };
    commit(
      { ...state, feeHeadCategories: [...list, row] },
      "Fee category added",
    );
    resetCatForm();
  }

  function saveHead(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !nameEn.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.feeHeads.some(
        (f) => f.code.toUpperCase() === nextCode && f.id !== editingId,
      )
    ) {
      commit(state, "Fee head code already exists");
      return;
    }

    if (editingId) {
      commit(
        {
          ...state,
          feeHeads: state.feeHeads.map((f) =>
            f.id === editingId
              ? {
                  ...f,
                  code: nextCode,
                  nameEn: nameEn.trim(),
                  category,
                  frequency,
                  isOptional: optional,
                  isRefundable: refundable,
                }
              : f,
          ),
        },
        "Fee head updated",
      );
      resetForm();
      return;
    }

    const head: FeeHead = {
      id: newId("fh"),
      code: nextCode,
      nameEn: nameEn.trim(),
      category,
      frequency,
      isOptional: optional,
      isRefundable: refundable,
      isActive: true,
      sortOrder: (state.feeHeads.at(-1)?.sortOrder ?? 0) + 10,
    };
    commit(
      { ...state, feeHeads: [...state.feeHeads, head] },
      "Fee head added",
    );
    resetForm();
  }

  /**
   * Fee-head categories as a table. "3 fee heads · inactive" was a grey line;
   * how many heads hang off a category is the number that decides whether it
   * can be removed at all, so it gets a column.
   *
   * EditControl and RemoveControl stay in a column rather than moving into a
   * row menu: EditControl shows which row is currently open in the form
   * beside it, and RemoveControl carries the check that says why a category
   * cannot be deleted.
   */
  const feeCategoryCols: DataTableColumn<(typeof categories)[number]>[] = [
    { key: "label", header: "Category", sortable: true, value: (c) => c.label },
    { key: "code", header: "Code", sortable: true, value: (c) => c.code },
    {
      key: "used", header: "Fee heads", align: "right", sortable: true,
      value: (c) => state.feeHeads.filter((h) => h.category === c.code).length,
    },
    {
      key: "active", header: "Status", sortable: true,
      value: (c) => (c.isActive ? "Active" : "Inactive"),
    },
    {
      key: "actions", header: "",
      render: (c) => (
        <div className="flex items-center justify-end gap-1.5">
          <EditControl active={catEditingId === c.id} onEdit={() => startEditCategory(c)} />
          <button
            type="button"
            className="text-xs font-medium text-[var(--brand-mid)]"
            onClick={() =>
              commit(
                {
                  ...state,
                  feeHeadCategories: resolveFeeHeadCategories(state).map((x) =>
                    x.id === c.id ? { ...x, isActive: !x.isActive } : x,
                  ),
                },
                c.isActive ? "Category inactivated" : "Category activated",
              )
            }
          >
            {c.isActive ? "Inactivate" : "Activate"}
          </button>
          <RemoveControl
            check={checkFeeHeadCategoryRemoval(state, c.id)}
            onRemove={() => {
              const result = removeFeeHeadCategory(state, c.id);
              if (!result.ok) {
                commit(state, result.reason);
                return;
              }
              if (catEditingId === c.id) resetCatForm();
              commit(result.state, "Category removed");
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={2}>
          <MastersTableCard title="Fee head categories">
            <DataTable
              columns={feeCategoryCols}
              rows={categories}
              rowKey={(c) => c.id}
              minWidth="min-w-[620px]"
              emptyTitle="No fee-head categories yet"
            />
          </MastersTableCard>
          <MastersTableCard title="Fee heads">
            <ul className="divide-y divide-[var(--border)]">
              {state.feeHeads
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-[var(--brand-deep)]">
                        {f.nameEn}{" "}
                        <span className="text-xs font-normal text-[var(--muted)]">
                          {f.code}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {feeHeadCategoryLabel(state, f.category)} · {f.frequency}
                        {f.isRefundable
                          ? " · refundable"
                          : " · non-refundable"}
                        {f.isOptional ? " · optional" : ""}
                        {!f.isActive ? " · inactive" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start">
                      <EditControl
                        active={editingId === f.id}
                        onEdit={() => startEdit(f)}
                      />
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--brand-mid)]"
                        onClick={() =>
                          commit(
                            {
                              ...state,
                              feeHeads: state.feeHeads.map((x) =>
                                x.id === f.id
                                  ? { ...x, isActive: !x.isActive }
                                  : x,
                              ),
                            },
                            f.isActive
                              ? "Fee head inactivated"
                              : "Fee head activated",
                          )
                        }
                      >
                        {f.isActive ? "Inactivate" : "Activate"}
                      </button>
                      <RemoveControl
                        check={checkFeeHeadRemoval(state, f.id)}
                        onRemove={() => {
                          const result = removeFeeHead(state, f.id);
                          if (!result.ok) {
                            commit(state, result.reason);
                            return;
                          }
                          if (editingId === f.id) resetForm();
                          commit(result.state, "Fee head removed");
                        }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title={catEditingId ? "Edit category" : "Add category"}
            hint="Manage fee head categories"
          >
            <form onSubmit={saveCategory} className="space-y-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <input
                    value={catCode}
                    onChange={(e) => setCatCode(e.target.value)}
                    className="field"
                    placeholder="sports"
                    required
                  />
                </Field>
                <Field label="Label">
                  <input
                    value={catLabel}
                    onChange={(e) => setCatLabel(e.target.value)}
                    className="field"
                    placeholder="Sports"
                    required
                  />
                </Field>
              </div>
              <div className="mt-4 flex gap-2">
                {catEditingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                    onClick={resetCatForm}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  {catEditingId ? "Update category" : "Save category"}
                </button>
              </div>
            </form>
          </MastersWorkCard>

          <MastersWorkCard
            title={editingId ? "Edit fee head" : "Add fee head"}
            hint="Working form"
          >
            <form onSubmit={saveHead} className="space-y-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="field"
                    placeholder="SPORTS"
                    required
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="field"
                    placeholder="Sports Fee"
                    required
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={category}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCategory(next);
                      if (next === "deposit") setRefundable(true);
                    }}
                    className="field"
                  >
                    {(activeCategories.length
                      ? activeCategories
                      : categories
                    ).map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Frequency">
                  <select
                    value={frequency}
                    onChange={(e) =>
                      setFrequency(e.target.value as FeeFrequency)
                    }
                    className="field"
                  >
                    {FEE_FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Refund type">
                  <select
                    value={refundable ? "refundable" : "non_refundable"}
                    onChange={(e) =>
                      setRefundable(e.target.value === "refundable")
                    }
                    className="field"
                  >
                    <option value="non_refundable">Non-refundable</option>
                    <option value="refundable">
                      Refundable (security / caution deposit)
                    </option>
                  </select>
                </Field>
                <label className="mt-3 flex items-end gap-2 pb-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={optional}
                    onChange={(e) => setOptional(e.target.checked)}
                  />
                  Optional (e.g. transport)
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                {editingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  {editingId ? "Update fee head" : "Save fee head"}
                </button>
              </div>
            </form>
          </MastersWorkCard>
        </div>
      }
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1.5 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
