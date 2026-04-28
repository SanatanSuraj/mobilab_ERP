#!/usr/bin/env node
/**
 * Flip workspace packages from publishing TypeScript source to publishing
 * compiled JS. For each package:
 *   - main: ./src/X.ts        → ./dist/X.js
 *   - types: ./src/X.ts       → ./dist/X.d.ts
 *   - exports[k]: ./src/X.ts  → { types, import, default } pointing at dist
 *   - add files: ["dist"]
 *
 * Idempotent: skips packages already pointing at dist.
 *
 * Usage: node ops/scripts/fix-package-exports.mjs <pkg-dir> [<pkg-dir>...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: fix-package-exports.mjs <pkg-dir> [...]");
  process.exit(2);
}

function srcToDistPath(p) {
  // "./src/foo.ts" → "./dist/foo.js"  (and ".d.ts" variant)
  if (typeof p !== "string") return p;
  return p.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
}
function srcToDtsPath(p) {
  if (typeof p !== "string") return p;
  return p.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".d.ts");
}
function isSrcTs(p) {
  return typeof p === "string" && p.startsWith("./src/") && p.endsWith(".ts");
}

let changed = 0;

for (const dir of targets) {
  const pjPath = resolve(dir, "package.json");
  const pj = JSON.parse(readFileSync(pjPath, "utf8"));
  const before = JSON.stringify(pj);

  // main
  if (isSrcTs(pj.main)) pj.main = srcToDistPath(pj.main);

  // types — always derive from main if main is now dist/
  if (typeof pj.main === "string" && pj.main.startsWith("./dist/")) {
    pj.types = pj.main.replace(/\.js$/, ".d.ts");
  }

  // exports — handle both string and conditional-object forms
  if (pj.exports && typeof pj.exports === "object") {
    for (const [key, val] of Object.entries(pj.exports)) {
      if (isSrcTs(val)) {
        pj.exports[key] = {
          types: srcToDtsPath(val),
          import: srcToDistPath(val),
          default: srcToDistPath(val),
        };
      } else if (val && typeof val === "object") {
        // Conditional form — replace any src/*.ts string values within
        for (const [cond, condVal] of Object.entries(val)) {
          if (isSrcTs(condVal)) {
            val[cond] =
              cond === "types" ? srcToDtsPath(condVal) : srcToDistPath(condVal);
          }
        }
      }
    }
  }

  // files: ["dist"]
  if (!Array.isArray(pj.files)) pj.files = ["dist"];
  else if (!pj.files.includes("dist")) pj.files.push("dist");

  const after = JSON.stringify(pj);
  if (before === after) {
    console.log(`  unchanged: ${dir}`);
    continue;
  }
  // 2-space indent + trailing newline (matches existing files in repo)
  writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n");
  changed++;
  console.log(`  updated:   ${dir}`);
}

console.log(`\n${changed}/${targets.length} package.json files updated.`);
