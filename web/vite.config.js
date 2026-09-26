import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa", // /face/:id falls back to index.html in dev and preview
  build: { target: "es2022", assetsInlineLimit: 0 },
  server: { port: Number(process.env.PORT) || 5173 }, // PORT: set by a launcher when 5173 is taken
});
