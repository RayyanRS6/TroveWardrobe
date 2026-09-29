import {
  apiError,
  getWardrobeDb,
  NO_STORE,
  requireOwner,
  storageBytesUsed,
} from "../../lib/wardrobe-store";
import { getB2StorageLimitBytes } from "../../lib/b2-storage";

export const dynamic = "force-dynamic";

/** Photo storage meter: {bytesUsed, limitBytes}. */
export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const bytesUsed = await storageBytesUsed(getWardrobeDb());
    return Response.json(
      { bytesUsed, limitBytes: getB2StorageLimitBytes() },
      { headers: NO_STORE },
    );
  } catch (error) {
    return apiError(error);
  }
}
