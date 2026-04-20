// ESLint module boundaries enforcement (ARCHITECTURE.md §4.1, Rule #15)
// Modules under packages/core/{module}/ MUST NOT import each other directly.
// Cross-module communication goes through the outbox (§6) only.

export const boundariesConfig = {
  "boundaries/elements": [
    { type: "module", pattern: "packages/core/*/src/**" },
    { type: "db", pattern: "packages/db/src/**" },
    { type: "queue", pattern: "packages/queue/src/**" },
    { type: "money", pattern: "packages/money/src/**" },
    { type: "contracts", pattern: "packages/contracts/src/**" },
    { type: "observability", pattern: "packages/observability/src/**" },
    { type: "errors", pattern: "packages/errors/src/**" },
    { type: "cache", pattern: "packages/cache/src/**" },
    { type: "resilience", pattern: "packages/resilience/src/**" },
    { type: "apps", pattern: "apps/**" },
  ],
  "boundaries/element-types": [
    "error",
    {
      default: "disallow",
      rules: [
        // Apps may import anything
        { from: "apps", allow: ["module", "db", "queue", "money", "contracts", "observability", "errors", "cache", "resilience"] },
        // A module may import shared infra but NOT another module
        { from: "module", allow: ["db", "queue", "money", "contracts", "observability", "errors", "cache", "resilience"] },
        // Shared packages may import each other in limited ways
        { from: "db", allow: ["money", "contracts", "errors", "observability"] },
        { from: "queue", allow: ["observability", "errors"] },
        { from: "cache", allow: ["observability", "errors"] },
        { from: "resilience", allow: ["observability", "errors"] },
        { from: "observability", allow: [] },
        { from: "errors", allow: [] },
        { from: "money", allow: [] },
        { from: "contracts", allow: [] },
      ],
    },
  ],
};
