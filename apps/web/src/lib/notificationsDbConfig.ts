export function notificationsDualWriteDbEnabled(): boolean {
  const flag = process.env.NOTIFICATIONS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function notificationsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_NOTIFICATIONS_READ_FROM_DB === "true";
  }
  return process.env.NOTIFICATIONS_READ_FROM_DB === "true";
}
