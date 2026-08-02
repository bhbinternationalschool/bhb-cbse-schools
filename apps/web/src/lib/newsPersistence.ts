/**
 * Standalone news desk hydrate/sync (school_comms_desk_news).
 */

import {
  loadSchoolComms,
  writeSchoolCommsLocalRaw,
} from "@/lib/schoolComms";
import {
  hydrateNewsDeskFromDb,
  scheduleNewsDeskSync,
} from "@/lib/newsNormalizedClient";
import { mergeDbDeskIntoNewsState } from "@/lib/newsNormalizedMerge";
import { newsReadFromDbEnabled } from "@/lib/newsDbConfig";

export { scheduleNewsDeskSync };

export async function ensureNewsHydrated(): Promise<boolean> {
  const readFromDb = newsReadFromDbEnabled();
  const { bundle, changed } = await hydrateNewsDeskFromDb(readFromDb);
  if (!changed || (bundle.news.length === 0 && !readFromDb)) return false;

  writeSchoolCommsLocalRaw(
    mergeDbDeskIntoNewsState(loadSchoolComms(), bundle, {
      preferDb: readFromDb,
    }),
  );
  scheduleNewsDeskSync();
  return true;
}

export async function pushNewsRemoteServer(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const state = loadSchoolComms();
  const { pushNewsDeskToDb } = await import(
    "@/lib/schoolCommsNormalized.server"
  );
  return pushNewsDeskToDb({ news: state.news });
}
