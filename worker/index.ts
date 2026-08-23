/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let authenticatedRequest = request;
    const identity = await ctx.access?.getIdentity();
    const email = identity?.email?.trim().toLowerCase();
    if (!email) {
      return Response.json(
        { error: "Cloudflare Access authentication is required." },
        { status: 403 },
      );
    }

    const headers = new Headers(authenticatedRequest.headers);
    headers.set("cf-access-authenticated-user-email", email);
    authenticatedRequest = new Request(authenticatedRequest, { headers });
    const url = new URL(authenticatedRequest.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(authenticatedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, authenticatedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const outputFormat = isSupportedImageFormat(format)
            ? format
            : "image/webp";
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format: outputFormat, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(authenticatedRequest, env, ctx);
  },
} satisfies ExportedHandler<Env>;

function isSupportedImageFormat(
  format: string,
): format is "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" {
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(format);
}

export default worker;
