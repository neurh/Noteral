#!/usr/bin/env node
// Exports the public plugin hub (github.com/neurh/noteral-plugins) from this repo.
//
//   node scripts/export-plugin-hub.mjs <hub-checkout>
//
// The hub is what plugin developers and the store use: the registry, the
// registry bot and its workflows, the SDK types and CLI, the developer docs and
// the examples. This repo stays the source of truth; run this after changing
// any of those files (scripts/build-plugins.mjs first), then commit the hub.
// registry/community-plugins.json is the hub's own data and is never
// overwritten once it exists there.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/export-plugin-hub.mjs <hub-checkout>");
  process.exit(1);
}
const hub = path.resolve(target);
if (hub === root) throw new Error("The hub must be a different directory.");
mkdirSync(hub, { recursive: true });

// Paths copied as-is (directories replace what's in the hub).
const COPY = [
  "sdk/cli",
  "sdk/src",
  "sdk/package.json",
  "sdk/tsconfig.json",
  "docs/plugins",
  "docs/sdk",
  "docs/assistant.md",
  "examples",
  "registry/review.mjs",
  "registry/validate.mjs",
  "registry/from-issue.mjs",
  "registry/registry.test.mjs",
  ".github/workflows/registry.yml",
  ".github/workflows/registry-submit.yml",
  ".github/ISSUE_TEMPLATE",
];

for (const rel of COPY) {
  const from = path.join(root, rel);
  const to = path.join(hub, rel);
  if (!existsSync(from)) throw new Error(`Missing ${rel}`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
}

// Hub-only files.
cpSync(path.join(root, "registry/hub/README.md"), path.join(hub, "README.md"));
cpSync(path.join(root, "registry/hub/LICENSE"), path.join(hub, "LICENSE"));
cpSync(path.join(root, "registry/hub/gitignore"), path.join(hub, ".gitignore"));

const registryFile = path.join(hub, "registry/community-plugins.json");
if (!existsSync(registryFile)) cpSync(path.join(root, "registry/community-plugins.json"), registryFile);

// Go-parity data for registry.test.mjs (the hub has no Go source).
const go = await import(path.join(root, "sdk/cli/noteral-plugin.mjs"));
writeFileSync(
  path.join(hub, "registry/app-rules.json"),
  `${JSON.stringify({ note: "Generated from internal/plugins by Noteral's scripts/export-plugin-hub.mjs", ...appRules() }, null, 2)}\n`,
);

function appRules() {
  const src = readFile("internal/plugins/plugins.go");
  const block = src.slice(src.indexOf("var allowedPermissions"), src.indexOf("}", src.indexOf("var allowedPermissions")));
  return {
    sdkVersion: go.SDK_VERSION,
    permissions: [...block.matchAll(/"([a-z]+(?:\.[a-z]+)?)":\s*true/g)].map((m) => m[1]).sort(),
    idPattern: /idRe\s+=\s+regexp\.MustCompile\(`([^`]+)`\)/.exec(src)?.[1],
    versionPattern: /versionRe\s+=\s+regexp\.MustCompile\(`([^`]+)`\)/.exec(src)?.[1],
  };
}

function readFile(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    entry.isDirectory() ? walk(full) : files.push(path.relative(hub, full));
  }
};
walk(hub);
console.log(`Exported ${files.length} files to ${hub}`);
