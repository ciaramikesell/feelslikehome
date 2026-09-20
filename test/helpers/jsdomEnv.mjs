// Minimal jsdom global bootstrap for node:test — this project has no other
// component-rendering tests, so there is no existing harness to reuse.
// Import this (for its side effect) before importing React/testing-library
// in any test that needs to render a component.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

const setGlobal = (key, value) => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
};

for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try { setGlobal(key, dom.window[key]); } catch { /* a handful of window globals still refuse redefinition; skip */ }
}
// Node 21+ ships its own read-only `navigator`/`fetch` globals — jsdom's
// versions must win here since components render against jsdom's DOM.
setGlobal('window', dom.window);
setGlobal('document', dom.window.document);
setGlobal('navigator', dom.window.navigator);
setGlobal('HTMLElement', dom.window.HTMLElement);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
