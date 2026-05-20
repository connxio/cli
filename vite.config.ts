import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: true,
    entry: ["packages/cli/src/cli/index.ts"],
    format: ["esm"],
    outDir: "packages/cli/dist",
    sourcemap: true,
  },
});
