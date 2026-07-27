import { redirect } from "next/navigation";

export default function NoticesRedirectPage() {
  redirect("/comms?tab=notices");
}
