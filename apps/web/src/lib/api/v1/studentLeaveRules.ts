import { leaveDayCount } from "@/lib/studentLeave";

/** Over 3 days, medical or long leave is the principal's call, not the class teacher's. */
export function needsLeadership(req: { fromDate: string; toDate: string; leaveType: string }): boolean {
  return leaveDayCount(req) > 3 || req.leaveType === "ML" || req.leaveType === "LL";
}
