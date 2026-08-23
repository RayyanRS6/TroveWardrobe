import {
  apiError,
  getOwner,
  getWardrobeDb,
} from "../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = getOwner(request);
    const db = getWardrobeDb();
    const result = await db
      .prepare(
        "SELECT name FROM wardrobe_categories WHERE owner = ? ORDER BY name COLLATE NOCASE",
      )
      .bind(owner)
      .all<{ name: string }>();

    return Response.json({ categories: result.results.map((row) => row.name) });
  } catch (error) {
    return apiError(error);
  }
}
