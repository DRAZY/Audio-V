import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    // Several integration cases decode audio and exercise SQLite. They finish
    // well below five seconds on the development Mac, but the same valid work
    // can cross Vitest's five-second default on a contended Windows runner.
    // Keep a finite ceiling so a genuine deadlock still fails verification.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/release/**", "**/dist-electron/**", "**/docs/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
