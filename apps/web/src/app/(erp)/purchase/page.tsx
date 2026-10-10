import { redirect } from "next/navigation";

/** Purchase is a section of the Store & purchase module now. */
export default function PurchaseRedirectPage() {
  redirect("/inventory?tab=purchase");
}
