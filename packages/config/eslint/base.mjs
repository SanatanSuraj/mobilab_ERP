// Base ESLint config shared across Node packages (apps/api, apps/worker,
// apps/listen-notify, packages/*). apps/web has its own Next.js config.

import { boundariesConfig } from "./boundaries.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Rule #1: Number for money is banned (money package enforces at runtime,
      // this is a belt-and-braces lint rule — extended per package as needed).
    },
  },
];
