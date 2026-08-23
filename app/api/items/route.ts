import {
  apiError,
  getImageBucket,
  getOwner,
  getWardrobeDb,
  itemResponse,
  type WardrobeItemRow,
} from "../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = getOwner(request);
    const db = await getWardrobeDb();
    const result = await db
      .prepare(
        `SELECT id, owner, name, category, color, season, image_key, image_type, created_at
         FROM wardrobe_items
         WHERE owner = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(owner)
      .all<WardrobeItemRow>();

    return Response.json({ items: result.results.map(itemResponse) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let storedKey: string | null = null;

  try {
    const owner = getOwner(request);
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const color = String(form.get("color") ?? "").trim();
    const season = String(form.get("season") ?? "All season").trim();
    const image = form.get("image");

    if (!name || !category) {
      return Response.json(
        { error: "Name and category are required." },
        { status: 400 },
      );
    }

    if (category.length > 40 || color.length > 30 || season.length > 30) {
      return Response.json({ error: "One of the details is too long." }, { status: 400 });
    }

    if (
      !(image instanceof File) ||
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(image.type)
    ) {
      return Response.json(
        { error: "Please choose a JPG, PNG, WebP, or AVIF clothing image." },
        { status: 400 },
      );
    }

    if (image.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: "Please use an image smaller than 10 MB." },
        { status: 400 },
      );
    }

    const extension =
      image.type === "image/webp"
        ? "webp"
        : image.type === "image/png"
          ? "png"
          : "jpg";
    storedKey = `${crypto.randomUUID()}.${extension}`;

    const bucket = getImageBucket();
    await bucket.put(storedKey, image.stream(), {
      httpMetadata: { contentType: image.type },
      customMetadata: { owner },
    });

    const db = await getWardrobeDb();
    await db
      .prepare(
        "INSERT OR IGNORE INTO wardrobe_categories (owner, name) VALUES (?, ?)",
      )
      .bind(owner, category)
      .run();
    const row = await db
      .prepare(
        `INSERT INTO wardrobe_items
          (owner, name, category, color, season, image_key, image_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id, owner, name, category, color, season, image_key, image_type, created_at`,
      )
      .bind(owner, name, category, color, season, storedKey, image.type)
      .first<WardrobeItemRow>();

    if (!row) throw new Error("The clothing item could not be saved.");
    return Response.json({ item: itemResponse(row) }, { status: 201 });
  } catch (error) {
    if (storedKey) {
      try {
        await getImageBucket().delete(storedKey);
      } catch {
        // Keep the original failure as the useful response.
      }
    }
    return apiError(error);
  }
}
