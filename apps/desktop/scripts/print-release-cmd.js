#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const appRoot = path.join(__dirname, "..");
const distDir = path.join(appRoot, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const version = packageJson.version;

if (!fs.existsSync(distDir)) {
  throw new Error(`Build output not found at ${distDir}. Run the app build first.`);
}

const filesToRelease = fs.readdirSync(distDir).filter((name) => {
  const isCurrentVersionArtifact =
    name.includes(`-${version}-`) ||
    name === `AGX-${version}-arm64.dmg` ||
    name === `AGX-${version}-arm64-mac.zip` ||
    name === `AGX-${version}-arm64.dmg.blockmap` ||
    name === `AGX-${version}-arm64-mac.zip.blockmap`;
  const isLatestAlias =
    name === "agx-latest.dmg" ||
    name === "agx-latest.zip" ||
    name === "latest-mac.yml";

  return (
    isCurrentVersionArtifact ||
    isLatestAlias
  );
});

if (filesToRelease.length === 0) {
  throw new Error(`No release artifacts found in ${distDir}`);
}

const fileList = filesToRelease.map((f) => `  dist/${f}`).join(" \\\n");

const reminder = [
  "Release artifacts ready in dist/",
  "",
  "Create a GitHub Release:",
  "",
  `  gh release create app-v${version} \\`,
  fileList + " \\",
  `  --title "AGX v${version}" \\`,
  `  --notes "Release notes here"`,
].join("\n");

console.log(reminder);
