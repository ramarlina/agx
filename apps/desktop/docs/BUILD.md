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

# Build DMG + ZIP for macOS
npm run build:mac

# Submit for notarization (returns quickly with a submission id)
npm run notarize:mac:submit

# Wait for Apple + staple app and DMG
npm run notarize:mac:wait

# Or run the full notarization flow
npm run notarize:mac

# Full build + print the GitHub release command
npm run release:prep

# Full build + notarize + print the GitHub release command
npm run release:prep:notarized
```

### Build pipeline

`build:icon` → `build:next` → `fix-standalone` → `build:cli` → `build:node` → `electron-builder` → `post-pack`

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

`electron-builder` notarization is disabled in-package so builds do not block inside `notarytool --wait`.

Instead, notarize in two explicit steps:

```bash
npm run notarize:mac:submit
npm run notarize:mac:wait
```

`notarize:mac:submit` submits the generated ZIP to Apple and writes the submission state to `dist/notarization.json`.

`notarize:mac:wait` waits for Apple to finish, staples the `.app`, and then retries DMG stapling:

- `dist/mac-arm64/AGX.app`
- `dist/agx-<version>-arm64.dmg`

If the DMG ticket has not propagated yet, DMG stapling may still fail after retries even though Apple has already accepted the notarization. In that case the `.app` is still notarized and stapled, and macOS can verify the DMG notarization online during install.

### Without signing (local testing only)

If no signing env vars are set, electron-builder falls back to ad-hoc signing. The app works locally but will be blocked by Gatekeeper on other machines.

## Release Flow

Releases are published as **GitHub Releases** on the `agx` repo (release artifacts are too large for git).

```bash
# 1. Bump version in package.json/package-lock.json

# 2. Build and notarize locally
npm run release:prep:notarized

# 3. Publish the generated artifacts from apps/desktop/dist
gh release create app-v0.1.1 \
  dist/AGX-0.1.1-arm64.dmg \
  dist/AGX-0.1.1-arm64-mac.zip \
  dist/AGX-0.1.1-arm64.dmg.blockmap \
  dist/AGX-0.1.1-arm64-mac.zip.blockmap \
  dist/agx-latest.dmg \
  dist/agx-latest.zip \
  dist/latest-mac.yml \
  --title "AGX v0.1.1" \
  --notes "Release notes here"
```

`release:prep` and `release:prep:notarized` build the current app version, write release artifacts into `dist/`, and print the `gh release create ...` command for the current version.

The `electron-updater` auto-update mechanism reads from GitHub Releases (configured in `package.json` under `publish`).

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
