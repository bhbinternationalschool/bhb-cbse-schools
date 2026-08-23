/**
 * The e-book shelf's pass keys.
 *
 * Server-only, and read from the environment — never from a desk slice and
 * never from a NEXT_PUBLIC_ variable.
 *
 * Both of those alternatives leak it. Desk slices sync down to the browser
 * and sit in localStorage, readable by anyone who opens the page. NEXT_PUBLIC_
 * values are inlined into the JavaScript bundle at build time and served to
 * every visitor, signed in or not — putting a shared pass key there is the
 * same as printing it on the home page.
 *
 * So the key never reaches a browser except in the response to a request that
 * carried a valid parent or student session, and it is never committed: it
 * belongs in Secret Manager beside SARVAM_API_KEY and GMAIL_SA_KEY_JSON.
 */

export type EbookAccess = {
  shelfUrl: string;
  /** Key for the bookcase as a whole. Empty when not configured. */
  shelfKey: string;
  /** Key for an individual book, when the provider uses a separate one. */
  bookKey: string;
  configured: boolean;
  /** What the office still has to set, in words. */
  missing: string[];
};

export function ebookAccess(): EbookAccess {
  const shelfUrl = (process.env.EBOOK_SHELF_URL || "").trim();
  const shelfKey = (process.env.EBOOK_SHELF_KEY || "").trim();
  const bookKey = (process.env.EBOOK_BOOK_KEY || "").trim();

  const missing: string[] = [];
  if (!shelfUrl) missing.push("EBOOK_SHELF_URL");
  if (!shelfKey) missing.push("EBOOK_SHELF_KEY");

  return {
    shelfUrl,
    shelfKey,
    bookKey,
    // The book key is optional — some shelves use one key for everything.
    // The shelf URL and key are not: without them there is nothing to open.
    configured: Boolean(shelfUrl && shelfKey),
    missing,
  };
}

/**
 * Which key a reader needs for a given book, resolved for display.
 *
 * Returns the empty string rather than a placeholder when a key is not
 * configured. A screen showing "—" where a password should be at least sends
 * the parent to the office; a screen showing a wrong key sends them to a
 * password box that rejects them, which they will read as the school's fault.
 */
export function keyForBook(
  keyKind: "book" | "shelf" | "none",
  access: EbookAccess,
): { key: string; label: string } {
  if (keyKind === "none") return { key: "", label: "No password needed" };
  if (keyKind === "book") {
    return access.bookKey
      ? { key: access.bookKey, label: "Book password" }
      : { key: "", label: "Book password not set — ask the school office" };
  }
  return access.shelfKey
    ? { key: access.shelfKey, label: "Shelf password" }
    : { key: "", label: "Shelf password not set — ask the school office" };
}
