import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Everything under public/ is copied to the build root verbatim and served
  // from / in dev: the alumni allowlist (fetched at runtime, so the bundler
  // never sees it), the globe texture and globe.gl, and the HPAIR logo.
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Two entry points: the portal app and the public landing page.
      input: {
        index: resolve(__dirname, "index.html"),
        home: resolve(__dirname, "home.html"),
      },
    },
  },
});
