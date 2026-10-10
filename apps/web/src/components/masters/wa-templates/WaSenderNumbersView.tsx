"use client";

import { useState } from "react";
import {
  WA_TEMPLATE_MODULES,
  resolveSenderNumber,
  templateFamilyReady,
  type WaSenderNumber,
  type WaTemplateModule,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { waBtnPrimary, waBtnTeal } from "./waTemplateUi";

/**
 * The school's WhatsApp numbers, and which module sends from which.
 *
 * Templates are registered against the WABA rather than a number, so every
 * number here can send every approved template. Routing is the school's
 * decision, and it is made per MODULE — fees from one number, admissions from
 * another — because that is how staff describe it, and because setting a
 * number on each of sixty-seven templates is sixty-seven chances to forget
 * one. A single template can still override, from its own edit screen.
 */
export function WaSenderNumbersView({
  state,
  readOnly,
  onBack,
  onCommit,
}: {
  state: WaTemplatesState;
  readOnly: boolean;
  onBack: () => void;
  onCommit: (next: WaTemplatesState, msg?: string) => boolean;
}) {
  const senders = state.senders ?? [];
  const [label, setLabel] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayNumber, setDisplayNumber] = useState("");

  function save(next: WaSenderNumber[], msg: string) {
    onCommit({ ...state, senders: next }, msg);
  }

  function add() {
    const id = `was_${Math.random().toString(36).slice(2, 10)}`;
    const clean = phoneNumberId.trim();
    if (!clean) return;
    save(
      [
        ...senders,
        {
          id,
          label: label.trim() || clean,
          phoneNumberId: clean,
          displayNumber: displayNumber.trim(),
          // The first number added becomes the default; after that the
          // school picks deliberately.
          isDefault: senders.length === 0,
          paused: false,
        },
      ],
      "Number added",
    );
    setLabel("");
    setPhoneNumberId("");
    setDisplayNumber("");
  }

  function makeDefault(id: string) {
    save(
      senders.map((s) => ({ ...s, isDefault: s.id === id })),
      "Default number changed",
    );
  }

  function togglePause(id: string) {
    save(
      senders.map((s) => (s.id === id ? { ...s, paused: !s.paused } : s)),
      "Number updated",
    );
  }

  function setModuleSender(module: WaTemplateModule, senderId: string) {
    const next = { ...(state.moduleSenders ?? {}) };
    if (senderId) next[module] = senderId;
    else delete next[module];
    onCommit({ ...state, moduleSenders: next }, `${module} routing saved`);
  }

  /** Families where only one language is approved — these cannot send at all. */
  const halfApproved = [
    ...new Set(state.templates.map((t) => t.familyKey)),
  ].filter((f) => !templateFamilyReady(state, f).ready);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">WhatsApp numbers</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every number here can send every approved template — Meta registers
            templates against the business account, not a number. What you
            choose below is which number a family sees.
          </p>
        </div>
        <button type="button" className={waBtnTeal} onClick={onBack}>
          Back to templates
        </button>
      </div>

      {senders.length === 0 ? (
        <p className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-3 text-sm">
          No numbers added yet, so everything sends from the single number
          configured on the server. Adding one here changes nothing until you
          route a module to it.
        </p>
      ) : null}

      <div className="space-y-2">
        {senders.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3"
          >
            <div className="min-w-[12rem] flex-1">
              <div className="font-medium">
                {s.label}
                {s.isDefault ? (
                  <span className="ml-2 rounded bg-[var(--success-soft)] px-2 py-0.5 text-xs text-[var(--success)]">
                    default
                  </span>
                ) : null}
                {s.paused ? (
                  <span className="ml-2 rounded bg-[var(--danger-soft)] px-2 py-0.5 text-xs text-[var(--danger)]">
                    paused
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {s.displayNumber || "—"} · id {s.phoneNumberId}
              </div>
            </div>
            <button
              type="button"
              disabled={readOnly || s.isDefault || s.paused}
              className={waBtnTeal}
              onClick={() => makeDefault(s.id)}
            >
              Make default
            </button>
            <button
              type="button"
              disabled={readOnly || s.isDefault}
              className={waBtnTeal}
              onClick={() => togglePause(s.id)}
              title={
                s.isDefault
                  ? "Make another number the default before pausing this one"
                  : undefined
              }
            >
              {s.paused ? "Resume" : "Pause"}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <h4 className="text-sm font-semibold">Add a number</h4>
        <p className="mt-1 text-xs text-[var(--muted)]">
          The phone number id comes from Meta — WhatsApp Manager → your number →
          API. It is not the phone number itself.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="field"
            placeholder="Label (Office, Fees counter…)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={readOnly}
          />
          <input
            className="field"
            placeholder="Meta phone number id"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            disabled={readOnly}
          />
          <input
            className="field"
            placeholder="Number shown to staff (+91…)"
            value={displayNumber}
            onChange={(e) => setDisplayNumber(e.target.value)}
            disabled={readOnly}
          />
          <button
            type="button"
            className={waBtnPrimary}
            disabled={readOnly || !phoneNumberId.trim()}
            onClick={add}
          >
            Add
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <h4 className="text-sm font-semibold">Which module sends from which</h4>
        <p className="mt-1 text-xs text-[var(--muted)]">
          A module left on “Default” uses the default number. One template can
          still override its module, from that template’s own screen.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {WA_TEMPLATE_MODULES.map((m) => {
            const chosen = state.moduleSenders?.[m] ?? "";
            const effective = resolveSenderNumber(state, {
              module: m,
              senderNumberId: "",
            });
            return (
              <label key={m} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 capitalize">{m}</span>
                <select
                  className="field flex-1"
                  value={chosen}
                  disabled={readOnly}
                  onChange={(e) => setModuleSender(m, e.target.value)}
                >
                  <option value="">
                    Default{effective ? ` (${effective.label})` : ""}
                  </option>
                  {senders
                    .filter((s) => !s.paused)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>

      {halfApproved.length > 0 ? (
        <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm">
          <strong>
            {halfApproved.length} template{halfApproved.length === 1 ? "" : "s"}{" "}
            cannot send
          </strong>{" "}
          — approved in one language only. The school writes to a family in the
          language that family chose, so a template is used only when both
          Hindi and English are approved. Sending the half that exists is how
          one family’s language becomes everybody’s.
          <div className="mt-2 text-xs">{halfApproved.join(", ")}</div>
        </div>
      ) : null}
    </section>
  );
}
