// Pure builder for the apple-app-site-association document — kept dependency
// -free (no next/server) so it's directly testable; see
// src/app/.well-known/apple-app-site-association/route.js for the actual
// Route Handler that serves this, and test/universal-links.test.js for
// coverage.
const BUNDLE_ID = 'app.feelslikehome.mobile';

// Product routes are eligible for Universal Links by default; only
// infrastructure paths are excluded. This is a durable policy, not a list of
// every current screen — a future product route (including a future
// Realtor/helper surface) never requires touching this file.
const EXCLUDED_COMPONENTS = [
  { '/': '/api/*', exclude: true, comment: 'API routes are not product destinations' },
  { '/': '/_next/*', exclude: true, comment: 'Next.js build assets' },
  { '/': '/.well-known/*', exclude: true, comment: 'Infra/well-known files, including this one' },
  { '/': '*.ico', exclude: true },
  { '/': '*.svg', exclude: true },
  { '/': '*.png', exclude: true },
  { '/': '*.jpg', exclude: true },
  { '/': '*.jpeg', exclude: true },
  { '/': '*.gif', exclude: true },
  { '/': '*.webp', exclude: true },
];

// `teamId` needs a real Apple Developer Team ID, which isn't committed to
// the repo (it's account-specific, not a secret, just not yet knowable from
// source — see docs/universal-links.md). With an empty/missing teamId this
// still returns a fully spec-valid AASA document (a caller can always
// serialize it as 200/JSON/no-redirect) with an empty `details` array, which
// simply grants no app association yet, rather than shipping a guessed or
// placeholder identifier.
export function buildAasa(teamId) {
  const details = teamId
    ? [{
        appIDs: [`${teamId}.${BUNDLE_ID}`],
        components: [...EXCLUDED_COMPONENTS, { '/': '*' }],
      }]
    : [];
  // `apps` is a legacy key Apple's own current docs still show as present
  // (always empty) alongside `details` — kept for maximum tooling/back-compat.
  return { applinks: { apps: [], details } };
}
