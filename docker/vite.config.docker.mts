// Client-only Vite build for the container image — no @cloudflare/vite-plugin,
// so it never touches Cloudflare. Output goes to <repo>/dist/client.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: repoRoot,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/client", import.meta.url)),
    emptyOutDir: true,
  },
});
