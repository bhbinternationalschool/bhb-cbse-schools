import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { familyShelfLabels, readLibraryEbooks } from "@/lib/libraryEbooks.server";
import { ebookAccess, keyForBook } from "@/lib/ebookAccess.server";
import {
  shelvesForClasses,
  bookcaseCode,
  normalizeEbook,
  type LibraryEbook,
  type LibraryState,
} from "@/lib/library";

export const runtime = "nodejs";

/**
 * GET /api/v1/library/ebooks
 *
 * The school's e-book shelf, with the pass key, for a signed-in reader.
 *
 * The key is the whole reason this endpoint exists rather than a public page.
 * Anyone holding it holds the shelf, so it is returned only in the response to
 * a request carrying a parent, student or staff session — never rendered into
 * a public page, never inlined into the client bundle through a NEXT_PUBLIC_
 * variable, and never stored on the desk slice that syncs to every browser.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const persona = ctx.session.persona;
    if (persona !== "parent" && persona !== "student" && persona !== "staff") {
      throw new ApiError("forbidden", "Sign in to see the school's e-books", 403);
    }

    const access = ebookAccess();
    if (!access.configured) {
      // Said plainly rather than returning an empty shelf: "no books" and
      // "nobody set this up" send the office to completely different places.
      return apiOk({
        configured: false,
        missing: access.missing,
        shelfUrl: access.shelfUrl || null,
        books: [],
        note: "The e-book shelf is not configured yet. Set EBOOK_SHELF_URL and EBOOK_SHELF_KEY on the server.",
      });
    }

    // The shelves' own server store (12 Oct 2026). The library blob this
    // used to read had held no e-books since 5 Aug — the desk save never
    // wrote them — so parents saw an empty shelf.
    const stored = await readLibraryEbooks();
    if (!stored) throw new ApiError("server_error", "Could not read the e-book shelves — try again", 503);
    // A family sees its children's classes' shelves (12 Oct 2026); staff,
    // and a family whose classes cannot be read, see every shelf.
    const labels =
      persona !== "staff" && ctx.session.householdId
        ? await familyShelfLabels(ctx.session.householdId, ctx.session.academicYearCode || "", ctx.masters.classes ?? [])
        : null;
    const raw = shelvesForClasses(stored, labels);
    const books = (raw as Partial<LibraryEbook>[])
      .map(normalizeEbook)
      .filter((b) => b.isActive)
      .map((b) => {
        const k = keyForBook(b.keyKind, access);
        const code = bookcaseCode(b.url);
        return {
          id: b.id,
          // An untitled shelf shows its bookcase code, not a blank line the
          // reader cannot tell apart from the next blank line. `needsTitle`
          // lets the staff screen flag exactly these for naming.
          title: b.title || `Untitled shelf (${code || "?"})`,
          needsTitle: b.title.trim().length === 0,
          author: b.author,
          subject: b.subject,
          classLabels: b.classLabels,
          // A book with no direct link falls back to the shelf front page,
          // which is where it actually lives.
          url: b.url || access.shelfUrl,
          passKey: k.key,
          passKeyLabel: k.label,
        };
      })
      .sort(
        (a, b) =>
          a.subject.localeCompare(b.subject) || a.title.localeCompare(b.title),
      );

    return apiOk({
      configured: true,
      shelfUrl: access.shelfUrl,
      shelfKey: access.shelfKey,
      books,
      // Zero books with a working shelf is a real state — the catalogue is
      // empty, but the shelf link still works.
      catalogued: books.length,
    });
  } catch (e) {
    return apiErr(e);
  }
}
