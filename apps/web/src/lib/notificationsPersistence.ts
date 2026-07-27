import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadNotifications,
  notificationsIsEmpty,
  writeNotificationsLocalRaw,
  type NotificationsState,
} from "@/lib/notifications";

const blob = createDomainBlobPersistence<NotificationsState>({
  table: "notifications_state",
  metaKey: "bhb_notifications_v1_remote_meta",
  label: "notifications",
  isEmpty: notificationsIsEmpty,
  loadLocal: loadNotifications,
  writeLocalRaw: writeNotificationsLocalRaw,
});

export const scheduleNotificationsSync = blob.scheduleSync;
export const ensureNotificationsHydrated = blob.ensureHydrated;
export const resetNotificationsPersistenceCache = blob.resetCache;
