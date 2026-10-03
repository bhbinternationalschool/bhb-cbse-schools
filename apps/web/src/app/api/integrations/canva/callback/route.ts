import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDemoSession } from "@/lib/auth";
import { appBase, completeCanvaConnect } from "@/lib/canva.server";

export const runtime = "nodejs";

const COOKIE = "bhb_canva_oauth";

/** Canva sends the school's grant here; the result lands back on Students → Birthdays. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const saved = jar.get(COOKIE)?.value || "";
  jar.delete(COOKIE);
  const [expectedState, verifier] = saved.split(".");

  const back = (q: string) => NextResponse.redirect(`${appBase()}/students?tab=birthdays&${q}`);
  if (oauthError) return back(`canva_error=${encodeURIComponent(oauthError)}`);
  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return back(`canva_error=${encodeURIComponent("Invalid sign-in state — press Connect again")}`);
  }
  const session = await getDemoSession().catch(() => null);
  const by = session && session.persona === "staff" ? session.email || "" : "";
  try {
    await completeCanvaConnect(code, verifier, by);
  } catch (e) {
    return back(`canva_error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
  return back("canva=connected");
}
