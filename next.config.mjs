import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const contentSecurityPolicy = "base-uri 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src-attr 'none'; upgrade-insecure-requests";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: appRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy }
        ]
      }
    ];
  },
  images: {
    minimumCacheTTL: 86_400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.api-sports.io"
      }
    ]
  }
};

export default nextConfig;
