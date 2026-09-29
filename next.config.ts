import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // vinext screens every multipart POST as a possible Server Action before
    // route handlers run, rejecting bodies over 1 MB by default. Allow a full
    // phone photo (the items API caps images at 10 MB) plus form fields.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
