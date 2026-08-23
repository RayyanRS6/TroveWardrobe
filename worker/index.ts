/** Cloudflare Worker entry point for Trove. */
import handler from "vinext/server/app-router-entry";

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
    return handler.fetch(authenticatedRequest, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export default worker;
