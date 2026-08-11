# Building the Android APK

Two paths — both **leave the web version 100% untouched**. The web app keeps
auto-deploying to Vercel from `client/` regardless of which path you pick.

---

## Path A — PWABuilder (fastest, zero local tooling, < 10 min)

The web app is already a valid PWA (manifest + service worker + icons + HTTPS).
PWABuilder packages the **live URL** into an Android TWA (Trusted Web Activity).

### Steps
1. Open https://www.pwabuilder.com
2. Enter the live URL: `https://client-three-zeta-93.vercel.app`
3. Click **"Start"** → it validates the PWA (all green ✓)
4. Click **"Package for Stores"** → select **Android**
5. Set:
   - **Package ID:** `com.vibroscan.ai`
   - **App name:** `VibrationCheck`
   - **Signing key:** generate new (or use existing)
6. Click **"Generate"** → downloads a `.zip` containing:
   - `app-release-universal.apk` — **install this directly on any Android phone**
   - `assetlinks.json` — place at `client/public/.well-known/assetlinks.json`
     (removes the URL bar for a seamless full-screen experience)
7. **(Optional, for seamless TWA)** Save the `assetlinks.json` from the zip into
   `client/public/.well-known/assetlinks.json`, then push → Vercel auto-redeploys.

### Install the APK on a phone
- Transfer `app-release-universal.apk` to the phone → open → allow installs from
  unknown sources → install. Done.
- The app loads the live Vercel URL, so any web update instantly reflects in the app.

---

## Path B — Capacitor (full native build, offline-capable APK)

This project has Capacitor scaffolding at the root. The `android/` native project
bundles the web build (`client/dist`) directly inside the APK — so it works offline
and doesn't need a browser. The bundled app calls your Railway backend over HTTPS.

### Prerequisites (one-time)
- **Android Studio** (https://developer.android.com/studio) — includes the Android
  SDK + Gradle. Required to build the APK.
- **Java 17** — already installed on this machine ✓

### Build steps
```powershell
# From the project root:
npm run mobile:build        # builds client/dist with VITE_API_URL → syncs to android/
npm run mobile:open         # opens the android/ project in Android Studio
```

In Android Studio:
1. Wait for Gradle sync to complete
2. **Build > Build Bundle(s)/APK(s) > Build APK(s)**
3. Click "locate" in the notification → find `app-debug.apk`
4. Transfer to phone → install

### Customising the backend URL for mobile
The mobile build bakes in `VITE_API_URL` at compile time. The default is your live
Railway backend:
```
https://backend-production-48d99.up.railway.app
```
To change it, set the env var before building:
```powershell
$env:VITE_API_URL_MOBILE = 'https://your-other-backend.com'
npm run mobile:build
```

### Updating the APK after web changes
```powershell
npm run mobile:build   # rebuilds web + syncs to android/
# Then rebuild the APK in Android Studio
```

---

## Architecture (why the web version is untouched)

```
VibrationCheck/
├── client/          ← WEB APP (Vercel auto-deploys from here, unmodified)
├── server/          ← BACKEND (Railway, unmodified)
├── android/         ← Capacitor native project (gitignored, regenerable)
├── capacitor.config.json  ← webDir: "client/dist" (points at web build, read-only)
├── package.json     ← mobile build scripts (root-level, doesn't affect client/)
└── scripts/
    └── build-mobile.mjs  ← builds client + syncs to android
```

Both paths read from the same `client/dist` build output. Neither modifies any
file inside `client/src/` or `server/src/`. The web app's build, deploy, and
auto-update pipeline is completely independent.
