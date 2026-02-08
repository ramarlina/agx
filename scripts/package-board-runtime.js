#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const agxRoot = path.resolve(__dirname, '..');
const cloudRoot = path.resolve(agxRoot, '..', 'agx-cloud');
const cloudRuntimeDir = path.join(agxRoot, 'cloud-runtime');
const standaloneSrc = path.join(cloudRoot, '.next', 'standalone');
const staticSrc = path.join(cloudRoot, '.next', 'static');
const publicSrc = path.join(cloudRoot, 'public');
const stackTemplateDir = path.join(agxRoot, 'templates', 'stack');
const postgresInitSrc = path.join(cloudRoot, 'docker', 'postgres', 'init');
const postgresInitDest = path.join(stackTemplateDir, 'postgres', 'init');

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found at ${targetPath}`);
  }
}

function cleanAndPrepare() {
  fs.rmSync(cloudRuntimeDir, { recursive: true, force: true });
  fs.mkdirSync(cloudRuntimeDir, { recursive: true });
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function main() {
  ensureExists(cloudRoot, 'agx-cloud repository');
  // Optional: keep local stack template schema in sync with agx-cloud.
  if (fs.existsSync(postgresInitSrc)) {
    fs.mkdirSync(postgresInitDest, { recursive: true });
    fs.cpSync(postgresInitSrc, postgresInitDest, { recursive: true });
  }

  console.log('[agx] Building AGX Board runtime from agx-cloud...');
  execSync('npm run build', { cwd: cloudRoot, stdio: 'inherit' });

  ensureExists(standaloneSrc, 'Next standalone output');
  ensureExists(staticSrc, 'Next static output');

  cleanAndPrepare();

  const standaloneDest = path.join(cloudRuntimeDir, 'standalone');
  copyDir(standaloneSrc, standaloneDest);

  // Next standalone expects static assets inside standalone/.next/static.
  const staticDest = path.join(standaloneDest, '.next', 'static');
  copyDir(staticSrc, staticDest);

  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(standaloneDest, 'public');
    copyDir(publicSrc, publicDest);
  }

  const scriptsSrc = path.join(cloudRoot, 'scripts');
  if (fs.existsSync(scriptsSrc)) {
    const scriptsDest = path.join(standaloneDest, 'scripts');
    copyDir(scriptsSrc, scriptsDest);
  }

  console.log(`[agx] Embedded board runtime at ${standaloneDest}`);
}

try {
  main();
} catch (error) {
  console.error(`[agx] Failed to package board runtime: ${error.message}`);
  process.exit(1);
}
