# agx iPad

SwiftUI WebView shell for connecting to your agx instances over Tailscale. Uses `NavigationSplitView` so the host list is a permanent sidebar on iPad and adapts to a stack on iPhone.

## Setup

Xcode projects are awkward to commit by hand — create one and drop these files in:

1. Xcode → File → New → Project → **iOS / App**.
   - Product Name: `agx`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Save it inside `apps/mobile/ipad/` (let Xcode create its own `agx.xcodeproj`).
2. Delete the auto-generated `agxApp.swift` and `ContentView.swift`.
3. In Finder, copy the four `.swift` files from `apps/mobile/ipad/agx/` into the new Xcode project's `agx/` group (drag into Xcode, "Copy if needed" off — they should reference in place).
4. Targets → Deployment: iPadOS 17 / iOS 17. Supported devices: iPad + iPhone.
5. Install Tailscale on the iPad and sign into the same tailnet as your agx host.
6. Build & run.

## Files

- `agxApp.swift` — app entry, owns the `HostStore`.
- `HostStore.swift` — `UserDefaults`-backed list of `Host { name, url, lastUsed }`.
- `ContentView.swift` — split view (sidebar list + WebView detail), add/edit sheet.
- `WebView.swift` — `WKWebView` wrapper with reload + error reporting.

## Use

- **+** in the sidebar adds a host (name + URL, e.g. `https://moltbook.tail-xxxx.ts.net`).
- Tap a row → loads in the right pane (iPad) or pushes (iPhone).
- Swipe a row for Edit / Delete; long-press for the same.
- Reload via the toolbar refresh icon.
