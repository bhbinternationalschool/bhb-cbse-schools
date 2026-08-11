"use client";

import { useState } from "react";
import {
  updateTemplateLocal,
} from "@/lib/waTemplates";
import { WaTemplatesListView } from "./wa-templates/WaTemplatesListView";
import { WaTemplatesCreateView } from "./wa-templates/WaTemplatesCreateView";
import { WaTemplatesEditView } from "./wa-templates/WaTemplatesEditView";
import { WaAccountHealthCard } from "./wa-templates/WaAccountHealthCard";
import { useWaTemplatesDesk } from "./wa-templates/useWaTemplatesDesk";

type Screen = "list" | "create" | "edit";

export function WaTemplatesPanel() {
  const desk = useWaTemplatesDesk();
  const [screen, setScreen] = useState<Screen>("list");
  const [editId, setEditId] = useState<string | null>(null);

  if (!desk.state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading WhatsApp templates…</p>
    );
  }

  const selected =
    editId != null
      ? desk.state.templates.find((t) => t.id === editId) || null
      : null;

  function goList() {
    setScreen("list");
    setEditId(null);
  }

  function goEdit(id: string) {
    setEditId(id);
    setScreen("edit");
  }

  async function onCreateAndSubmit(
    nextState: typeof desk.state,
    templateId: string,
  ) {
    if (!nextState) return;
    if (!desk.commit(nextState, "Draft created")) return;
    const ok = await desk.submitMeta(templateId, nextState);
    if (ok) goList();
  }

  if (screen === "create") {
    return (
      <WaTemplatesCreateView
        state={desk.state}
        readOnly={desk.readOnly}
        notice={desk.notice}
        submitting={desk.submitting}
        sessionName={desk.session.fullName || "masters"}
        onBack={goList}
        onCreateAndSubmit={onCreateAndSubmit}
      />
    );
  }

  if (screen === "edit") {
    if (!selected) {
      return (
        <WaTemplatesListView
          state={desk.state}
          readOnly={desk.readOnly}
          notice={desk.notice}
          syncing={desk.syncing}
          onSyncMeta={() => void desk.syncMeta()}
          onCreate={() => setScreen("create")}
          onEdit={goEdit}
        />
      );
    }
    return (
      <WaTemplatesEditView
        template={selected}
        readOnly={desk.readOnly}
        notice={desk.notice}
        submitting={desk.submitting}
        onBack={goList}
        onSave={(patch, msg) => {
          desk.commit(
            updateTemplateLocal(
              desk.state!,
              selected.id,
              patch,
              desk.session.fullName || "masters",
            ),
            msg,
          );
        }}
        onSubmitMeta={() => void desk.submitMeta(selected.id)}
      />
    );
  }

  return (
    <>
      <WaAccountHealthCard />
      <WaTemplatesListView
        state={desk.state}
        readOnly={desk.readOnly}
        notice={desk.notice}
        syncing={desk.syncing}
        onSyncMeta={() => void desk.syncMeta()}
        onCreate={() => setScreen("create")}
        onEdit={goEdit}
      />
    </>
  );
}
