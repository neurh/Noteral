#!/usr/bin/env node
// Checks whether the public plugin hub (github.com/neurh/noteral-plugins) is in
// sync with this repo, without touching the hub checkout.
//
//   node scripts/check-plugin-hub.mjs [hub-checkout]   (default ../noteral-plugins)
//
// It unpacks the hub's committed HEAD into a temp folder, runs the export over
// it, and lists every file the export would change. Exit code 1 means the hub
// is out of date: run `npm run hub:export`, test, then commit and push the hub.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hub = path.resolve(process.argv[2] || path.join(root, "..", "noteral-plugins"));
if (!existsSync(path.join(hub, ".git"))) {
  console.error(`No hub checkout at ${hub}. Clone it: git clone https://github.com/neurh/noteral-plugins ${hub}`);
  process.exit(2);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "noteral-hub-"));
const before = path.join(tmp, "before");
const after = path.join(tmp, "after");
try {
  for (const dir of [before, after]) {
    execFileSync("mkdir", ["-p", dir]);
    execFileSync("sh", ["-c", 'git -C "$1" archive HEAD | tar -x -C "$2"', "sh", hub, dir]);
  }
  execFileSync(process.execPath, [path.join(root, "scripts/export-plugin-hub.mjs"), after], { stdio: "ignore" });
  const changed = diff(before, after);
  if (!changed.length) {
    console.log("Plugin hub is up to date.");
  } else {
    console.log(`Plugin hub is out of date (${changed.length} files):`);
    for (const line of changed) console.log(`  ${line}`);
    console.log("\nRun `npm run hub:export`, test the hub, then commit and push it.");
    process.exitCode = 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function files(dir, base = dir, out = new Map()) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, base, out);
    else out.set(path.relative(base, full), full);
  }
  return out;
}

function diff(a, b) {
  const left = files(a);
  const right = files(b);
  const out = [];
  for (const [rel, full] of right) {
    if (!left.has(rel)) out.push(`added    ${rel}`);
    else if (!readFileSync(full).equals(readFileSync(left.get(rel)))) out.push(`changed  ${rel}`);
  }
  for (const rel of left.keys()) if (!right.has(rel)) out.push(`removed  ${rel}`);
  return out.sort((x, y) => x.slice(9).localeCompare(y.slice(9)));
}
