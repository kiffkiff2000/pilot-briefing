import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist resolves ./pdf.worker.mjs relative to the bundle; externalize so Node can load the real worker.
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse", "pdfjs-dist"],
  // Allow iPad/iPhone on the LAN to access Next.js dev assets (HMR/runtime chunks).
  allowedDevOrigins: ["http://192.168.1.70:3000", "http://192.168.1.70:3001"],
};

export default nextConfig;
