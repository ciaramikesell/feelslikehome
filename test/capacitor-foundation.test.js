import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isNativeApp } from '../src/lib/platform.js';
import capacitorConfig from '../capacitor.config.js';

const installPrompt = fs.readFileSync('src/components/InstallPrompt.jsx', 'utf8');
const configSource = fs.readFileSync('capacitor.config.js', 'utf8');

test('isNativeApp resolves safely to false outside a Capacitor shell (e.g. this Node test run, or SSR)', () => {
  // @capacitor/core resolves platform detection against globalThis with
  // optional chaining and falls back to "web" when no native bridge is
  // present — this is what actually guarantees SSR-safety, exercised here
  // for real rather than just asserted by reading the library's source.
  assert.equal(isNativeApp(), false);
});

test('the PWA install prompt and its service worker registration are gated off inside the native shell', () => {
  assert.match(installPrompt, /import \{ isNativeApp \} from '@\/lib\/platform'/);
  assert.match(installPrompt, /if \(isNativeApp\(\)\) return;[\s\S]*navigator\.serviceWorker\.register/);
});

test('capacitor.config.js resolves the remote-hosted production shell by default, HTTPS-only', () => {
  assert.equal(capacitorConfig.appName, 'Feels Like Home');
  assert.equal(capacitorConfig.server.url, 'https://feelslikehome.app');
  assert.equal(capacitorConfig.server.cleartext, false);
});

// The actual env-var override can't be exercised by re-importing this same
// ES module within one test run (Node caches ES module evaluation per
// resolved specifier — a second import with a mutated process.env wouldn't
// re-run the file), so this checks the source directly instead.
test('capacitor.config.js lets CAP_SERVER_URL override the server url for local/dev builds without editing the file', () => {
  assert.match(configSource, /process\.env\.CAP_SERVER_URL \|\| 'https:\/\/feelslikehome\.app'/);
});
