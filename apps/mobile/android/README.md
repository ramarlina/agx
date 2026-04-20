# agx Android

WebView shell for connecting to your agx instances over Tailscale.

## Setup

1. Open this folder in Android Studio (Hedgehog or newer).
2. Let it sync Gradle. If prompted, allow it to generate the Gradle wrapper, or run:
   ```
   gradle wrapper --gradle-version 8.7
   ```
3. Install Tailscale on the device and sign in to the same tailnet as your agx host.
4. Build & run on a device or emulator (min SDK 26).

## Use

- Tap **+** to add a host (name + URL, e.g. `https://moltbook.tail-xxxx.ts.net`).
- Tap a row to open it in a WebView.
- Edit/delete via the row's icons.
