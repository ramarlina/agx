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

const TARGETS = [
  { key: "zip", getPath: () => zipPath },
  { key: "dmg", getPath: () => dmgPath },
];

function submitOne(artifactPath) {
  const raw = runNotarytool([
    "submit",
    artifactPath,
    ...credentialsArgs(),
    "--output-format",
    "json",
  ]);
  const parsed = JSON.parse(raw);
  if (!parsed?.id) {
    throw new Error(`Notary submission did not return an id: ${raw}`);
  }
  return { id: parsed.id, status: parsed.status ?? "Submitted" };
}

function submit() {
  ensureArtifactsExist();
  const submissions = {};
  for (const target of TARGETS) {
    const artifactPath = target.getPath();
    console.log(`Submitting ${path.basename(artifactPath)} for notarization...`);
    const result = submitOne(artifactPath);
    submissions[target.key] = { ...result, path: artifactPath };
    console.log(`  ${target.key}: ${result.id} (${result.status})`);
  }
  writeState({
    submissions,
    appPath,
    submittedAt: new Date().toISOString(),
  });
  console.log(`Saved state to ${statePath}`);
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

function waitForSubmission(key, submission) {
  if (submission.status === "Accepted") {
    console.log(`[${key}] Already accepted: ${submission.id}`);
    return submission;
  }

  const startedAt = Date.now();
  const timeoutMs = Number.parseInt(process.env.NOTARIZE_TIMEOUT_MS || "", 10) || 45 * 60 * 1000;
  const pollMs = Number.parseInt(process.env.NOTARIZE_POLL_MS || "", 10) || 15000;
  let parsed = null;

  while (Date.now() - startedAt < timeoutMs) {
    parsed = fetchStatus(submission.id);
    const status = parsed.status ?? "Unknown";
    console.log(`[notarize] [${key}] ${new Date().toISOString()} status=${status}`);
    if (status === "Accepted" || status === "Invalid" || status === "Rejected") {
      break;
    }
    sleep(pollMs);
  }

  if (!parsed) {
    throw new Error(`[${key}] Failed to fetch notarization status.`);
  }

  if (parsed.status !== "Accepted") {
    try {
      const log = fetchLog(submission.id);
      console.error(JSON.stringify(log, null, 2));
    } catch (error) {
      console.error(`Failed to fetch notarization log: ${error.message || error}`);
    }
    throw new Error(`[${key}] Notarization did not succeed: ${parsed.status || "unknown"}`);
  }

  return { ...submission, status: parsed.status, response: parsed };
}

function waitForCompletion() {
  const state = readState();
  if (!state.submissions) {
    throw new Error(`Legacy notarization state detected. Delete ${statePath} and re-run submit.`);
  }

  const updated = {};
  for (const [key, submission] of Object.entries(state.submissions)) {
    updated[key] = waitForSubmission(key, submission);
  }

  writeState({
    ...state,
    submissions: updated,
    completedAt: new Date().toISOString(),
  });

  // The zip submission notarizes the .app inside; staple the .app directly.
  // The dmg submission notarizes the .dmg itself; staple it.
  const appTarget = state.appPath || appPath;
  stapleWithRetry(appTarget);
  console.log(`Stapled ${appTarget}`);

  if (updated.dmg) {
    const dmgTarget = updated.dmg.path || dmgPath;
    stapleWithRetry(dmgTarget);
    console.log(`Stapled ${dmgTarget}`);
  }

  console.log(`Notarization accepted for all submissions.`);
}

if (command === "submit") {
  submit();
} else if (command === "wait") {
  waitForCompletion();
} else {
  console.error("Usage: node scripts/notarize-mac.js <submit|wait>");
  process.exit(1);
}
