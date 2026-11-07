import { defineConfig } from "vite";

// Standalone server for the look-dev page. Run from the repo root:
//   npx vite --config lookdev/vite.config.ts
// then open http://localhost:7150/lookdev/
// It keeps its own dep cache and scans no entries, so it can't disturb the game's server
// on port 7140.
export default defineConfig({
  root: ".",
  base: "./",
  cacheDir: "lookdev/.vite-cache",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 7150, strictPort: true },
});
