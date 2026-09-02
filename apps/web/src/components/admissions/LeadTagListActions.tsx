"use client";

import Link from "next/link";
import type { AdmissionLead } from "@/lib/admissions";

export type LeadTagListActionHandlers = {
  onOpenLead: (leadId: string) => void;
  onOpenStudent?: (studentId: string) => void;
  onRegister?: (leadId: string) => void;
  onVerifyDocs?: (leadId: string) => void;
  onAdmitToSis?: (leadId: string) => void;
  onAssignMe?: (leadId: string) => void;
  onMarkLost?: (leadId: string) => void;
  onVerifyWithSis?: (leadId: string) => void;
  onKeepOpen?: (leadId: string) => void;
  onCloseNotMatch?: (leadId: string) => void;
  agentName?: string;
  canEdit?: boolean;
};

function btn(
  primary?: boolean,
  danger?: boolean,
  teal?: boolean,
): string {
  if (danger) {
    return "rounded-lg border border-[rgba(180,35,24,0.35)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--danger)] hover:bg-[rgba(180,35,24,0.06)]";
  }
  if (teal) {
    return "rounded-lg bg-[#0f766e] px-2 py-1 text-[10px] font-semibold text-white hover:brightness-110";
  }
  if (primary) {
    return "rounded-lg bg-[var(--brand-deep)] px-2 py-1 text-[10px] font-semibold text-white hover:brightness-110";
  }
  return "rounded-lg border border-[rgba(32,48,80,0.18)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]";
}

function waHref(mobile: string): string | null {
  const m = (mobile || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(m)) return null;
  return `https://wa.me/91${m}`;
}

function telHref(mobile: string): string | null {
  const m = (mobile || "").replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  return `tel:+91${m}`;
}

/**
 * Full action strip for any lead shown inside a tag / filter list.
 * Only renders buttons that apply to the lead's current stage / SIS state.
 */
export function LeadTagListActions({
  lead,
  handlers,
  compact,
}: {
  lead: AdmissionLead;
  handlers: LeadTagListActionHandlers;
  compact?: boolean;
}) {
  const canEdit = handlers.canEdit !== false;
  const sid = lead.sisStudentId || lead.studentId;
  const open =
    lead.stage !== "enrolled" && lead.stage !== "lost";
  const suspected = lead.sisMatch === "suspected";
  const admitted = lead.sisMatch === "admitted" || lead.stage === "enrolled";
  const wa = waHref(
    lead.whatsappSame !== false ? lead.mobile : lead.whatsapp || lead.mobile,
  );
  const tel = telHref(lead.mobile);

  return (
    <div
      className={`flex flex-wrap gap-1.5 ${
        compact
          ? ""
          : "mt-2 border-t border-[rgba(32,48,80,0.08)] pt-2"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={btn()}
        onClick={() => handlers.onOpenLead(lead.id)}
      >
        Open lead
      </button>

      {sid && handlers.onOpenStudent ? (
        <button
          type="button"
          className={btn(false, false, true)}
          onClick={() => handlers.onOpenStudent!(sid)}
        >
          SIS profile
        </button>
      ) : null}

      {sid ? (
        <Link
          href={`/students/${sid}/edit`}
          className={btn()}
          onClick={(e) => e.stopPropagation()}
        >
          Student edit →
        </Link>
      ) : null}

      {tel ? (
        <a href={tel} className={btn()} onClick={(e) => e.stopPropagation()}>
          Call
        </a>
      ) : null}

      {wa ? (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className={btn()}
          onClick={(e) => e.stopPropagation()}
        >
          WhatsApp
        </a>
      ) : null}

      {lead.mobile ? (
        <button
          type="button"
          className={btn()}
          onClick={() => {
            void navigator.clipboard?.writeText(lead.mobile);
          }}
          title="Copy mobile"
        >
          Copy mobile
        </button>
      ) : null}

      {canEdit && suspected && handlers.onVerifyWithSis ? (
        <button
          type="button"
          className="rounded-lg bg-[#166534] px-2 py-1 text-[10px] font-semibold text-white hover:brightness-110"
          onClick={() => handlers.onVerifyWithSis!(lead.id)}
          title="Confirm match — update lead from SIS and mark Admitted"
        >
          Verified with SIS
        </button>
      ) : null}

      {canEdit && suspected && handlers.onKeepOpen ? (
        <button
          type="button"
          className={btn()}
          onClick={() => handlers.onKeepOpen!(lead.id)}
        >
          Keep open
        </button>
      ) : null}

      {canEdit && suspected && handlers.onCloseNotMatch ? (
        <button
          type="button"
          className={btn(false, true)}
          onClick={() => handlers.onCloseNotMatch!(lead.id)}
        >
          Close (not SIS)
        </button>
      ) : null}

      {canEdit &&
      open &&
      lead.stage === "enquiry" &&
      handlers.onRegister ? (
        <button
          type="button"
          className={btn(true)}
          onClick={() => handlers.onRegister!(lead.id)}
        >
          → Register
        </button>
      ) : null}

      {canEdit &&
      open &&
      lead.stage === "applied" &&
      handlers.onVerifyDocs ? (
        <button
          type="button"
          className={btn(true)}
          onClick={() => handlers.onVerifyDocs!(lead.id)}
        >
          → Verify docs
        </button>
      ) : null}

      {canEdit &&
      open &&
      (lead.stage === "verified" || lead.stage === "applied") &&
      handlers.onAdmitToSis ? (
        <button
          type="button"
          className={btn(false, false, true)}
          onClick={() => handlers.onAdmitToSis!(lead.id)}
        >
          → Admit to SIS
        </button>
      ) : null}

      {canEdit &&
      open &&
      !lead.assignedTo.trim() &&
      handlers.onAssignMe &&
      handlers.agentName ? (
        <button
          type="button"
          className={btn()}
          onClick={() => handlers.onAssignMe!(lead.id)}
        >
          Assign to me
        </button>
      ) : null}

      {canEdit && open && handlers.onMarkLost && !admitted ? (
        <button
          type="button"
          className={btn(false, true)}
          onClick={() => handlers.onMarkLost!(lead.id)}
        >
          Mark lost
        </button>
      ) : null}
    </div>
  );
}
