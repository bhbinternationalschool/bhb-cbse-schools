"use client";

import { useState, type ComponentProps } from "react";
import { BoardingPointAuditPanel } from "@/components/transport/BoardingPointAuditPanel";
import { PinRequestPanel } from "@/components/transport/PinRequestPanel";
import { TransportGapsPanel } from "@/components/transport/TransportGapsPanel";
import { TransportRunOrdersPanel } from "@/components/transport/TransportRunOrdersPanel";
import { PinsReceivedPanel } from "@/components/transport/PinsReceivedPanel";
import { TransportPlannerPanel } from "@/components/transport/TransportPlannerPanel";
import { StepTabs, type StepDef } from "@/components/ui/StepTabs";

type PlannerStep = "gaps" | "runs" | "ask" | "review" | "audit" | "plan";

/**
 * Asking comes first because every later step can only be as good as where a
 * family is placed: with no family placed better than a village centroid the
 * audit's noise floor is a kilometre, and the planner suggests stops from the
 * same locations. Review what came back, then audit the boarding points, then
 * plan routes and place students on the better picture.
 */
const PLANNER_STEPS: StepDef<PlannerStep>[] = [
  {
    id: "gaps",
    title: "Gaps to settle",
    what: "Where the records and the buses' GPS disagree — fee gaps shown side by side, nothing changed until the office decides.",
  },
  {
    id: "runs",
    title: "Stop order & ride times",
    what: "Each run's stops in the order the bus really reaches them, and first-picked-first-dropped suggestions for drop runs.",
  },
  {
    id: "ask",
    title: "Ask families for pins",
    what: "Send families a WhatsApp asking where their child waits for the bus — preview who gets one, then send.",
  },
  {
    id: "review",
    title: "Review pins",
    what: "See where each pin landed, which children it was saved to, and how it compares with their stop and home.",
  },
  {
    id: "audit",
    title: "Boarding-point audit",
    what: "Riders whose home is closer to a different stop on the same bus — nothing changes here, the office decides each one.",
  },
  {
    id: "plan",
    title: "Plan routes & place students",
    what: "Route suggestions from SIS locality, align buses to routes, and assign unplaced students with a fee preview.",
  },
];

/**
 * Transport → Planner as numbered steps. Every panel keeps its own state
 * (selections, previews, filters), so inactive steps are hidden, never
 * unmounted — switching steps loses nothing.
 */
export function TransportPlannerSteps({
  canEdit,
  academicYearCode,
  ...plannerProps
}: Omit<ComponentProps<typeof TransportPlannerPanel>, "academicYearCode"> & {
  academicYearCode: string;
  canEdit: boolean;
}) {
  const [step, setStep] = useState<PlannerStep>("gaps");
  return (
    <StepTabs
      className="mt-4"
      aria-label="Transport planner steps"
      steps={PLANNER_STEPS}
      value={step}
      onChange={setStep}
    >
      <div className={step === "gaps" ? "" : "hidden"}>
        <TransportGapsPanel canEdit={canEdit} />
      </div>
      <div className={step === "runs" ? "" : "hidden"}>
        <TransportRunOrdersPanel canEdit={canEdit} />
      </div>
      <div className={step === "ask" ? "" : "hidden"}>
        <PinRequestPanel canEdit={canEdit} />
      </div>
      <div className={step === "review" ? "" : "hidden"}>
        <PinsReceivedPanel />
      </div>
      <div className={step === "audit" ? "" : "hidden"}>
        <BoardingPointAuditPanel academicYearCode={academicYearCode} canEdit={canEdit} />
      </div>
      <div className={step === "plan" ? "" : "hidden"}>
        <TransportPlannerPanel academicYearCode={academicYearCode} {...plannerProps} />
      </div>
    </StepTabs>
  );
}
