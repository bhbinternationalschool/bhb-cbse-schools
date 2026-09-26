"use client";

import { useState } from "react";
import { AutomationListView } from "./automation/AutomationListView";
import { AutomationCreateView } from "./automation/AutomationCreateView";
import { AutomationEditView } from "./automation/AutomationEditView";
import { useAutomationDesk } from "./automation/useAutomationDesk";

type Screen = "list" | "create" | "edit";

export function AutomationPanel() {
  const desk = useAutomationDesk();
  const [screen, setScreen] = useState<Screen>("list");
  const [editId, setEditId] = useState<string | null>(null);

  if (desk.loadError && !desk.state) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">Automation could not be loaded</p>
        <p className="mt-1 text-[12px]">{desk.loadError}</p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-rose-300 px-3 py-1.5 text-[12px] font-semibold"
          onClick={() => void desk.refresh()}
        >
          Try again
        </button>
      </div>
    );
  }

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
    desk.clearPreview();
  }

  function goEdit(id: string) {
    setEditId(id);
    setScreen("edit");
    desk.clearPreview();
  }

  if (screen === "create") {
    return (
      <AutomationCreateView
        readOnly={desk.readOnly}
        notice={desk.notice}
        busy={desk.busy !== null}
        onBack={goList}
        onCreate={async (opts) => {
          const id = await desk.createRule(opts);
          if (id) goEdit(id);
        }}
      />
    );
  }

  if (screen === "edit" && selected) {
    return (
      <AutomationEditView
        rule={selected}
        state={automationState}
        readOnly={desk.readOnly}
        notice={desk.notice}
        busy={desk.busy}
        preview={desk.preview?.ruleId === selected.id ? desk.preview : null}
        onBack={goList}
        onToggle={(enabled) => void desk.setEnabled(selected.id, enabled)}
        onMarkTested={() => void desk.markTested(selected.id)}
        onMode={(mode) => void desk.setMode(selected.id, mode)}
        onUpdate={(patch) => void desk.updateRule(selected.id, patch)}
        onPreview={(ignoreCap) => void desk.previewAudience(selected.id, ignoreCap)}
        onRunNow={() => void desk.runNow([selected.id])}
        onDelete={async () => {
          const r = await desk.deleteRule(selected.id);
          if (r && r.ok !== false) goList();
        }}
      />
    );
  }

  return (
    <AutomationListView
      state={automationState}
      readOnly={desk.readOnly}
      notice={desk.notice}
      busy={desk.busy}
      onCreate={() => setScreen("create")}
      onEdit={goEdit}
      onRefresh={() => void desk.refresh()}
      onRunNow={() =>
        void desk.runNow(
          automationState.rules.filter((r) => r.enabled).map((r) => r.id),
        )
      }
      onApprove={(id) => void desk.approve(id)}
      onReject={(id) => void desk.reject(id)}
      onSnooze={(id) => void desk.snooze(id, 24)}
    />
  );
}
