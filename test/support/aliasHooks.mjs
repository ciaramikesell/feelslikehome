// Node resolve hook for tests that import application modules directly: maps
// the Next.js `@/` alias (jsconfig.json) onto ./src so real data-layer code
// (e.g. src/lib/supabase/collaboration.js) runs unmodified under node:test.
const SRC = new URL('../../src/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = new URL(specifier.slice(2), SRC);
    const withExtension = /\.[cm]?jsx?$/.test(target.pathname) ? target.href : `${target.href}.js`;
    return nextResolve(withExtension, context);
  }
  return nextResolve(specifier, context);
}
