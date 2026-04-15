#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

const command = process.argv[2];
const appRoot = path.join(__dirname, "..");
const distDir = path.join(appRoot, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const version = packageJson.version;
const appPath = path.join(distDir, "mac-arm64", "AGX.app");
const statePath = path.join(distDir, "notarization.json");

function resolveArtifactPath(fileNames) {
  for (const fileName of fileNames) {
    const candidate = path.join(distDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(distDir, fileNames[0]);
}

const zipPath = resolveArtifactPath([
  `AGX-${version}-arm64-mac.zip`,
  `agx-${version}-arm64-mac.zip`,
]);
const dmgPath = resolveArtifactPath([
  `AGX-${version}-arm64.dmg`,
  `agx-${version}-arm64.dmg`,
]);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function runNotarytool(args) {
  return execFileSync("xcrun", ["notarytool", ...args], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeState(payload) {
  fs.writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readState() {
  if (!fs.existsSync(statePath)) {
    throw new Error(`Notarization state not found at ${statePath}. Run submit first.`);
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function credentialsArgs() {
  const keyPath =
    process.env.APPLE_API_KEY_PATH?.trim() ||
    process.env.APPLE_API_KEY?.trim();
  const keyId = process.env.APPLE_API_KEY_ID?.trim();
  const issuer = process.env.APPLE_API_ISSUER?.trim();

  if (keyPath && keyId && issuer) {
    return [
      "--key",
      keyPath,
      "--key-id",
      keyId,
      "--issuer",
      issuer,
    ];
  }

  return [
    "--apple-id",
    requireEnv("APPLE_ID"),
    "--password",
    requireEnv("APPLE_APP_SPECIFIC_PASSWORD"),
    "--team-id",
    requireEnv("APPLE_TEAM_ID"),
  ];
}

function ensureArtifactsExist() {
  for (const file of [appPath, zipPath, dmgPath]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Required artifact not found: ${file}`);
    }
  }
}

function submit() {
  ensureArtifactsExist();
  const raw = runNotarytool([
    "submit",
    zipPath,
    ...credentialsArgs(),
    "--output-format",
    "json",
  ]);
  const parsed = JSON.parse(raw);
  if (!parsed?.id) {
    throw new Error(`Notary submission did not return an id: ${raw}`);
  }
  writeState({
    id: parsed.id,
    status: parsed.status ?? "Submitted",
    zipPath,
    appPath,
    dmgPath,
    submittedAt: new Date().toISOString(),
  });
  console.log(`Submitted for notarization: ${parsed.id}`);
  console.log(`Saved state to ${statePath}`);
  if (parsed.status) {
    console.log(`Initial Apple status: ${parsed.status}`);
  }
}

function fetchStatus(id) {
  const raw = runNotarytool([
    "info",
    id,
    ...credentialsArgs(),
    "--output-format",
    "json",
  ]);
  return JSON.parse(raw);
}

function fetchLog(id) {
  const raw = runNotarytool([
    "log",
    id,
    ...credentialsArgs(),
    "--output-format",
    "json",
  ]);
  return JSON.parse(raw);
}

function stapleWithRetry(artifactPath, maxRetries = 8, delayMs = 15000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execFileSync("xcrun", ["stapler", "staple", artifactPath], { stdio: "inherit" });
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`[notarize] Staple attempt ${attempt}/${maxRetries} failed for ${path.basename(artifactPath)}, retrying in ${delayMs / 1000}s...`);
      sleep(delayMs);
    }
  }
}

function stapleAcceptedArtifacts(state) {
  stapleWithRetry(state.appPath || appPath);
  try {
    stapleWithRetry(state.dmgPath || dmgPath);
    console.log(`Stapled ${state.dmgPath || dmgPath}`);
  } catch (err) {
    console.warn(`[notarize] WARNING: DMG stapling failed (the .app inside is still notarized and stapled).`);
    console.warn(`[notarize] Users can still install — macOS will verify notarization online.`);
  }
  console.log(`Notarization accepted: ${state.id}`);
  console.log(`Stapled ${state.appPath || appPath}`);
}

function waitForCompletion() {
  const state = readState();
  if (state.status === "Accepted") {
    console.log(`Notarization already accepted: ${state.id}`);
    stapleAcceptedArtifacts(state);
    return;
  }

  const startedAt = Date.now();
  const timeoutMs = Number.parseInt(process.env.NOTARIZE_TIMEOUT_MS || "", 10) || 45 * 60 * 1000;
  const pollMs = Number.parseInt(process.env.NOTARIZE_POLL_MS || "", 10) || 15000;
  let parsed = null;

  while (Date.now() - startedAt < timeoutMs) {
    parsed = fetchStatus(state.id);
    const status = parsed.status ?? "Unknown";
    console.log(`[notarize] ${new Date().toISOString()} status=${status}`);
    if (status === "Accepted" || status === "Invalid" || status === "Rejected") {
      break;
    }
    sleep(pollMs);
  }

  if (!parsed) {
    throw new Error("Failed to fetch notarization status.");
  }

  writeState({
    ...state,
    status: parsed.status ?? state.status,
    completedAt: new Date().toISOString(),
    response: parsed,
  });

  if (parsed.status !== "Accepted") {
    try {
      const log = fetchLog(state.id);
      console.error(JSON.stringify(log, null, 2));
    } catch (error) {
      console.error(`Failed to fetch notarization log: ${error.message || error}`);
    }
    throw new Error(`Notarization did not succeed: ${parsed.status || "unknown"}`);
  }

  stapleAcceptedArtifacts(state);
}

if (command === "submit") {
  submit();
} else if (command === "wait") {
  waitForCompletion();
} else {
  console.error("Usage: node scripts/notarize-mac.js <submit|wait>");
  process.exit(1);
}
