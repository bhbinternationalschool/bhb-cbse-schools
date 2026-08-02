/**
 * Notifications remote sync — jsonb blob on notifications_state + normalized desk.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadNotifications,
  notificationsIsEmpty,
  writeNotificationsLocalRaw,
  type NotificationsState,
} from "@/lib/notifications";
import {
  hydrateNotificationsDeskFromDb,
  scheduleNotificationsDeskSync,
} from "@/lib/notificationsNormalizedClient";
import { mergeDbDeskIntoNotificationsState } from "@/lib/notificationsNormalizedMerge";
import { notificationsReadFromDbEnabled } from "@/lib/notificationsDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";

const blob = createDomainBlobPersistence<NotificationsState>({
  table: "notifications_state",
  metaKey: "bhb_notifications_v1_remote_meta",
  label: "notifications",
  isEmpty: notificationsIsEmpty,
  loadLocal: loadNotifications,
  writeLocalRaw: writeNotificationsLocalRaw,
});

export const notificationsRemoteEnabled = blob.remoteEnabled;
export const resetNotificationsPersistenceCache = blob.resetCache;

export function scheduleNotificationsSync(state: NotificationsState) {
  if (typeof window === "undefined") {
    void pushNotificationsRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("notifications")) blob.scheduleSync(state);
  scheduleNotificationsDeskSync(state);
}

export async function pushNotificationsRemoteServer(
  state: NotificationsState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushNotificationsDeskToDb } = await import(
    "@/lib/notificationsNormalized.server"
  );
  const desk = await pushNotificationsDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("notifications")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<NotificationsState>("notifications_state");
  const remoteItems = remote.state?.items?.length ?? 0;
  const nextItems = state.items?.length ?? 0;
  if (nextItems < remoteItems && remote.state) return { ok: true };

  return pushServerBlob("notifications_state", state);
}

export async function ensureNotificationsHydrated(): Promise<boolean> {
  const readFromDb = notificationsReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("notifications")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateNotificationsDeskFromDb(readFromDb);
  if (changed && (bundle.items.length > 0 || readFromDb)) {
    writeNotificationsLocalRaw(
      mergeDbDeskIntoNotificationsState(loadNotifications(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleNotificationsSync(loadNotifications());
  return blobChanged || normChanged;
}

export async function ensureNotificationsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchNotificationsDeskFromDb } = await import(
    "@/lib/notificationsNormalized.server"
  );
  const { notificationsReadFromDbEnabled } = await import(
    "@/lib/notificationsDbConfig"
  );
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadNotifications();
  let changed = false;

  if (!deskSkipBlobPush("notifications")) {
    const remoteBlob = await fetchServerBlob<NotificationsState>(
      "notifications_state",
    );
    if (
      remoteBlob.state &&
      !notificationsReadFromDbEnabled() &&
      !notificationsIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchNotificationsDeskFromDb();
  if (dbDesk.bundle.items.length > 0 || notificationsReadFromDbEnabled()) {
    state = mergeDbDeskIntoNotificationsState(state, dbDesk.bundle, {
      preferDb:
        notificationsReadFromDbEnabled() || (state.items?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeNotificationsLocalRaw(state);
  return changed;
}
