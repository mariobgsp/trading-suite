import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // manualChunks isolates libraries that change on a different schedule to
    // our own code: an app deploy leaves the vendor and charts chunks valid in
    // the browser cache. It does NOT defer them. All five sections render
    // eagerly on the single page, so charts is fetched on first paint along
    // with everything else. Cutting first-paint bytes means lazy-loading the
    // chart modules behind an IntersectionObserver, not splitting them here.
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["lightweight-charts"],
          vendor: ["react", "react-dom", "@tanstack/react-router"],
        },
      },
    },
  },
});
