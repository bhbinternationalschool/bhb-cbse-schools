import { redirect } from "next/navigation";

/** Student leave lives under Attendance — keep old URL working. */
export default function StudentLeaveRedirectPage() {
  redirect("/attendance?tab=leave");
}
