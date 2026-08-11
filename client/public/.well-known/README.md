# Digital Asset Links (for Android TWA — PWABuilder path)

This folder serves `/.well-known/assetlinks.json` from the web app's domain.

## Why
A Trusted Web Activity (TWA) APK — the kind PWABuilder generates — wraps the live
web URL. For the APK to open WITHOUT a browser URL bar, Android verifies a
"Digital Asset Link" between the APK's signing key and the web domain.

## How
After you generate the APK on https://www.pwabuilder.com, it gives you the exact
contents of `assetlinks.json` (with the SHA-256 fingerprint of the APK signing
key). Save that content as `assetlinks.json` in this folder, then redeploy the
web app (Vercel auto-rebuilds on push). The TWA then opens full-screen.

Until then, the APK still works — it just briefly shows the URL bar (Chrome
Custom Tab mode).
