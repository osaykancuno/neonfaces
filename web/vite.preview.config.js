// `npm run build:preview`: the web app's stylesheet and effects for the preview (landing/), as landing/app.js and
// landing/app.css, plus the gallery the hero mosaic draws from (landing/data/gallery.json).
import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "../landing",
    emptyOutDir: false, // landing/ holds the page and its images: only app.js and app.css are written
    target: "es2022",
    lib: { entry: "src/preview.js", formats: ["es"], fileName: () => "app.js", cssFileName: "app" },
  },
  plugins: [
    {
      name: "preview-gallery",
      closeBundle() {
        mkdirSync("../landing/data", { recursive: true });
        copyFileSync("public/data/gallery.json", "../landing/data/gallery.json");
      },
    },
  ],
});
