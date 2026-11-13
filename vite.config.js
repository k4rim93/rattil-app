import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public-build",
  appType: "spa",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});

