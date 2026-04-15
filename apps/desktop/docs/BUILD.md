# AGX Desktop App — Build & Release Guide

## Architecture

The Electron app bundles three projects into a single macOS application:

- **Dashboard** — Next.js standalone server from `../local`, runs on `localhost:41841`
- **CLI** — Full `@mndrk/agx` CLI with all dependencies
- **Node.js runtime** — Bundled Node.js binary (no system Node.js required)
- **Shell wrapper** — `bin/agx` script for PATH integration

### How it works

1. Electron launches and spawns the Next.js standalone server using the **bundled** Node.js binary
2. A `BrowserWindow` loads the dashboard from `http://127.0.0.1:<port>`
3. If port 41841 is taken, it auto-increments until a free port is found
4. The bundled CLI is available at `Resources/cli/index.js` inside the app
5. Users can install the CLI to `/usr/local/bin/agx` via Help → Install CLI

### Key files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process — server lifecycle, window, menu, auto-updater |
| `preload.js` | Exposes `window.agxDesktop` (platform, versions) to renderer |
| `entitlements.plist` | macOS entitlements for hardened runtime |
| `scripts/generate-icon.js` | Regenerates `assets/icon.icns` when the source art is large enough; otherwise reuses the checked-in `.icns` |
| `scripts/bundle-cli.js` | Copies CLI source + installs prod deps + rebuilds native modules |
| `scripts/bundle-node.js` | Downloads and bundles the Node.js binary matching the build-time version |
| `scripts/fix-standalone.js` | Replaces symlinks in Next.js standalone + saves build info |
| `scripts/post-pack.js` | Creates `agx-latest.dmg`/`.zip` aliases |

### Logging

The app writes startup/server logs to `~/Library/Logs/agx/agx.log`.

Chat launch debugging logs are written to `~/.agx/logs/desktop-chat-debug.log`.

## Build Commands

```bash
# If Homebrew Node isn't on PATH:
export PATH=/opt/homebrew/bin:$PATH

# Development (connects to the local board workspace in `../local`)
npm run dev

# Build to directory (fast, for testing)
npm run pack

# Build DMG + ZIP for macOS (no publish, no notarize)
npm run build:mac

# Submit BOTH .zip and .dmg for notarization, returns quickly with ids
npm run notarize:mac:submit

# Wait for Apple to accept both, then staple .app + .dmg
npm run notarize:mac:wait

# submit + wait in one go
npm run notarize:mac

# Full build + print the GitHub release command
npm run release:prep

# Full build + notarize + print the GitHub release command
npm run release:prep:notarized
```

### Build pipeline

`build:icon` → `build:next` → `fix-standalone` → `build:cli` → `build:node` → `electron-builder --mac --publish never` → `post-pack`

`--publish never` is important: the `publish` entry in `package.json`
targets the `ramarlina/agx` repo, and without this flag electron-builder
will try to POST directly to the GitHub Releases API during the build.
The separate `gh release create` step at the end of the release flow
handles the actual upload.

## Code Signing & Notarization

Required for distributing outside the Mac App Store (Gatekeeper).

### Prerequisites

1. An Apple Developer account ($99/year) at https://developer.apple.com
2. A **Developer ID Application** certificate (Keychain Access → Certificate Assistant → Request from CA, then download from developer.apple.com)
3. An app-specific password from https://appleid.apple.com (Security → App-Specific Passwords)

### Environment variables

