import { redirect } from "next/navigation";

/** RTE / EWS lives under Admissions — keep old URL working. */
export default function RteRedirectPage() {
  redirect("/admissions?tab=rte");
}
