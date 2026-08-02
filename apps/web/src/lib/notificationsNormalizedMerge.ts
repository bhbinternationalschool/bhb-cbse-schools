import type { NotificationsState } from "@/lib/notifications";
import { notificationsReadFromDbEnabled } from "@/lib/notificationsDbConfig";
import type { NotificationsDeskBundle } from "@/lib/notificationsNormalized.server";

export function mergeDbDeskIntoNotificationsState(
  state: NotificationsState,
  bundle: NotificationsDeskBundle,
  opts?: { preferDb?: boolean },
): NotificationsState {
  const hasRemote = bundle.items.length > 0;
  if (!hasRemote && !notificationsReadFromDbEnabled() && !opts?.preferDb) {
    return state;
  }

  const preferDb = !!opts?.preferDb || notificationsReadFromDbEnabled();
  const takeItems =
    preferDb ||
    (state.items?.length ?? 0) === 0 ||
    bundle.items.length >= (state.items?.length ?? 0);

  const byId = new Map<string, NotificationsState["items"][0]>();
  if (!takeItems) {
    for (const n of state.items ?? []) byId.set(n.id, n);
  }
  for (const n of bundle.items) byId.set(n.id, n);
  if (!takeItems) {
    for (const n of state.items ?? []) {
      if (!byId.has(n.id)) byId.set(n.id, n);
    }
  }

  return {
    version: 1,
    items: [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}
