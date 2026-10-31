import { defineConfig } from "vite";
import { readFileSync, readdirSync, statSync } from "node:fs";

// Every build gets its own version (shown in the app; names its saved files).
const version = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);

/**
 * Writes the service worker (src/sw.js) into the build with this version and
 * the list of every file to save on the device, so DriftMix installs as an
 * app and opens offline.
 */
function serviceWorker() {
  return {
    name: "driftmix-service-worker",
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      // Files at the top of public (icons, manifest); not folders such as the demo tracks.
      const fromPublic = readdirSync("public").filter((f) => f !== "_headers" && statSync(`public/${f}`).isFile());
      const files = ["./", ...[...built, ...fromPublic].map((f) => `./${f}`)];
      const source = readFileSync("src/sw.js", "utf8").replace("__VERSION__", version).replace("__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Vite builds the app into the dist folder, which Cloudflare serves.
export default defineConfig({
  // Relative paths, so the app works at any address
  // (a preview link today, thedrift3r.com/driftmix at launch).
  base: "./",
  // React's JSX without an extra plugin.
  esbuild: { jsx: "automatic" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [serviceWorker()],
  build: { outDir: "dist", sourcemap: false },
});
