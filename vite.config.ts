import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const localEnv = loadEnv(mode, process.cwd(), "");
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [
      {
        binding: "DB",
        database_name: "trove-wardrobe-local",
        database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
      },
    ],
    images: {
      binding: "IMAGES",
    },
    vars: {
      B2_ENDPOINT:
        localEnv.B2_ENDPOINT ?? "replace-with-your-b2-s3-endpoint",
      B2_BUCKET_NAME:
        localEnv.B2_BUCKET_NAME ?? "replace-with-your-private-b2-bucket",
      B2_APPLICATION_KEY_ID:
        localEnv.B2_APPLICATION_KEY_ID ?? "replace-with-your-b2-key-id",
      B2_APPLICATION_KEY: localEnv.B2_APPLICATION_KEY ?? "",
      B2_STORAGE_LIMIT_BYTES: "9000000000",
    },
  };

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
