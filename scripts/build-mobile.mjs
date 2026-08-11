// Builds the web app with VITE_API_URL baked in (for the bundled Android APK),
// then runs `cap sync android` to copy client/dist into the native project.
// Run from the project root: node scripts/build-mobile.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');
const CLIENT = resolve(ROOT, 'client');
const DEFAULT_API = 'https://backend-production-48d99.up.railway.app';

const apiUrl = process.env.VITE_API_URL_MOBILE || DEFAULT_API;
console.log(`Building mobile bundle with VITE_API_URL=${apiUrl}`);

// 1. Clean previous dist
const distDir = resolve(CLIENT, 'dist');
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

// 2. Build client with the env var injected (inherits the rest of the env).
function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

run('npm', ['run', 'build'], CLIENT, { VITE_API_URL: apiUrl });
console.log('✓ Web build complete');

// 2b. Ensure the android/ native project exists (it's gitignored).
const androidDir = resolve(ROOT, 'android');
if (!existsSync(androidDir)) {
  console.log('android/ missing — running `npx cap add android`...');
  run('npx', ['cap', 'add', 'android'], ROOT);
}

// 3. Capacitor sync (copies dist → android/app/src/main/assets/public)
run('npx', ['cap', 'sync', 'android'], ROOT);
console.log('✓ Capacitor sync complete — Android project ready.');
console.log('');
console.log('Next: open in Android Studio to build the APK:');
console.log('  npx cap open android');
console.log('  → Build > Build Bundle(s)/APK(s) > Build APK(s)');
