#!/usr/bin/env node
// Validates registry/community-plugins.json with the same rules the app uses
// (internal/plugins/community.go ParseRegistry). Run: node registry/validate.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = process.argv[2] ?? fileURLToPath(new URL("./community-plugins.json", import.meta.url));
const ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const FIELDS = new Set(["id", "name", "author", "description", "repo", "tags"]);

const errors = [];
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`${file}: not valid JSON (${error.message})`);
  process.exit(1);
}
const entries = Array.isArray(data) ? data : data?.plugins;
if (!Array.isArray(entries)) errors.push(`top level must be { "plugins": [...] }`);

const seen = new Set();
for (const [index, entry] of (entries ?? []).entries()) {
  const at = `plugins[${index}]${entry?.id ? ` (${entry.id})` : ""}`;
  if (!entry || typeof entry !== "object") { errors.push(`${at}: must be an object`); continue; }
  for (const key of Object.keys(entry)) if (!FIELDS.has(key)) errors.push(`${at}: unknown field "${key}"`);
  const str = (key) => (typeof entry[key] === "string" ? entry[key].trim() : "");
  if (!ID.test(str("id")) || str("id").length > 100) errors.push(`${at}: id must be reverse-domain lowercase, e.g. com.you.plugin-name`);
  if (seen.has(str("id"))) errors.push(`${at}: duplicate id`);
  seen.add(str("id"));
  if (!str("name") || [...str("name")].length > 80) errors.push(`${at}: name is required (≤ 80 characters)`);
  if (!REPO.test(str("repo"))) errors.push(`${at}: repo must be "owner/name" on GitHub`);
  if ([...str("description")].length > 500) errors.push(`${at}: description is limited to 500 characters`);
  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.length > 8 || entry.tags.some((tag) => typeof tag !== "string" || tag.length > 32)))
    errors.push(`${at}: tags must be up to 8 short strings`);
}

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
console.log(`✓ ${entries.length} registry entries valid`);
