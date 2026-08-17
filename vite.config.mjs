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
      // Two entry points. index.html is the public landing page, so it is
      // what visitors get at /; the signed-in app lives at /portal.
      input: {
        index: resolve(__dirname, "index.html"),
        portal: resolve(__dirname, "portal.html"),
      },
    },
  },
});
