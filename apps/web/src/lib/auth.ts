import { cookies } from "next/headers";
import type { Persona } from "./types";

export type DemoSession = {
  persona: Persona;
  fullName: string;
  roleCode: string;
  email?: string;
  /** Linked staff roster id when signed in via Staff → Login */
  staffId?: string;
  /** Linked SIS household when signed in as parent */
  householdId?: string;
  tenantSlug: string;
  academicYearCode: string;
};

const COOKIE = "bhb_demo_session";

export async function getDemoSession(): Promise<DemoSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (raw) {
    try {
      return JSON.parse(decodeURIComponent(raw)) as DemoSession;
    } catch {
      /* ignore */
    }
  }
  return {
    persona: "staff",
    fullName: "Director",
    roleCode: "owner",
    email: "director@bhbinternational.school",
    tenantSlug: "bhb",
    academicYearCode: "2025-26",
  };
}

export function demoSessionCookieName() {
  return COOKIE;
}

export const DEMO_USERS: Record<
  Persona,
  { fullName: string; roleCode: string; email?: string }
> = {
  staff: {
    fullName: "Sujata Bajpayee",
    roleCode: "principal",
    email: "principal@bhbinternational.school",
  },
  parent: {
    fullName: "Ramesh Singh",
    roleCode: "parent",
  },
  field: {
    fullName: "Ramesh Yadav",
    roleCode: "driver",
  },
  student: {
    fullName: "Demo Student",
    roleCode: "student",
  },
};
