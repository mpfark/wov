import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Pure logic suites (combat resolver, formulas, shared contracts) need no
    // DOM. Running them under node removes the dominant per-file jsdom setup
    // cost, which is what starved the parallel pool and made module collection
    // exceed the default 5s budget.
    environmentMatchGlobs: [
      ["src/test/combat/**", "node"],
      ["src/shared/**", "node"],
      ["src/lib/**", "node"],
    ],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Wall-clock budgets only: no assertion is relaxed. Heavy suites import
    // large edge-function modules inside hooks, which can exceed 5s while the
    // pool is saturated.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./supabase/functions/_shared"),
    },
  },
});
