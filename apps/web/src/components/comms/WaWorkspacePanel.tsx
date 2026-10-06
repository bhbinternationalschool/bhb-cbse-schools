"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters } from "@/lib/masters";
import { canSeeModuleTab, hasPermission, loadRbac, type RbacModule } from "@/lib/rbac";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ClassChannelsPanel } from "@/components/comms/ClassChannelsPanel";
import { HouseholdMessageLogPanel } from "@/components/comms/HouseholdMessageLogPanel";
import { OfficeRelayPanel } from "@/components/comms/OfficeRelayPanel";
import { WaChatHubPanel } from "@/components/comms/WaChatHubPanel";
import { WaSendToAudiencePanel } from "@/components/comms/WaSendToAudiencePanel";
import { AutomationBadNumbers } from "@/components/masters/automation/AutomationBadNumbers";
import { AutomationSentMessages } from "@/components/masters/automation/AutomationSentMessages";
import { AutomationUsageCost } from "@/components/masters/automation/AutomationUsageCost";

/**
 * Everything WhatsApp, behind one door.
 *
 * The screens grew where each was built rather than where anyone would look
 * for them: sending sat in Comms, delivery ticks and bad numbers and the cost
 * dashboard sat in Masters → Automation, and the office had to know which of
 * two modules held which half of the same job. Asked to send to a class and
 * then check it landed, a staff member had to change module.
 *
 * So they are one section now, in Comms, where the people who send messages
 * already work. Masters → Automation keeps what genuinely belongs to it —
 * the rules, the approval queue, the run history — and points here for the
 * rest.
 *
 * Order is the order of the job: write and send, read the replies, see what
 * landed, fix what did not, then what it cost.
 */

export type WaWorkspaceTab =
  | "send"
  | "chats"
  | "classes"
  | "delivered"
  | "numbers"
  | "cost"
  | "relay"
  | "log";

const TABS: ModuleTabItem[] = [
  { id: "send", label: "Send message", tone: "teal" },
  { id: "chats", label: "Chats", tone: "teal" },
  { id: "classes", label: "Class groups", tone: "violet" },
  { id: "delivered", label: "Delivered", tone: "navy" },
  { id: "numbers", label: "Numbers to fix", tone: "coral" },
  { id: "cost", label: "Usage & cost", tone: "amber" },
  { id: "relay", label: "Office relay", tone: "violet" },
  { id: "log", label: "Household log", tone: "slate" },
];

const IDS = new Set(TABS.map((t) => t.id));

/**
 * Whose grant each section answers to on the server: sending and the
 * office relay are Notifications routes, delivery / numbers / cost are WA
 * automation routes, and the inbox, class groups and household log sit
 * behind the WhatsApp staff check (Notices and friends).
 */
const SECTION_MODULE: Record<WaWorkspaceTab, RbacModule> = {
  send: "notifications",
  chats: "notices",
  classes: "notices",
  delivered: "wa_automation",
  numbers: "wa_automation",
  cost: "wa_automation",
  relay: "notifications",
  log: "notices",
};

/** A tab name from a URL, or the default. Unknown values never throw. */
export function waWorkspaceTabFrom(raw: string | null | undefined): WaWorkspaceTab {
  const v = (raw || "").trim();
  return (IDS.has(v) ? v : "send") as WaWorkspaceTab;
}

export function WaWorkspacePanel({
  readOnly,
  by,
  initialTab = "send",
}: {
  readOnly: boolean;
  by: string;
  initialTab?: WaWorkspaceTab;
}) {
  const session = useDemoSession();
  const [tab, setTab] = useState<WaWorkspaceTab>(initialTab);

  // Holding Notices, every section shows, as it always has. Holding only
  // some WhatsApp functions (Masters → Roles), only their sections — each
  // section's server route accepts exactly those functions.
  const [shownTabs, setShownTabs] = useState<ModuleTabItem[]>(TABS);
  useEffect(() => {
    const masters = loadMasters();
    const rbac = loadRbac();
    setShownTabs(
      hasPermission(session, masters, "notices", "view", rbac)
        ? TABS
        : TABS.filter((t) =>
            canSeeModuleTab(session, masters, SECTION_MODULE[t.id as WaWorkspaceTab], t.id, rbac),
          ),
    );
  }, [session]);
  useEffect(() => {
    if (shownTabs.length > 0 && !shownTabs.some((t) => t.id === tab)) {
      setTab(shownTabs[0]!.id as WaWorkspaceTab);
    }
  }, [shownTabs, tab]);

  const hint = useMemo(() => {
    switch (tab) {
      case "send":
        return "Pick who it goes to — staff, parents by class, a fee stage, or students you tick one by one — then send an approved template.";
      case "chats":
        return "Replies from families and staff, and the desk's answers back.";
      case "classes":
        return "The school's WhatsApp groups, one per class.";
      case "delivered":
        return "Every message the school sent and what happened to it: sent, delivered, read, failed.";
      case "numbers":
        return "Numbers that cannot receive WhatsApp, whose children they belong to, and what to do about each.";
      case "cost":
        return "What WhatsApp costs, at your own rates — by month, by class, by child, parents against staff.";
      case "relay":
        return "Messages the bot could not answer go to the office phone you choose for each kind; the office replies from that phone and the answer goes back from the school number. Every message is kept.";
      default:
        return "One family's whole message history, WhatsApp and in-app together.";
    }
  }, [tab]);

  return (
    <div className="mt-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          WhatsApp
        </h2>
        <p className="mt-1 max-w-3xl text-[12px] text-[var(--muted)]">{hint}</p>
      </div>

      <ModuleTabs
        items={shownTabs}
        value={tab}
        onChange={(id) => setTab(id as WaWorkspaceTab)}
        aria-label="WhatsApp sections"
        size="md"
      />

      <div className="mt-4">
        {tab === "send" ? <WaSendToAudiencePanel readOnly={readOnly} /> : null}
        {tab === "chats" ? <WaChatHubPanel by={by} canEdit={!readOnly} /> : null}
        {tab === "classes" ? <ClassChannelsPanel /> : null}
        {tab === "delivered" ? <AutomationSentMessages /> : null}
        {tab === "numbers" ? <AutomationBadNumbers readOnly={readOnly} /> : null}
        {tab === "cost" ? <AutomationUsageCost readOnly={readOnly} /> : null}
        {tab === "relay" ? <OfficeRelayPanel readOnly={readOnly} /> : null}
        {tab === "log" ? <HouseholdMessageLogPanel /> : null}
      </div>
    </div>
  );
}
