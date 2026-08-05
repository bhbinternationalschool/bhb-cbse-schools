"use client";

import { useState } from "react";
import {
  deleteWaChatbotFlow,
  duplicateWaChatbotFlow,
  updateWaChatbotFlow,
} from "@/lib/waChatbotFlows";
import { WaChatbotListView } from "./wa-chatbot/WaChatbotListView";
import { WaChatbotCreateView } from "./wa-chatbot/WaChatbotCreateView";
import { WaChatbotEditView } from "./wa-chatbot/WaChatbotEditView";
import { useWaChatbotDesk } from "./wa-chatbot/useWaChatbotDesk";

type Screen = "list" | "create" | "edit";

export function WaChatbotPanel() {
  const desk = useWaChatbotDesk();
  const [screen, setScreen] = useState<Screen>("list");
  const [editId, setEditId] = useState<string | null>(null);

  if (!desk.state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading WhatsApp chatbots…</p>
    );
  }

  const selected =
    editId != null
      ? desk.state.flows.find((f) => f.id === editId) || null
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
      <WaChatbotCreateView
        state={desk.state}
        readOnly={desk.readOnly}
        notice={desk.notice}
        onBack={goList}
        onCreated={(next, flowId) => {
          desk.commit(next, "Chatbot created");
          goEdit(flowId);
        }}
      />
    );
  }

  if (screen === "edit" && selected) {
    return (
      <WaChatbotEditView
        flow={selected}
        readOnly={desk.readOnly}
        notice={desk.notice}
        onBack={goList}
        onSave={(patch) => {
          desk.commit(
            updateWaChatbotFlow(desk.state!, selected.id, patch),
            "Saved",
          );
        }}
        onDelete={
          selected.status !== "built_in"
            ? () => {
                desk.commit(
                  deleteWaChatbotFlow(desk.state!, selected.id),
                  "Deleted",
                );
                goList();
              }
            : undefined
        }
      />
    );
  }

  return (
    <WaChatbotListView
      state={desk.state}
      readOnly={desk.readOnly}
      notice={desk.notice}
      onCreate={() => setScreen("create")}
      onEdit={goEdit}
      onDuplicate={(id) => {
        const dup = duplicateWaChatbotFlow(desk.state!, id);
        if (!dup) return;
        desk.commit(dup.state, "Duplicated — open to edit");
        goEdit(dup.flow.id);
      }}
    />
  );
}
