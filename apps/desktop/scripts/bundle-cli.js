const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliSrc = path.join(__dirname, "..", "..", "..");
const cliDest = path.join(__dirname, "..", "cli-bundle");

if (!fs.existsSync(cliSrc)) {
  console.warn("Warning: agx CLI not found at", cliSrc);
  console.warn("Skipping CLI bundling. The app will work without the CLI.");
  process.exit(0);
}

// Clean previous bundle
if (fs.existsSync(cliDest)) {
  fs.rmSync(cliDest, { recursive: true });
}
fs.mkdirSync(cliDest, { recursive: true });

// Files/dirs to copy (matches the "files" field in agx's package.json)
const toCopy = [
  "index.js",
  "package.json",
  "lib",
  "commands",
  "templates",
  "cloud-runtime",
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      // Skip test files, dev artifacts
      if (entry === "__tests__" || entry === "coverage" || entry === ".git") continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const item of toCopy) {
  const src = path.join(cliSrc, item);
  if (fs.existsSync(src)) {
    console.log(`Bundling ${item}...`);
    copyRecursive(src, path.join(cliDest, item));
  } else {
    console.warn(`Skipping ${item} (not found)`);
  }
}

const packagedManifestPath = path.join(cliDest, "package.json");
if (fs.existsSync(packagedManifestPath)) {
  const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath, "utf8"));
  delete packagedManifest.workspaces;
  delete packagedManifest.devDependencies;
  fs.writeFileSync(packagedManifestPath, JSON.stringify(packagedManifest, null, 2) + "\n");
}

// Install production dependencies into the bundle
console.log("Installing CLI dependencies...");
try {
  execSync("npm install --omit=dev --ignore-scripts", {
    cwd: cliDest,
    stdio: "inherit",
    timeout: 120000,
  });
} catch (err) {
  console.error("Failed to install CLI dependencies:", err.message);
  process.exit(1);
}

// Create the bin wrapper
const binDir = path.join(__dirname, "..", "bin");
fs.mkdirSync(binDir, { recursive: true });

const wrapper = `#!/bin/bash
# agx CLI wrapper — uses the system node to run the bundled CLI
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")/cli/index.js"
exec node "$CLI_DIR" "$@"
`;

fs.writeFileSync(path.join(binDir, "agx"), wrapper, { mode: 0o755 });

console.log("CLI bundled successfully.");
