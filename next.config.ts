import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist: worker URL is set in lib/pdfjs-config.ts (file:// + public copy). Keep external for Node + canvas.
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse", "pdfjs-dist"],
  // Allow iPad/iPhone on the LAN to access Next.js dev assets (HMR/runtime chunks).
  allowedDevOrigins: ["http://192.168.1.70:3000", "http://192.168.1.70:3001"],
};

export default nextConfig;