```bash
# Certificate — either by name (if in Keychain):
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"

# Or by .p12 file (for CI):
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD=your-p12-password

# Notarization with Apple ID (required for macOS Ventura+):
export APPLE_ID=your@apple.id
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX

# Or notarization with App Store Connect API key:
export APPLE_API_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Signing locally

```bash
# With env vars set:
npm run build:mac
```

The build will:
1. Sign the app with your Developer ID certificate
2. Produce the signed app + DMG/ZIP

### Notarizing explicitly

`electron-builder`'s built-in notarization and publisher are both disabled
(`build:mac` passes `--publish never`) so builds do not block inside
`notarytool --wait` or try to hit the GitHub Releases API with the wrong
token.

Notarize in two explicit steps:

```bash
npm run notarize:mac:submit
npm run notarize:mac:wait
```

`notarize:mac:submit` submits **both** the generated `.zip` and the `.dmg`
to Apple as separate notarization jobs and writes the submission state
(ids + paths) to `dist/notarization.json`.

`notarize:mac:wait` polls both submissions until Apple accepts them, then
staples the ticket onto:

- `dist/mac-arm64/AGX.app` (from the `.zip` notarization)
- `dist/AGX-<version>-arm64.dmg` (from the `.dmg` notarization)

Both artifacts end up with a stapled ticket, so Gatekeeper can verify them
offline. Run `xcrun stapler validate <path>` on either artifact to
double-check before uploading to GitHub.

### Without signing (local testing only)

If no signing env vars are set, electron-builder falls back to ad-hoc signing. The app works locally but will be blocked by Gatekeeper on other machines.

## Release Flow

Desktop releases are built, notarized, and uploaded **locally** — there is
no CI workflow for them. The previous `release-agx-app.yml` was removed
because the GitHub Actions `macos-latest` runner plus Apple's notarization
queue often pushed the build past the step timeout, and the macOS runner
adds ~4 extra minutes compared to a local build.

Releases are published as **GitHub Releases** on the `agx` repo (release
artifacts are too large to commit).

```bash
# From the repo root:

# 1. Bump version in apps/desktop/package.json (+ package-lock.json "apps/desktop")
#    Usually align with the CLI version so both ship together.

# 2. Full build + notarize + staple, from the workspace
npm run release:prep:notarized --workspace apps/desktop
```

The last step prints a ready-to-run `gh release create app-v<version> ...`
command listing every artifact in `apps/desktop/dist` that belongs to the
current version plus the `agx-latest.*` + `latest-mac.yml` aliases used by
electron-updater. Paste it to publish, or adapt and run by hand:

```bash
cd apps/desktop
gh release create app-v2.3.1 \
  dist/AGX-2.3.1-arm64.dmg \
  dist/AGX-2.3.1-arm64-mac.zip \
  dist/AGX-2.3.1-arm64.dmg.blockmap \
  dist/AGX-2.3.1-arm64-mac.zip.blockmap \
  dist/agx-latest.dmg \
  dist/agx-latest.zip \
  dist/latest-mac.yml \
  --title "AGX v2.3.1" \
  --generate-notes
```

`--generate-notes` lets GitHub pull commit subjects since the previous
release into the release body; replace with `--notes "..."` if you want to
write them by hand. Drop `--draft` if you want it live immediately, or
keep it as a draft first and run `gh release edit app-v<version> --draft=false`
once you've reviewed it.

The `electron-updater` auto-update mechanism reads from GitHub Releases
(configured in `package.json` under `publish`); once the release is
published, existing users on older v2.x builds pick it up automatically.

## Download Page (agx-web)

A download section was added to `../agx-web/src/App.tsx` with:

- **AGX for Mac** card — links to `https://github.com/ramarlina/agx/releases/latest/download/agx-latest.dmg`
- **AGX CLI** card — shows the curl install command
- **Nav link** — "Download" added to the top navigation

## Troubleshooting

### Server fails to start on launch

Check `~/Library/Logs/agx/agx.log` for the full error. Common causes:
- Missing `node_modules` in the bundled server (check extraResources config)
- Native module ABI mismatch (should not happen with bundled Node.js)

### Standalone symlink errors during build

Run `node scripts/fix-standalone.js` after `build:next`. This is already included in the build pipeline.

### `iconutil` reports `Invalid Iconset`

`assets/agx_app_icon.png` must be at least `1024x1024` to regenerate a full macOS iconset. If the source art is smaller, the build reuses the checked-in `assets/icon.icns` instead.

### `next build` fails writing inside `../local`

The desktop build writes a production standalone build into the sibling `../local/.next/` directory. If your shell environment restricts writes outside the current repo, rerun the build with permissions that allow writing to the sibling workspace.
