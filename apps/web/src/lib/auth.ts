import { cookies } from "next/headers";
import { verifySessionCookie } from "./sessionCookie.server";
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

/**
 * Resolve the signed session cookie.
 *
 * Returns null for a missing, malformed, unsigned (legacy), or tampered
 * cookie — never a fallback identity. The role carried here is trusted
 * for authorization, so it must only ever come from a value this server
 * signed itself.
 */
export async function getDemoSession(): Promise<DemoSession | null> {
  const store = await cookies();
  return verifySessionCookie(store.get(COOKIE)?.value);
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
