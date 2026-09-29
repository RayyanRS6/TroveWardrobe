import {
  apiError,
  getWardrobeDb,
  imageTag,
  requireOwner,
  thumbTag,
} from "../../../lib/wardrobe-store";
import { getB2Object } from "../../../lib/b2-storage";
import { parseId, RequestError } from "../../../lib/wardrobe-input";

export const dynamic = "force-dynamic";

type PhotoRow = {
  image_key: string;
  image_version: string;
  image_type: string;
  thumb_key: string;
  thumb_version: string;
};

/** True when an If-None-Match header lists this ETag (weak or strong) or "*". */
function matchesEtag(ifNoneMatch: string | null, etag: string) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/**
 * GET /api/images/:id?size=thumb|full&v=<version tag>
 *
 * `v` only busts caches; the ETag is the current version tag, so a matching
 * If-None-Match returns 304 without calling Backblaze.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "photo");
    const size = new URL(request.url).searchParams.get("size") ?? "full";
    if (size !== "full" && size !== "thumb") {
      throw new RequestError(400, 'Photo size must be "thumb" or "full".');
    }

    const db = getWardrobeDb();
    const row = await db
      .prepare(
        `SELECT image_key, image_version, image_type, thumb_key, thumb_version
         FROM wardrobe_items WHERE id = ? AND owner = ?`,
      )
      .bind(id, owner)
      .first<PhotoRow>();
    if (!row) throw new RequestError(404, "Photo not found.");

    // Rows saved before thumbnails existed serve the display photo.
    const thumb = size === "thumb" && Boolean(row.thumb_key);
    const etag = `"${thumb ? thumbTag(row) : imageTag(row)}"`;
    const headers = new Headers({
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    const object = thumb
      ? await getB2Object(row.thumb_key, row.thumb_version)
      : await getB2Object(row.image_key, row.image_version);
    if (!object) throw new RequestError(404, "Photo not found.");

    headers.set("Content-Type", thumb ? "image/webp" : row.image_type);
    const contentLength = object.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(object.body, { headers });
  } catch (error) {
    return apiError(error);
  }
}
