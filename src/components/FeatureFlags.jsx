'use client';

import { createContext, useContext } from 'react';

// Server release flags (src/lib/featureFlags.js) for client components deep
// inside the signed-in app, without threading a prop through every page. The
// (app) layout reads the flags on the server and AppShell provides them here.
// Anything outside the provider (tests, the development preview) reads every
// flag as off — the same default as an unset environment variable.
const FeatureFlagsContext = createContext(Object.freeze({}));

export function FeatureFlagsProvider({ value, children }) {
  return <FeatureFlagsContext.Provider value={value || {}}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlag(name) {
  return Boolean(useContext(FeatureFlagsContext)[name]);
}
