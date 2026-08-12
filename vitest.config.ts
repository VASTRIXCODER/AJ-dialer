import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests run in plain Node against the app's PURE modules. Two aliases make
// that possible: `@` → src (matching tsconfig), and a stub for `server-only`
// (that package throws when imported outside a React Server Component bundle).
const root = process.cwd();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
});
