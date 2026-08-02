import type { SchoolCommsState } from "@/lib/schoolComms";
import { newsReadFromDbEnabled } from "@/lib/newsDbConfig";
import type { NewsDeskBundle } from "@/lib/schoolCommsNormalized.server";

export function mergeDbDeskIntoNewsState(
  state: SchoolCommsState,
  bundle: NewsDeskBundle,
  opts?: { preferDb?: boolean },
): SchoolCommsState {
  const hasRemote = bundle.news.length > 0;
  if (!hasRemote && !newsReadFromDbEnabled() && !opts?.preferDb) return state;

  const preferDb = !!opts?.preferDb || newsReadFromDbEnabled();
  const takeNews =
    preferDb ||
    (state.news?.length ?? 0) === 0 ||
    bundle.news.length >= (state.news?.length ?? 0);

  const byId = new Map<string, SchoolCommsState["news"][0]>();
  if (!takeNews) for (const n of state.news ?? []) byId.set(n.id, n);
  for (const n of bundle.news) byId.set(n.id, n);
  if (!takeNews) {
    for (const n of state.news ?? []) {
      if (!byId.has(n.id)) byId.set(n.id, n);
    }
  }

  return {
    ...state,
    version: 1,
    news: [...byId.values()].sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt),
    ),
  };
}
