import type { AdmissionsState } from "@/lib/admissions";
import { admissionsReadFromDbEnabled } from "@/lib/admissionsDbConfig";

export function admissionsReadFromDbFlag(): boolean {
  return admissionsReadFromDbEnabled();
}

function preferRemoteDb(
  localLen: number,
  remoteLen: number,
  preferDb?: boolean,
): boolean {
  return (
    !!preferDb ||
    admissionsReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

export function mergeDbDeskIntoAdmissionsState(
  state: AdmissionsState,
  remote: AdmissionsState,
  opts?: { preferDb?: boolean },
): AdmissionsState {
  const localLeads = state.leads ?? [];
  const remoteLeads = remote.leads ?? [];
  if (!remoteLeads.length && !remote.households?.length) return state;

  const takeLeads = preferRemoteDb(
    localLeads.length,
    remoteLeads.length,
    opts?.preferDb,
  );

  const leadById = new Map<string, (typeof localLeads)[0]>();
  if (!takeLeads) {
    for (const l of localLeads) leadById.set(l.id, l);
  }
  for (const l of remoteLeads) leadById.set(l.id, l);
  if (!takeLeads) {
    for (const l of localLeads) {
      if (!leadById.has(l.id)) leadById.set(l.id, l);
    }
  }

  const takeHouseholds =
    opts?.preferDb ||
    admissionsReadFromDbFlag() ||
    (state.households?.length ?? 0) === 0 ||
    (remote.households?.length ?? 0) > 0;

  const hhById = new Map<string, (typeof state.households)[0]>();
  if (!takeHouseholds) {
    for (const h of state.households ?? []) hhById.set(h.id, h);
  }
  for (const h of remote.households ?? []) hhById.set(h.id, h);
  if (!takeHouseholds) {
    for (const h of state.households ?? []) {
      if (!hhById.has(h.id)) hhById.set(h.id, h);
    }
  }

  const payById = new Map<string, (typeof state.registrationPayments)[0]>();
  for (const p of state.registrationPayments ?? []) payById.set(p.id, p);
  for (const p of remote.registrationPayments ?? []) payById.set(p.id, p);

  return {
    ...state,
    version: 1,
    households: [...hhById.values()],
    leads: [...leadById.values()],
    registrationPayments: [...payById.values()],
    surveyBeats:
      remote.surveyBeats?.length > 0 ? remote.surveyBeats : state.surveyBeats,
    surveyAttendance:
      remote.surveyAttendance?.length > 0
        ? remote.surveyAttendance
        : state.surveyAttendance,
    surveyExternals:
      remote.surveyExternals?.length > 0
        ? remote.surveyExternals
        : state.surveyExternals,
    surveyTeam:
      remote.surveyTeam?.length > 0 ? remote.surveyTeam : state.surveyTeam,
    surveySessions:
      remote.surveySessions?.length > 0
        ? remote.surveySessions
        : state.surveySessions,
    leadCallerStaffIds:
      remote.leadCallerStaffIds?.length > 0
        ? remote.leadCallerStaffIds
        : state.leadCallerStaffIds,
    nextEnquirySeq: remote.nextEnquirySeq ?? state.nextEnquirySeq,
    nextApplicationSeq: remote.nextApplicationSeq ?? state.nextApplicationSeq,
    nextHouseholdSeq: remote.nextHouseholdSeq ?? state.nextHouseholdSeq,
    nextRegPaySeq: remote.nextRegPaySeq ?? state.nextRegPaySeq,
    nextBeatSeq: remote.nextBeatSeq ?? state.nextBeatSeq,
  };
}
