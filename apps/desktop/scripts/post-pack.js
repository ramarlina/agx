#!/usr/bin/env node
/**
 * Post-pack: copy node_modules that electron-builder strips from extraResources.
 * electron-builder excludes top-level node_modules/ by default.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distBase = path.join(__dirname, "..", "dist");
const serverNodeModulesSrc = path.join(__dirname, "..", "..", "local", ".next", "standalone", "node_modules");

function copyLatestAlias(ext, aliasName) {
  if (!fs.existsSync(distBase)) return;

  const candidates = fs
    .readdirSync(distBase)
    .filter((name) => name.endsWith(ext) && name !== aliasName)
    .sort((left, right) => {
      const leftTime = fs.statSync(path.join(distBase, left)).mtimeMs;
      const rightTime = fs.statSync(path.join(distBase, right)).mtimeMs;
      return rightTime - leftTime;
    });

  const source = candidates[0];
  if (!source) return;

  const sourcePath = path.join(distBase, source);
  const aliasPath = path.join(distBase, aliasName);
  fs.copyFileSync(sourcePath, aliasPath);
  console.log(`[post-pack] Wrote ${aliasName} -> ${source}`);
}

// Find the .app bundle
const platforms = fs.readdirSync(distBase).filter((d) => d.startsWith("mac"));
if (platforms.length === 0) {
  console.log("[post-pack] No mac build found, skipping.");
  process.exit(0);
}

for (const platform of platforms) {
  const resourcesPathCandidates = ["AGX.app", "agx.app"].map((appBundleName) =>
    path.join(distBase, platform, appBundleName, "Contents", "Resources")
  );
  const appPath = resourcesPathCandidates.find((candidate) => fs.existsSync(candidate));
  if (!appPath) {
    console.warn(`[post-pack] No app bundle found for ${platform}, skipping.`);
    continue;
  }

  // Copy server node_modules
  const serverNodeModulesDest = path.join(appPath, "server", "node_modules");
  if (fs.existsSync(serverNodeModulesSrc) && !fs.existsSync(serverNodeModulesDest)) {
    console.log(`[post-pack] Copying server node_modules to ${platform}...`);
    fs.cpSync(serverNodeModulesSrc, serverNodeModulesDest, { recursive: true });
  }

  // Copy CLI node_modules
  const cliNodeModulesSrc = path.join(__dirname, "..", "cli-bundle", "node_modules");
  const cliNodeModulesDest = path.join(appPath, "cli", "node_modules");
  if (fs.existsSync(cliNodeModulesSrc) && !fs.existsSync(cliNodeModulesDest)) {
    console.log(`[post-pack] Copying CLI node_modules to ${platform}...`);
    fs.cpSync(cliNodeModulesSrc, cliNodeModulesDest, { recursive: true });
  }

  console.log(`[post-pack] Done for ${platform}.`);
}

copyLatestAlias(".dmg", "agx-latest.dmg");
copyLatestAlias(".zip", "agx-latest.zip");
