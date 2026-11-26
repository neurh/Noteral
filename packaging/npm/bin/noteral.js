#!/usr/bin/env node
// Downloads the Noteral desktop app for this system from GitHub Releases (once,
// into a cache folder), verifies its SHA-256 checksum, and opens it.
// No dependencies; needs Node 18+ (global fetch).
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = "neurh/Noteral";
const VERSION = require("../package.json").version;

function cacheRoot() {
  if (process.env.NOTERAL_CACHE_DIR) return path.resolve(process.env.NOTERAL_CACHE_DIR);
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Noteral", "npm");
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "Noteral", "npm");
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, ".cache"), "noteral", "npm");
}

function target() {
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (process.platform === "darwin") {
    return { asset: "noteral-macos-universal.zip", exe: path.join("Noteral.app", "Contents", "MacOS", "noteral"), app: "Noteral.app" };
  }
  if (!arch) fail(`Noteral has no build for ${process.arch} yet (x64 and arm64 are available).`);
  if (process.platform === "linux") return { asset: `noteral-linux-${arch}.tar.gz`, exe: path.join("noteral", "noteral") };
  if (process.platform === "win32") return { asset: `noteral-windows-${arch}.zip`, exe: path.join("Noteral", "noteral.exe") };
  fail(`Noteral does not support ${process.platform}.`);
}

function fail(message) {
  console.error(`noteral: ${message}`);
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "noteral-npm" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

// Windows 10+ ships bsdtar as System32\tar.exe, which reads .zip. Call it by
// full path: a GNU tar earlier in PATH (Git Bash, MSYS) reads "C:" as a host.
function extractZipWindows(archive, out) {
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(tar)) return run(tar, ["-xf", archive, "-C", out]);
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`]);
}

async function ensureInstalled() {
  const t = target();
  const dir = path.join(cacheRoot(), VERSION);
  const exe = path.join(dir, t.exe);
  if (fs.existsSync(exe)) return { exe, dir, t };

  const base = `https://github.com/${REPO}/releases/download/v${VERSION}`;
  process.stderr.write(`Downloading Noteral ${VERSION} (${t.asset})...\n`);
  let data;
  try {
    data = await get(`${base}/${t.asset}`);
  } catch (err) {
    fail(`download failed: ${err.message}\nGet it from https://github.com/${REPO}/releases instead.`);
  }

  const sums = await get(`${base}/SHA256SUMS.txt`).then((b) => b.toString("utf8"), () => "");
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${t.asset}`));
  if (line) {
    const want = line.trim().split(/\s+/)[0].toLowerCase();
    const got = crypto.createHash("sha256").update(data).digest("hex");
    if (want !== got) fail(`checksum mismatch for ${t.asset}; not installing it.`);
  }

  // Unpack next to the cache (not in os.tmpdir()) so the final rename never
  // crosses drives or filesystems.
  fs.mkdirSync(cacheRoot(), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(cacheRoot(), ".download-"));
  try {
    const archive = path.join(tmp, t.asset);
    fs.writeFileSync(archive, data);
    const out = path.join(tmp, "out");
    fs.mkdirSync(out);
    if (process.platform === "darwin") run("ditto", ["-x", "-k", archive, out]);
    else if (process.platform === "win32") extractZipWindows(archive, out);
    else run("tar", ["-xf", archive, "-C", out]);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(out, dir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (process.platform === "darwin") spawnSync("xattr", ["-dr", "com.apple.quarantine", path.join(dir, t.app)]);
  if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
  // Drop older cached versions.
  for (const name of fs.readdirSync(cacheRoot())) {
    if (name !== VERSION && !name.startsWith(".download-")) fs.rmSync(path.join(cacheRoot(), name), { recursive: true, force: true });
  }
  return { exe, dir, t };
}

function linuxDepsHint() {
  if (process.platform !== "linux") return;
  const r = spawnSync("sh", ["-c", "ldconfig -p 2>/dev/null | grep -q libwebkit2gtk-4.1.so.0"]);
  if (r.status !== 0) {
    console.error("Noteral needs GTK 3 and WebKitGTK 4.1, for example:\n  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0   (Debian, Ubuntu)\n  sudo dnf install gtk3 webkit2gtk4.1               (Fedora)\n  sudo pacman -S gtk3 webkit2gtk-4.1                (Arch)");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: noteral [--path | --uninstall | --version] [-- app arguments]\n\nOpens Noteral, downloading it on first run.");
    return;
  }
  if (args.includes("--version") || args.includes("-v")) return console.log(VERSION);
  if (args.includes("--uninstall")) {
    fs.rmSync(cacheRoot(), { recursive: true, force: true });
    return console.log("Removed the downloaded Noteral app. Your notes were not touched.");
  }

  const { exe, dir, t } = await ensureInstalled();
  if (args.includes("--path")) return console.log(t.app ? path.join(dir, t.app) : exe);

  linuxDepsHint();
  const sep = args.indexOf("--");
  const appArgs = sep >= 0 ? args.slice(sep + 1) : args;
  const child = process.platform === "darwin"
    ? spawn("open", ["-a", path.join(dir, t.app), ...(appArgs.length ? ["--args", ...appArgs] : [])], { detached: true, stdio: "ignore" })
    : spawn(exe, appArgs, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", (err) => fail(`could not start Noteral: ${err.message}`));
  child.unref();
}

main().catch((err) => fail(err.message));
