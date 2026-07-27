import { redirect } from "next/navigation";

export default function GalleryRedirectPage() {
  redirect("/comms?tab=gallery");
}
