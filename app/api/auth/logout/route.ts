import { clearedSessionCookies } from "../../../lib/auth";
import { apiError, requireOwner } from "../../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

/**
 * Signs this device out: expires the session cookie (both names) and asks
 * the browser to drop cached pages, photos and offline data.
 */
export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Clear-Site-Data": '"cache", "storage"',
    });
    for (const cookie of clearedSessionCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return apiError(error);
  }
}
