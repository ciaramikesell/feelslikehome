// Runs src/lib/haptics.js against a simulated Capacitor environment in a
// fresh process (Capacitor's globals are read once per process) and prints
// what reached the native side. Used by test/onboarding-motion-haptics.test.js.
//   node test/support/hapticsScenario.mjs <web|native|native-no-plugin|native-failing>
import { register } from 'node:module';

const scenario = process.argv[2];
const calls = [];
if (scenario !== 'web') {
  // What Capacitor's iOS shell provides: the bridge handler, plus (only when the
  // installed binary includes the plugin) its header.
  globalThis.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  globalThis.Capacitor = {
    PluginHeaders: scenario === 'native-no-plugin' ? [] : [{ name: 'Haptics', methods: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'].map((name) => ({ name, rtype: 'promise' })) }],
    nativePromise: (plugin, method, options) => {
      calls.push({ plugin, method, options });
      return scenario === 'native-failing' ? Promise.reject(new Error('haptic engine unavailable')) : Promise.resolve();
    },
  };
}
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
register('./aliasHooks.mjs', import.meta.url);
const { selectionHaptic, confirmHaptic, successHaptic } = await import('../../src/lib/haptics.js');
let threw = null;
try { selectionHaptic(); confirmHaptic(); successHaptic(); } catch (error) { threw = String(error); }
await new Promise((resolve) => setTimeout(resolve, 20));
console.log(JSON.stringify({ calls, threw, unhandled }));
