#!/usr/bin/env node
/**
 * Download and bundle the Node.js binary that matches the build-time version.
 * Placed in node-runtime/ and included via extraResources.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const nodeVersion = process.version; // e.g. v22.22.0
const arch = process.arch; // arm64 or x64
const platform = process.platform; // darwin or linux

const outDir = path.join(__dirname, "..", "node-runtime");
const nodeBinDest = path.join(outDir, "node");

if (fs.existsSync(nodeBinDest)) {
  // Check if already the right version
  try {
    const existing = execSync(`"${nodeBinDest}" -v`, { encoding: "utf-8" }).trim();
    if (existing === nodeVersion) {
      console.log(`[bundle-node] Already have ${nodeVersion} — skipping download.`);
      process.exit(0);
    }
  } catch {}
}

fs.mkdirSync(outDir, { recursive: true });

const tarball = `node-${nodeVersion}-${platform}-${arch}.tar.gz`;
const url = `https://nodejs.org/dist/${nodeVersion}/${tarball}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-dl-"));
const tmpTar = path.join(tmpDir, tarball);

console.log(`[bundle-node] Downloading ${url}...`);
execSync(`curl -fsSL -o "${tmpTar}" "${url}"`, { stdio: "inherit" });

console.log(`[bundle-node] Extracting node binary...`);
execSync(
  `tar -xzf "${tmpTar}" -C "${tmpDir}" --strip-components=2 "node-${nodeVersion}-${platform}-${arch}/bin/node"`,
  { stdio: "inherit" }
);

const extractedBin = path.join(tmpDir, "node");
if (!fs.existsSync(extractedBin)) {
  console.error("[bundle-node] Failed to extract node binary.");
  process.exit(1);
}

fs.copyFileSync(extractedBin, nodeBinDest);
fs.chmodSync(nodeBinDest, 0o755);

// Clean up
fs.rmSync(tmpDir, { recursive: true });

// Verify
const ver = execSync(`"${nodeBinDest}" -v`, { encoding: "utf-8" }).trim();
console.log(`[bundle-node] Bundled node ${ver} (${platform}-${arch}) at ${nodeBinDest}`);
