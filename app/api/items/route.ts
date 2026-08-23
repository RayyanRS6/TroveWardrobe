import {
  apiError,
  getOwner,
  getWardrobeDb,
  itemResponse,
  type WardrobeItemRow,
} from "../../lib/wardrobe-store";
import {
  deleteB2Object,
  getB2StorageLimitBytes,
  putB2Object,
} from "../../lib/b2-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = getOwner(request);
    const db = getWardrobeDb();
    const result = await db
      .prepare(
        `SELECT id, name, category, color, season, image_key
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
  let uploadedKey: string | null = null;
  let uploadedVersion = "";

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

    if (!(image instanceof File)) {
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

    const imageBytes = await image.arrayBuffer();
    const detectedImage = detectImageType(new Uint8Array(imageBytes));
    if (!detectedImage) {
      return Response.json(
        { error: "The selected file is not a valid JPG, PNG, WebP, or AVIF image." },
        { status: 400 },
      );
    }

    const db = getWardrobeDb();
    const usage = await db
      .prepare("SELECT COALESCE(SUM(image_size), 0) AS bytes_used FROM wardrobe_items")
      .first<{ bytes_used: number }>();
    const storageLimit = getB2StorageLimitBytes();
    if ((usage?.bytes_used ?? 0) + imageBytes.byteLength > storageLimit) {
      return Response.json(
        { error: "Your free image-storage safety limit has been reached." },
        { status: 507 },
      );
    }

    const storedKey = `clothes/${crypto.randomUUID()}.${detectedImage.extension}`;
    const imageVersion = await putB2Object(
      storedKey,
      imageBytes,
      detectedImage.contentType,
    );
    uploadedKey = storedKey;
    uploadedVersion = imageVersion;

    await db
      .prepare(
        "INSERT OR IGNORE INTO wardrobe_categories (owner, name) VALUES (?, ?)",
      )
      .bind(owner, category)
      .run();
    const row = await db
      .prepare(
        `INSERT INTO wardrobe_items
          (owner, name, category, color, season, image_key, image_version, image_type, image_size)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (
           SELECT COALESCE(SUM(image_size), 0)
           FROM wardrobe_items
         ) + ? <= ?
         RETURNING id, name, category, color, season, image_key`,
      )
      .bind(
        owner,
        name,
        category,
        color,
        season,
        storedKey,
        imageVersion,
        detectedImage.contentType,
        imageBytes.byteLength,
        imageBytes.byteLength,
        storageLimit,
      )
      .first<WardrobeItemRow>();

    if (!row) {
      await deleteB2Object(storedKey, imageVersion);
      uploadedKey = null;
      uploadedVersion = "";
      return Response.json(
        { error: "Your free image-storage safety limit has been reached." },
        { status: 507 },
      );
    }
    uploadedKey = null;
    uploadedVersion = "";
    return Response.json({ item: itemResponse(row) }, { status: 201 });
  } catch (error) {
    if (uploadedKey) {
      try {
        await deleteB2Object(uploadedKey, uploadedVersion);
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            message: "B2 upload rollback failed",
            key: uploadedKey,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          }),
        );
      }
    }
    return apiError(error);
  }
}

function detectImageType(bytes: Uint8Array) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" } as const;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" } as const;
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" } as const;
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" &&
    ["avif", "avis"].includes(String.fromCharCode(...bytes.slice(8, 12)))
  ) {
    return { contentType: "image/avif", extension: "avif" } as const;
  }
  return null;
}
