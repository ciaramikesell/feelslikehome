// Node's test runner (node --test) has no JSX transform of its own. This
// compiles a .jsx component source with esbuild and imports the result as a
// real ES module, so behavioral tests can render the actual component file
// (not a hand-copied re-implementation of it) under jsdom. The compiled file
// is written inside the project (under test/.jsx-cache/) rather than the OS
// temp dir specifically so Node's normal node_modules resolution (walking up
// parent directories) still finds react/lucide-react/etc.
import { transformSync } from 'esbuild';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheParent = path.join(rootDir, 'test', '.jsx-cache');

export async function importJsx(relPath) {
  const absPath = path.join(rootDir, relPath);
  const source = readFileSync(absPath, 'utf8');
  const { code } = transformSync(source, {
    loader: 'jsx',
    jsx: 'automatic',
    format: 'esm',
    target: 'node22',
    sourcefile: absPath,
  });
  mkdirSync(cacheParent, { recursive: true });
  const dir = mkdtempSync(path.join(cacheParent, 'run-'));
  const outFile = path.join(dir, path.basename(absPath).replace(/\.jsx$/, '.mjs'));
  await writeFile(outFile, code);
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}
