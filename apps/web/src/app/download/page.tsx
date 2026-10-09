import { redirect } from "next/navigation";

/**
 * The old download page. Links to it are in WhatsApp chats and printed
 * notices, so it stays — as a pointer to /downloads, which installs the staff
 * app like a store app and still offers the parent and transport APKs.
 */
export default function DownloadPage() {
  redirect("/downloads");
}
