#!/usr/bin/env node
/**
 * Fix the Next.js standalone build for Electron packaging.
 *
 * Turbopack creates symlinks in .next/node_modules/ for external packages.
 * electron-builder doesn't follow symlinks into extraResources correctly,
 * so we replace symlinks with actual copies.
 */
const fs = require("fs");
const path = require("path");

const standaloneDir = path.join(__dirname, "..", "..", "local", ".next", "standalone");
const nextNodeModules = path.join(standaloneDir, ".next", "node_modules");
const localAppRoot = path.join(__dirname, "..", "..", "local");
const CUSTOM_SERVER_ENTRY = "agx-server.js";

function findPackagedAppDir(rootDir) {
  const maxDepth = 8;
  const stack = [{ dir: rootDir, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;

    if (fs.existsSync(path.join(dir, "server.js")) && fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return null;
}

function sanitizeStandaloneServerConfig(appDir) {
  const serverPath = path.join(appDir, "server.js");
  if (!fs.existsSync(serverPath)) return false;

  const content = fs.readFileSync(serverPath, "utf8");
  const sanitized = content
    .replace(/"outputFileTracingRoot":"[^"]+"/g, '"outputFileTracingRoot":"."')
    .replace(/"turbopack":\{"root":"[^"]+"/g, '"turbopack":{"root":"."');

  if (sanitized === content) return false;
  fs.writeFileSync(serverPath, sanitized);
  return true;
}

function sanitizeRequiredServerFiles(appDir) {
  const requiredServerFilesPath = path.join(appDir, ".next", "required-server-files.json");
  if (!fs.existsSync(requiredServerFilesPath)) return false;

  const raw = fs.readFileSync(requiredServerFilesPath, "utf8");
  const config = JSON.parse(raw);
  let changed = false;

  if (config?.config?.outputFileTracingRoot && config.config.outputFileTracingRoot !== ".") {
    config.config.outputFileTracingRoot = ".";
    changed = true;
  }

  if (config?.config?.turbopack?.root && config.config.turbopack.root !== ".") {
    config.config.turbopack.root = ".";
    changed = true;
  }

  if (config?.appDir && config.appDir !== ".") {
    config.appDir = ".";
    changed = true;
  }

  if (config?.relativeAppDir && config.relativeAppDir !== ".") {
    config.relativeAppDir = ".";
    changed = true;
  }

  if (!changed) return false;
  fs.writeFileSync(requiredServerFilesPath, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

function copyNodePtyPrebuilds() {
  const prebuildsSrc = path.join(__dirname, "..", "..", "..", "node_modules", "node-pty", "prebuilds");
  const nodePtyDest = path.join(standaloneDir, "node_modules", "node-pty");
  if (!fs.existsSync(prebuildsSrc) || !fs.existsSync(nodePtyDest)) {
    return false;
  }
  const prebuildsDest = path.join(nodePtyDest, "prebuilds");
  fs.cpSync(prebuildsSrc, prebuildsDest, { recursive: true });
  return true;
}

async function bundleCustomServer(appDir) {
  const esbuild = require(path.join(__dirname, "..", "..", "..", "node_modules", "esbuild"));
  const entry = path.join(localAppRoot, "bundled-server.ts");
  if (!fs.existsSync(entry)) {
    console.warn(`[fix-standalone] Bundled server entrypoint missing at ${entry}, skipping wrapper bundle.`);
    return false;
  }

  console.log("[fix-standalone] Bundling standalone board server wrapper...");
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(appDir, CUSTOM_SERVER_ENTRY),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node22"],
    sourcemap: false,
    logLevel: "info",
    external: ["next", "node-pty"],
  });
  return true;
}

let fixed = 0;

if (fs.existsSync(nextNodeModules)) {
  for (const entry of fs.readdirSync(nextNodeModules)) {
    const full = path.join(nextNodeModules, entry);
    const stat = fs.lstatSync(full);

    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      const resolved = path.resolve(nextNodeModules, target);

      if (!fs.existsSync(resolved)) {
        console.warn(`[fix-standalone] Symlink ${entry} -> ${target} is broken, skipping.`);
        continue;
      }

      console.log(`[fix-standalone] Replacing symlink ${entry} with copy...`);
      fs.rmSync(full, { recursive: true });
      fs.cpSync(resolved, full, { recursive: true });
      fixed++;
    }
  }
} else {
  console.log("[fix-standalone] No .next/node_modules — skipping symlink fix.");
}

console.log(`[fix-standalone] Done. Fixed ${fixed} symlink(s).`);

const appDir = findPackagedAppDir(standaloneDir);
if (appDir && sanitizeStandaloneServerConfig(appDir)) {
  console.log("[fix-standalone] Sanitized standalone server config paths.");
}
if (appDir && sanitizeRequiredServerFiles(appDir)) {
  console.log("[fix-standalone] Sanitized standalone required-server-files metadata.");
}

// Record the build-time node path and version so the app uses the matching node at runtime.
const buildInfo = {
  nodeVersion: process.version,
  moduleVersion: process.versions.modules,
  builtAt: new Date().toISOString(),
};
const buildInfoPath = path.join(standaloneDir, ".node-build-info.json");
fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
console.log(`[fix-standalone] Saved build info: node ${buildInfo.nodeVersion} (modules ${buildInfo.moduleVersion})`);

if (copyNodePtyPrebuilds()) {
  console.log("[fix-standalone] Copied node-pty prebuilds into standalone runtime.");
}

if (appDir) {
  bundleCustomServer(appDir).catch((err) => {
    console.error("[fix-standalone] Failed to bundle custom server wrapper:", err);
    process.exit(1);
  });
} else {
  console.warn("[fix-standalone] Could not find packaged app dir — skipping custom server wrapper bundle.");
}
