import { defineConfig } from "vite";

// Vite builds the app into the dist folder, which Cloudflare serves.
export default defineConfig({
  // Relative paths, so the app works at any address
  // (a preview link today, thedrift3r.com/driftmix at launch).
  base: "./",
  // React's JSX without an extra plugin.
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist", sourcemap: false },
});
