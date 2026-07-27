import { redirect } from "next/navigation";

/** Purchase lives under Store — keep old URL working. */
export default function PurchaseRedirectPage() {
  redirect("/store?tab=purchase");
}
