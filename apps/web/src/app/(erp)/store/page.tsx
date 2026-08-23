import { redirect } from "next/navigation";

/**
 * The old Store now lives at /inventory.
 *
 * Store and Purchase were one domain built twice, neither of which reached the
 * database — every store_desk_* table was empty in production while the app
 * treated them as truth. Both are replaced by the server-truth module at
 * /inventory. This redirect keeps old links, bookmarks and the mobile app's
 * deep links working.
 */
export default function StoreRedirectPage() {
  redirect("/inventory");
}
