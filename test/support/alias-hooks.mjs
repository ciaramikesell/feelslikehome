// Resolves the app's `@/…` import alias (jsconfig.json: "@/*" -> "src/*") so
// tests can execute real modules such as src/lib/supabase/collaboration.js.
// Registered per test file with module.register(); not a *.test.js file, so
// `node --test test/*.test.js` never runs it directly.
const SRC = new URL('../../src/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC).href;
    for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
      try { return await nextResolve(candidate, context); } catch { /* try the next extension */ }
    }
  }
  return nextResolve(specifier, context);
}
