#!/usr/bin/env node
/**
 * Generate .icns from assets/agx_app_icon.png using sips + iconutil (macOS).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const assetsDir = path.join(__dirname, "..", "assets");
const srcPng = path.join(assetsDir, "agx_app_icon.png");
const iconsetDir = path.join(assetsDir, "icon.iconset");
const icnsPath = path.join(assetsDir, "icon.icns");

if (!fs.existsSync(srcPng)) {
  console.error(`Source icon not found: ${srcPng}`);
  process.exit(1);
}

function getImageDimension(filePath, key) {
  const output = execSync(`sips -g ${key} "${filePath}"`, { encoding: "utf8", stdio: "pipe" });
  const match = output.match(new RegExp(`${key}:\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}

const srcWidth = getImageDimension(srcPng, "pixelWidth");
const srcHeight = getImageDimension(srcPng, "pixelHeight");
if (srcWidth < 1024 || srcHeight < 1024) {
  if (fs.existsSync(icnsPath)) {
    console.warn(
      `[generate-icon] Source icon is ${srcWidth}x${srcHeight}; reusing existing ${path.basename(icnsPath)} because macOS iconsets require a 1024x1024 source image.`
    );
    process.exit(0);
  }

  console.error(
    `[generate-icon] Source icon is ${srcWidth}x${srcHeight}, but a 1024x1024 source image is required and no existing ${path.basename(icnsPath)} is available.`
  );
  process.exit(1);
}

// Create iconset
if (fs.existsSync(iconsetDir)) {
  fs.rmSync(iconsetDir, { recursive: true });
}
fs.mkdirSync(iconsetDir, { recursive: true });

const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  const name = size === 1024 ? "icon_512x512@2x.png" : `icon_${size}x${size}.png`;
  execSync(`sips -z ${size} ${size} "${srcPng}" --out "${path.join(iconsetDir, name)}"`, {
    stdio: "pipe",
  });
  // Create @2x versions
  if (size <= 512 && size > 16) {
    const halfSize = size / 2;
    const name2x = `icon_${halfSize}x${halfSize}@2x.png`;
    if (!fs.existsSync(path.join(iconsetDir, name2x))) {
      execSync(`sips -z ${size} ${size} "${srcPng}" --out "${path.join(iconsetDir, name2x)}"`, {
        stdio: "pipe",
      });
    }
  }
}

// 16@2x = 32px
execSync(`sips -z 32 32 "${srcPng}" --out "${path.join(iconsetDir, "icon_16x16@2x.png")}"`, {
  stdio: "pipe",
});

// Convert to icns
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);

// Clean up
fs.rmSync(iconsetDir, { recursive: true });

console.log(`Icon created at ${icnsPath}`);
