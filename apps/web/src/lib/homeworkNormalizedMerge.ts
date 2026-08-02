import type { HomeworkState } from "@/lib/homework";
import { homeworkReadFromDbEnabled } from "@/lib/homeworkDbConfig";
import type { HomeworkDeskBundle } from "@/lib/homeworkNormalized.server";

export function mergeDbDeskIntoHomeworkState(
  state: HomeworkState,
  bundle: HomeworkDeskBundle,
  opts?: { preferDb?: boolean },
): HomeworkState {
  const hasRemote =
    bundle.posts.length > 0 ||
    bundle.diary.length > 0 ||
    bundle.submissions.length > 0 ||
    bundle.seen.length > 0;
  if (!hasRemote) return state;

  const preferDb = !!opts?.preferDb || homeworkReadFromDbEnabled();
  const takePosts =
    preferDb ||
    (state.posts?.length ?? 0) === 0 ||
    bundle.posts.length >= (state.posts?.length ?? 0);
  const takeDiary =
    preferDb ||
    (state.diary?.length ?? 0) === 0 ||
    bundle.diary.length >= (state.diary?.length ?? 0);

  const postById = new Map<string, HomeworkState["posts"][0]>();
  if (!takePosts) {
    for (const p of state.posts ?? []) postById.set(p.id, p);
  }
  for (const p of bundle.posts) postById.set(p.id, p);
  if (!takePosts) {
    for (const p of state.posts ?? []) {
      if (!postById.has(p.id)) postById.set(p.id, p);
    }
  }

  const diaryById = new Map<string, HomeworkState["diary"][0]>();
  if (!takeDiary) {
    for (const d of state.diary ?? []) diaryById.set(d.id, d);
  }
  for (const d of bundle.diary) diaryById.set(d.id, d);
  if (!takeDiary) {
    for (const d of state.diary ?? []) {
      if (!diaryById.has(d.id)) diaryById.set(d.id, d);
    }
  }

  const submissionById = new Map<string, HomeworkState["submissions"][0]>();
  if (!preferDb) {
    for (const s of state.submissions ?? []) submissionById.set(s.id, s);
  }
  for (const s of bundle.submissions) submissionById.set(s.id, s);
  if (!preferDb) {
    for (const s of state.submissions ?? []) {
      if (!submissionById.has(s.id)) submissionById.set(s.id, s);
    }
  }

  const seenById = new Map<string, HomeworkState["seen"][0]>();
  if (!preferDb) {
    for (const s of state.seen ?? []) seenById.set(s.id, s);
  }
  for (const s of bundle.seen) seenById.set(s.id, s);
  if (!preferDb) {
    for (const s of state.seen ?? []) {
      if (!seenById.has(s.id)) seenById.set(s.id, s);
    }
  }

  return {
    ...state,
    version: 1,
    posts: [...postById.values()],
    diary: [...diaryById.values()],
    submissions: [...submissionById.values()],
    seen: [...seenById.values()],
    settings: bundle.settings ?? state.settings,
  };
}
