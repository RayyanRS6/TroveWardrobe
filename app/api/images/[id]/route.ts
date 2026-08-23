import {
  apiError,
  getImageBucket,
  getOwner,
  getWardrobeDb,
} from "../../../lib/wardrobe-store";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) {
      return new Response("Invalid image", { status: 400 });
    }

    const owner = getOwner(request);
    const db = await getWardrobeDb();
    const row = await db
      .prepare(
        "SELECT image_key, image_type FROM wardrobe_items WHERE id = ? AND owner = ?",
      )
      .bind(id, owner)
      .first<{ image_key: string; image_type: string }>();

    if (!row) return new Response("Image not found", { status: 404 });
    const url = new URL(request.url);
    const requestedWidth = Number(url.searchParams.get("w") || 640);
    const widths = [160, 320, 640, 960, 1600];
    const width = widths.reduce((closest, candidate) =>
      Math.abs(candidate - requestedWidth) < Math.abs(closest - requestedWidth)
        ? candidate
        : closest,
    );
    const shouldTransform = url.searchParams.get("original") !== "1";
    const cache = await caches.open("trove-image-variants-v1");
    const cacheKey = new Request(
      new URL(`/api/images/${id}?w=${width}`, url.origin).toString(),
    );

    if (shouldTransform) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const object = await getImageBucket().get(row.image_key);
    if (!object) return new Response("Image not found", { status: 404 });

    if (shouldTransform) {
      const transformation = await env.IMAGES
        .input(object.body)
        .transform({ width, fit: "scale-down" })
        .output({ format: "image/webp", quality: 82 });
      const transformed = transformation.response();
      const response = new Response(transformed.body, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
          "X-Image-Variant": `${width}w-webp`,
        },
      });
      await cache.put(cacheKey, response.clone());
      return response;
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": row.image_type,
        "Cache-Control": "private, max-age=86400",
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
