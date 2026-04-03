import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    dts: true,
    clean: true,
    splitting: false,
    external: [
      "better-sqlite3",
      "openai",
      "@anthropic-ai/sdk",
      "express",
      "pg",
      "uuid",
    ],
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    splitting: false,
    external: [
      "better-sqlite3",
      "openai",
      "@anthropic-ai/sdk",
      "express",
      "pg",
      "uuid",
    ],
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  },
]);
