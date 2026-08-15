import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // Sibling git worktrees under .worktrees/ have their own copies of every
    // file, but the "@" alias above always resolves to THIS repo root
    // regardless of where a test file physically lives — so without this
    // exclude, a stale worktree's test file would import this repo's
    // current source and fail against outdated expectations.
    exclude: [...configDefaults.exclude, "**/.worktrees/**", "**/worktrees/**"],
  },
});
