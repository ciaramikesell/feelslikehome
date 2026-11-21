// Local-only browser QA helpers. No production credentials or services.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
export const info = JSON.parse(readFileSync(process.argv[2], 'utf8').split('\n')[0]);
export const base = process.argv[4] || 'http://127.0.0.1:3311';
export function sql(query) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT, '-U', 'postgres', '-d', info.database, '-c', query], { encoding: 'utf8' });
  if (r.status) throw Error(r.stderr);
  return r.stdout.trim();
}
export const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const row = (id) => JSON.parse(sql(`select row_to_json(h) from public.homes h where id=${lit(id)}`));
export async function context(browser, width, { native = false, who = 'owner', url = base } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 701 ? 844 : 1000 }, reducedMotion: 'reduce', deviceScaleFactor: 1, hasTouch: width < 701 });
  await ctx.addCookies([{ name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: new URL(url).hostname, path: '/' }]);
  await ctx.addInitScript(() => { for (const key of ['flh-mobile-tour-dismissed', 'flh-what-flh-found-dismissed', 'flh-install-dismissed']) localStorage.setItem(key, '1'); });
  if (native) {
    const bridge = readFileSync('node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js', 'utf8');
    await ctx.addInitScript(`window.webkit={messageHandlers:{bridge:{postMessage(d){if(d.methodName!=='addListener')setTimeout(()=>window.Capacitor.fromNative({callbackId:d.callbackId,pluginId:d.pluginId,methodName:d.methodName,success:true,data:{}}),0)}}}};window.Capacitor={DEBUG:false,isLoggingEnabled:false,Plugins:{}};window.WEBVIEW_SERVER_URL='';${bridge};window.Capacitor.PluginHeaders=[{name:'App',methods:[{name:'addListener'},{name:'removeListener'},{name:'getLaunchUrl',rtype:'promise'}]}];`);
  }
  // Google Fonts is blocked here. Serve genuine font files locally for captures.
  const fonts = { 'Fraunces': '/workspace/scratch/saved-qa-fonts/fraunces.ttf', 'DM Sans': '/workspace/scratch/saved-qa-fonts/dm-sans.ttf', 'Cormorant Garamond': '/workspace/scratch/saved-qa-fonts/cormorant.ttf', 'Source Serif 4': '/workspace/prototypes/flh-homepage-layout/assets/fonts/source-serif-4.ttf', 'Plus Jakarta Sans': '/workspace/prototypes/flh-homepage-layout/assets/fonts/plus-jakarta-sans.ttf' };
  await ctx.route(/fonts\.googleapis\.com/, (route) => route.fulfill({ contentType: 'text/css', body: Object.keys(fonts).map((name, i) => `@font-face{font-family:'${name}';src:url('${url}/__qa_font/${i}');font-weight:100 900;font-style:normal;font-display:swap}`).join('\n') }));
  await ctx.route('**/__qa_font/*', (route) => route.fulfill({ contentType: 'font/ttf', path: Object.values(fonts)[Number(route.request().url().split('/').at(-1))] }));
  return ctx;
}
export async function ready(page) {
  await page.evaluate(async () => { await Promise.all(['600 32px Fraunces', '400 16px "DM Sans"', '600 32px "Cormorant Garamond"'].map((font) => document.fonts.load(font))); await document.fonts.ready; });
}
