"use client";

import { useState } from "react";
import { pendingApprovals } from "@/lib/automation";
import { AutomationListView } from "./automation/AutomationListView";
import { AutomationCreateView } from "./automation/AutomationCreateView";
import { AutomationEditView } from "./automation/AutomationEditView";
import { useAutomationDesk } from "./automation/useAutomationDesk";

type Screen = "list" | "create" | "edit";

export function AutomationPanel() {
  const desk = useAutomationDesk();
  const [screen, setScreen] = useState<Screen>("list");
  const [editId, setEditId] = useState<string | null>(null);

  if (!desk.state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading automation…</p>
    );
  }

  const automationState = desk.state;

  const selected =
    editId != null
      ? automationState.rules.find((r) => r.id === editId) || null
      : null;

  function goList() {
    setScreen("list");
    setEditId(null);
  }

  function goEdit(id: string) {
    setEditId(id);
    setScreen("edit");
  }

  if (screen === "create") {
    return (
      <AutomationCreateView
        state={automationState}
        readOnly={desk.readOnly}
        notice={desk.notice}
        onBack={goList}
        onCreated={(nextState, ruleId) => {
          if (desk.commit(nextState, "Rule created")) goEdit(ruleId);
        }}
      />
    );
  }

  if (screen === "edit") {
    if (!selected) {
      return (
        <AutomationListView
          state={automationState}
          readOnly={desk.readOnly}
          notice={desk.notice}
          onCreate={() => setScreen("create")}
          onEdit={goEdit}
          onEvaluate={() =>
            desk.evaluateTick(
              automationState.rules.filter((r) => r.enabled).map((r) => r.id),
            )
          }
          onDispatchApproval={(id) => {
            const item = pendingApprovals(automationState).find((a) => a.id === id);
            if (item) void desk.dispatchApproval(item);
          }}
          onRejectApproval={(id) => desk.decideApproval(id, "rejected")}
          onSnoozeApproval={(id) => desk.decideApproval(id, "snoozed", 24)}
        />
      );
    }
    return (
      <AutomationEditView
        rule={selected}
        state={automationState}
        readOnly={desk.readOnly}
        notice={desk.notice}
        onBack={goList}
        onToggle={(enabled) => desk.setEnabled(selected.id, enabled)}
        onMarkTested={() => desk.markTested(selected.id)}
        onMode={(mode) => desk.setMode(selected.id, mode)}
        onSchedule={(patch) => desk.updateSchedule(selected.id, patch)}
        onUpdate={(patch) => desk.updateRule(selected.id, patch)}
        onForceEvaluate={() =>
          desk.evaluateTick([selected.id])
        }
      />
    );
  }

  return (
    <AutomationListView
      state={automationState}
      readOnly={desk.readOnly}
      notice={desk.notice}
      onCreate={() => setScreen("create")}
      onEdit={goEdit}
      onEvaluate={() =>
        desk.evaluateTick(
          automationState.rules.filter((r) => r.enabled).map((r) => r.id),
        )
      }
      onDispatchApproval={(id) => {
        const item = pendingApprovals(automationState).find((a) => a.id === id);
        if (item) void desk.dispatchApproval(item);
      }}
      onRejectApproval={(id) => desk.decideApproval(id, "rejected")}
      onSnoozeApproval={(id) => desk.decideApproval(id, "snoozed", 24)}
    />
  );
}
