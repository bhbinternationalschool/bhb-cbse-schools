import { redirect } from "next/navigation";

export default function NewsRedirectPage() {
  redirect("/comms?tab=news");
}
