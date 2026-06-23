import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend builds to `web/dist`, which the Rust server embeds via rust-embed.
// In dev, API calls are proxied to the running `rustviz` server on :7878.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7878",
    },
  },
});
