#!/usr/bin/env node

const execa = require('execa');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

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

function findPackagedAppDir(rootDir) {
  // Next's standalone output preserves part of the absolute path under `standalone/`,
  // so the app dir isn't stable. Find the directory that contains `server.js` and `package.json`.
  const isStandaloneAppDir = (dir) => {
    try {
      if (!fs.existsSync(path.join(dir, 'server.js'))) return false;
      if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
      if (fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) return true;
      if (fs.existsSync(path.join(dir, '.next', 'package.json'))) return true;
      return false;
    } catch {
      return false;
    }
  };

  const maxDepth = 8;
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (isStandaloneAppDir(dir)) return dir;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git') continue;
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

async function bundleWorker({ appDir }) {
  const entry = path.join(cloudRoot, 'worker', 'index.ts');
  ensureExists(entry, 'Worker entrypoint');
  const workerOutDir = path.join(appDir, 'worker');
  fs.mkdirSync(workerOutDir, { recursive: true });

  console.log('[agx] Bundling embedded orchestrator worker...');
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(workerOutDir, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node18'],
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'agx-cloud-alias-at',
        setup(build) {
          const tryResolve = (basePath) => {
            const candidates = [
              basePath,
              `${basePath}.ts`,
              `${basePath}.tsx`,
              `${basePath}.js`,
              `${basePath}.mjs`,
              `${basePath}.cjs`,
              path.join(basePath, 'index.ts'),
              path.join(basePath, 'index.tsx'),
              path.join(basePath, 'index.js'),
              path.join(basePath, 'index.mjs'),
              path.join(basePath, 'index.cjs'),
            ];
            for (const p of candidates) {
              try {
                if (fs.existsSync(p)) return p;
              } catch { }
            }
            return null;
          };
          build.onResolve({ filter: /^@\// }, (args) => {
            const rel = args.path.slice(2); // "@/foo" -> "foo"
            const base = path.join(cloudRoot, rel);
            const resolved = tryResolve(base);
            if (!resolved) return { errors: [{ text: `Unable to resolve alias import: ${args.path}` }] };
            return { path: resolved };
          });
        },
      },
    ],
  });
}

async function main() {
  ensureExists(cloudRoot, 'agx-cloud repository');
  // Optional: keep local stack template schema in sync with agx-cloud.
  if (fs.existsSync(postgresInitSrc)) {
    fs.mkdirSync(postgresInitDest, { recursive: true });
    fs.cpSync(postgresInitSrc, postgresInitDest, { recursive: true });
  }

  console.log('[agx] Building AGX Board runtime from agx-cloud...');
  // Next can leave stale route artifacts behind in `.next/` (esp. around app router + API routes).
  // Packaging should be deterministic, so always build from a clean `.next/`.
  try {
    fs.rmSync(path.join(cloudRoot, '.next'), { recursive: true, force: true });
  } catch { }
  execa.commandSync('npm run build', { cwd: cloudRoot, stdio: 'inherit' });

  ensureExists(standaloneSrc, 'Next standalone output');
  ensureExists(staticSrc, 'Next static output');

  cleanAndPrepare();

  const standaloneDest = path.join(cloudRuntimeDir, 'standalone');
  copyDir(standaloneSrc, standaloneDest);

  const appDir = findPackagedAppDir(standaloneDest);
  if (!appDir) {
    throw new Error(`Unable to locate packaged agx-cloud app dir under ${standaloneDest}`);
  }

  // Next serves assets relative to the app dir (where `server.js` lives), not the standalone root.
  const staticDest = path.join(appDir, '.next', 'static');
  copyDir(staticSrc, staticDest);

  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(appDir, 'public');
    copyDir(publicSrc, publicDest);
  }

  const scriptsSrc = path.join(cloudRoot, 'scripts');
  if (fs.existsSync(scriptsSrc)) {
    const scriptsDest = path.join(appDir, 'scripts');
    copyDir(scriptsSrc, scriptsDest);
  }

  // Ensure the embedded worker exists even when Next standalone output does not include it.
  // The CLI will run it via `node worker/index.js` for bundled runtimes.
  await bundleWorker({ appDir });

  console.log(`[agx] Embedded board runtime at ${standaloneDest}`);
}

try {
  main().catch((error) => {
    console.error(`[agx] Failed to package board runtime: ${error.message}`);
    process.exit(1);
  });
} catch (error) {
  console.error(`[agx] Failed to package board runtime: ${error.message}`);
  process.exit(1);
}
