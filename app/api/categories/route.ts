import {
  apiError,
  getWardrobeDb,
  loadCategoryCounts,
  NO_STORE,
  requireOwner,
} from "../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

/** Categories in use, grouped case-insensitively: {categories: {name, count}[]}. */
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const categories = await loadCategoryCounts(getWardrobeDb(), owner);
    return Response.json({ categories }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
