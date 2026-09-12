// Capacitor config for the Feels Like Home iOS shell.
//
// This app runs in "remote-hosted" mode: the native WebView loads the real,
// live Next.js app over HTTPS (server.url below) instead of bundling a
// static copy of it. See docs/capacitor-ios-foundation.md for the full
// rationale — in short, this app's auth gating and two API routes
// (/api/import-listing, /api/commute) require a live Next.js server and
// server-only secrets, which a fully static Capacitor bundle can't provide
// without a much larger backend rearchitecture.
//
// webDir below is required by Capacitor's tooling but is never actually
// shown to a user: once server.url is set, the native shell navigates
// straight to that URL and ignores local web assets.
//
// Dev vs. production: set CAP_SERVER_URL to point a local Capacitor build at
// a dev server (e.g. `next dev` reachable over your LAN, or a tunnel like
// ngrok) instead of production. Leaving it unset — the default for any
// release build — points at the live app, so there is no extra step needed
// to make a release build correct.
//
// cleartext stays false (HTTPS only) even for local dev — CAP_SERVER_URL
// should point at an https:// origin (`next dev --experimental-https`, or a
// tunnel) rather than flipping this on.

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'app.feelslikehome.mobile',
  appName: 'Feels Like Home',
  webDir: 'ios-shell-placeholder',
  server: {
    url: process.env.CAP_SERVER_URL || 'https://feelslikehome.app',
    cleartext: false,
  },
};

module.exports = config;
