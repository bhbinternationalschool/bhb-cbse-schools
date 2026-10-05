import type { Metadata } from "next";
import { SurveyDayApp } from "@/components/field/SurveyDayApp";

export const metadata: Metadata = { title: "Field survey" };

/**
 * /survey-day — the surveyor's day on their own phone. No ERP sign-in: the
 * phone's registered key is who they are (outside surveyors have no login).
 */
export default function SurveyDayPage() {
  return <SurveyDayApp />;
}
