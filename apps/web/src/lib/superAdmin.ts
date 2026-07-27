/**
 * Protected super-admin emails — full owner access + RBAC configuration.
 * Set PROTECTED_SUPER_ADMIN_EMAILS in server env (comma-separated).
 */

const DEFAULT_SUPER_ADMIN_EMAILS = [
  "director@bhbinternational.school",
  "ashishsingh80@gmail.com",
  "ashu.dube21@gmail.com",
];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse protected super-admin list from env (server) or defaults. */
export function protectedSuperAdminEmails(): string[] {
  const raw = process.env.PROTECTED_SUPER_ADMIN_EMAILS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  const merged = new Set([
    ...DEFAULT_SUPER_ADMIN_EMAILS.map(normalizeEmail),
    ...fromEnv,
  ]);
  return [...merged];
}

export function isProtectedSuperAdminEmail(
  email: string | null | undefined,
): boolean {
  const key = normalizeEmail(email || "");
  if (!key) return false;
  return protectedSuperAdminEmails().includes(key);
}

/** ERP session role code for staff logins. */
export function superAdminRoleCode(
  email: string | null | undefined,
): "owner" | null {
  return isProtectedSuperAdminEmail(email) ? "owner" : null;
}

export function isSuperAdminSession(session: {
  email?: string | null;
  roleCode?: string | null;
}): boolean {
  if (isProtectedSuperAdminEmail(session.email)) return true;
  const rc = (session.roleCode || "").toLowerCase();
  return rc === "owner" || /super.?admin/.test(rc);
}

const SUPER_ADMIN_DISPLAY_NAMES: Record<string, string> = {
  "director@bhbinternational.school": "Director",
  "ashishsingh80@gmail.com": "Ashish Singh",
  "ashu.dube21@gmail.com": "Ashu Dube",
};

/** Demo-auth staff login without a Masters roster row. */
export function superAdminDemoProfile(
  email: string,
): { fullName: string; email: string; roleCode: "owner" } | null {
  const key = normalizeEmail(email);
  if (!isProtectedSuperAdminEmail(key)) return null;
  return {
    fullName:
      SUPER_ADMIN_DISPLAY_NAMES[key] ||
      key
        .split("@")[0]
        .replace(/[._]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    email: key,
    roleCode: "owner",
  };
}
