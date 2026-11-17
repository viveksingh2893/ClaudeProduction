# Kisan4U — Android app (Expo)

Native React Native/Expo app for customers, dealers, and sellers. Talks to the
same backend/database as the website — see `/api/mobile/v1/**` in
`apps/web`. **Never** connects to Postgres directly.

## 1. One-time setup

```bash
# from the repo root
pnpm install
cp apps/mobile/.env.example apps/mobile/.env.local
```

Edit `apps/mobile/.env.local` and set `EXPO_PUBLIC_API_URL` to your
computer's LAN IP (see step 3) — **not** `localhost`, since the phone is a
separate device on the network.

## 2. Start the backend on your LAN

By default `next dev` only binds to `localhost`, which your phone can't
reach. Bind it to all interfaces instead:

```bash
pnpm --filter web dev -- --hostname 0.0.0.0
```

Leave this running. It serves both the website and `/api/mobile/v1/**`.

## 3. Find your computer's LAN IP (Windows)

```powershell
ipconfig
```

Look for **IPv4 Address** under your active adapter (usually "Wireless LAN
adapter Wi-Fi"), e.g. `192.168.1.10`. Put that in `.env.local`:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
```

Your phone and computer **must be on the same Wi-Fi network**.

## 4. Windows Firewall

Windows will usually prompt to allow Node.js through the firewall the first
time you run the dev server — click **Allow**. If it doesn't, or you
blocked it previously, add a rule manually (run PowerShell as
Administrator):

```powershell
New-NetFirewallRule -DisplayName "Kisan4U dev server" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

If the phone still can't reach the server, temporarily disable any
third-party firewall/VPN and confirm both devices show the same Wi-Fi
network name (not a guest network — many routers isolate guest devices from
each other).

## 5. Android build tooling

Building the Android app locally (`expo run:android` / a debug APK) needs
the Android SDK and a JDK. **Check what you have:**

```powershell
adb --version
java -version
```

### If both are missing (shortest path)

1. Install [Android Studio](https://developer.android.com/studio) — during
   setup, let it install the Android SDK and an embedded JDK for you. This
   is the simplest path; you don't need to use the Android Studio IDE
   itself, just its SDK installer.
2. After install, set environment variables (Android Studio usually offers
   to do this, or set them yourself):
   - `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`
   - Add `%ANDROID_HOME%\platform-tools` to `PATH`
3. Open a **new** terminal (so the PATH change takes effect) and re-run
   `adb --version` to confirm.
4. On your phone: **Settings → About phone → tap "Build number" 7 times**
   to enable Developer Options, then **Settings → Developer options → USB
   debugging → on**.

### Build and install the debug APK

```bash
cd apps/mobile
npx expo run:android
```

This builds a debug **development client** APK and installs it on a
connected device/emulator automatically. The APK itself lands at:

```
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

To install it manually on a different device: `adb install -r app-debug.apk`
(with the phone connected via USB and USB debugging on), or copy the file
to the phone and open it (enable "install from unknown sources" if asked).

### No Android tooling yet, but want to see the app right now

Install **Expo Go** from the Play Store, then:

```bash
cd apps/mobile
npx expo start --lan
```

Scan the QR code with the Expo Go app. This works today with zero native
build tooling because every module this app currently uses ships inside
Expo Go. It's a good way to preview the app while you set up Android
Studio — but switch to the Dev Client build above before adding any real
native module (camera, etc.), since Expo Go can't load custom native code.

## 6. Daily development (after the dev-client APK is installed once)

```bash
cd apps/mobile
npx expo start --dev-client --lan
```

Open the Kisan4U dev-client app on your phone — it connects to Metro over
your LAN automatically (or scan the QR code the first time). From here,
**Fast Refresh** applies ordinary JS/TS/React/styling/API changes
instantly, no reinstall needed.

### Alternative: USB + `adb reverse`

If LAN discovery is flaky, plug the phone in via USB (with USB debugging
on) and run:

```bash
adb reverse tcp:8081 tcp:8081
```

This forwards the Metro bundler port over USB instead of Wi-Fi. You still
need `EXPO_PUBLIC_API_URL` reachable — either keep it as your LAN IP (USB
doesn't affect API calls, only the Metro connection), or additionally run
`adb reverse tcp:3000 tcp:3000` and set `EXPO_PUBLIC_API_URL=http://localhost:3000`
so the phone reaches the API over the same USB tunnel.

## 7. Changes that need a rebuild vs. Fast Refresh

| Change | Rebuild APK? |
|---|---|
| Screen/component logic, styling, navigation | No — Fast Refresh |
| API calls, business logic in `src/lib/**` | No — Fast Refresh |
| New npm package that's pure JS | No — Fast Refresh (after `pnpm install`) |
| New package with native code (e.g. camera, maps) | **Yes** |
| `app.json` changes: permissions, package id, icons, splash, plugins | **Yes** |
| Adding/changing an Expo config plugin | **Yes** |

When a rebuild is needed: `npx expo run:android` again (or `npx expo
prebuild --clean` first if native config changed significantly).

## 8. Production builds (not covered by the above)

Production builds must use HTTPS and must **not** enable
`android:usesCleartextTraffic`. This app doesn't set that flag in
`app.json` on purpose — Android's default debug manifest already allows
cleartext for local dev builds only; release builds default to
HTTPS-only. Don't "fix" LAN connectivity by adding cleartext permission
app-wide — that would weaken production too.

## Project structure

```
src/
  app/            Expo Router screens ((auth) and (app) route groups)
  components/     Reusable UI (src/components/ui) + domain components
  context/        AuthProvider / useAuth
  lib/api/        Typed wrappers per API domain (catalog, cart, orders, …)
  lib/api-client.ts   Central fetch client: auth header, refresh, errors
  lib/secure-storage.ts  Token storage (expo-secure-store, OS keystore)
  constants/theme.ts  Kisan4U brand colors/spacing (mirrors packages/ui)
```
