export {};

if (typeof process !== "undefined" && process.versions?.node) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) {
    console.error(
      `AGX local board requires Node.js >= 22.16.0 (found ${process.version}). ` +
      `node:sqlite is not available on older versions.`
    );
    process.exit(1);
  }
}
