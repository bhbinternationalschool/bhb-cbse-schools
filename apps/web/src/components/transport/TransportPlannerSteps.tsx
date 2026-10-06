"use client";

import { useState, type ComponentProps } from "react";
import { BoardingPointAuditPanel } from "@/components/transport/BoardingPointAuditPanel";
import { PinRequestPanel } from "@/components/transport/PinRequestPanel";
import { PinsReceivedPanel } from "@/components/transport/PinsReceivedPanel";
import { TransportPlannerPanel } from "@/components/transport/TransportPlannerPanel";
import { StepTabs, type StepDef } from "@/components/ui/StepTabs";

type PlannerStep = "ask" | "review" | "audit" | "plan";

/**
 * Asking comes first because every later step can only be as good as where a
 * family is placed: with no family placed better than a village centroid the
 * audit's noise floor is a kilometre, and the planner suggests stops from the
 * same locations. Review what came back, then audit the boarding points, then
 * plan routes and place students on the better picture.
 */
const PLANNER_STEPS: StepDef<PlannerStep>[] = [
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
  const [step, setStep] = useState<PlannerStep>("ask");
  return (
    <StepTabs
      className="mt-4"
      aria-label="Transport planner steps"
      steps={PLANNER_STEPS}
      value={step}
      onChange={setStep}
    >
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
