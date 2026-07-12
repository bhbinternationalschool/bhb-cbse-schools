import { cookies } from "next/headers";
import type { Persona } from "./types";

export type DemoSession = {
  persona: Persona;
  fullName: string;
  roleCode: string;
  email?: string;
  tenantSlug: string;
  academicYearCode: string;
};

const COOKIE = "bhb_demo_session";

export async function getDemoSession(): Promise<DemoSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as DemoSession;
  } catch {
    return null;
  }
}

export function demoSessionCookieName() {
  return COOKIE;
}

export const DEMO_USERS: Record<
  Persona,
  { fullName: string; roleCode: string; email?: string }
> = {
  staff: {
    fullName: "Priya Sharma",
    roleCode: "accounts",
    email: "accounts@bhbinternational.school",
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
