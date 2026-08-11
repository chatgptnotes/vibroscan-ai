# Cloud build setup — generates a release keystore ONCE, stores it as a GitHub
# secret, then every `Build Android APK` workflow run produces a signed APK.
#
# WHY: Play Protect blocks unsigned / debug APKs with "package appears invalid".
# A release-signed APK installs cleanly.
#
# Run this on YOUR machine (any OS with Java — we have Java 17 here).
#   powershell -ExecutionPolicy Bypass -File scripts/generate-keystore.ps1
# It prints the exact base64 + values to paste into GitHub secrets.

$ErrorActionPreference = 'Stop'
$KEYSTORE = 'c:/Users/test/Desktop/Projects/VibrationCheck/vibroscan-release.keystore'
$ALIAS = 'vibroscan'
$STOREPASS = 'vibroscan2026'   # change me
$KEYPASS = 'vibroscan2026'     # change me
$DNAME = 'CN=VibrationCheck, OU=Dev, O=vibroscan.ai, L=Bengaluru, ST=Karnataka, C=IN'

Write-Output "=== Generating release keystore ==="
& keytool -genkeypair -v `
  -keystore $KEYSTORE `
  -storetype PKCS12 `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -alias $ALIAS `
  -storepass $STOREPASS `
  -keypass $KEYPASS `
  -dname $DNAME

if (-not (Test-Path $KEYSTORE)) { throw "keytool failed to create keystore" }
Write-Output "OK: keystore at $KEYSTORE"

Write-Output "`n=== Base64 (paste into GitHub secret ANDROID_KEYSTORE_BASE64) ==="
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($KEYSTORE))
Write-Output $b64

Write-Output "`n=== Paste these EXACT values into GitHub repo secrets ==="
Write-Output "ANDROID_KEYSTORE_BASE64   = <the base64 block above>"
Write-Output "ANDROID_KEYSTORE_PASSWORD = $STOREPASS"
Write-Output "ANDROID_KEY_ALIAS         = $ALIAS"
Write-Output "ANDROID_KEY_PASSWORD      = $KEYPASS"

Write-Output "`n=== IMPORTANT ==="
Write-Output "- Keep vibroscan-release.keystore safe (it's your signing identity)."
Write-Output "- It's gitignored -- won't be committed."
Write-Output "- Add it to .gitignore (already done)."
