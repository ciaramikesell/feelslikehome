const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const live = 'http://localhost:3110';
const baseline = 'http://localhost:3111';
const mail = 'http://127.0.0.1:58025';
assert.equal(process.env.FLH_GUEST_BROWSER_LOCAL, '1', 'Use only the documented disposable local stack');
const shots = process.env.FLH_GUEST_SHOTS || '/tmp/flh-guest-screenshots';
const draftKey = 'flh.guest-onboarding.v1';
const password = 'Local-only-qa-password-62';
const isUI = (page, role, name) => page.getByRole(role, { name, exact: typeof name === 'string' });
const button = (page, name) => isUI(page, 'button', name);
const waitHeading = (page, name) => isUI(page, 'heading', name).first().waitFor();
const draft = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey);
const id = () => randomUUID().replaceAll('-', '');
const db = (sql) => execFileSync('docker',['exec','-i','flh-1b-pg','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','authsmoke'],{input:sql,encoding:'utf8'}).trim();
const mailLink = async (email) => {
 for (let i = 0; i < 20; i++) {
  const { messages } = await (await fetch(mail + '/api/v1/messages')).json();
  const hit = messages?.find(message => message.To.some(recipient => recipient.Address === email));
  if (hit) {
   const content = await (await fetch(mail + '/api/v1/message/' + hit.ID)).json();
   const link = content.Text.match(/http:\/\/localhost:55542\/verify[^\s<>")]+/)?.[0];
   if (link) return link.replace("/verify?", "/auth/v1/verify?");
  }
  await new Promise(resolve => setTimeout(resolve, 300));
 }
 throw Error('No local verification email');
};
const contextOptions = width => ({ viewport: { width, height: width < 500 ? ({320:568,375:667,390:844,430:932}[width]) : 900 },
   isMobile: width < 500, hasTouch: width < 500, reducedMotion: 'reduce' });

async function candidate(browser, width = 390, native = false) {
 const context = await browser.newContext(contextOptions(width));
 if (native) await context.addInitScript(() => {
  window.webkit = {messageHandlers: {bridge: {postMessage() {}}}};
  window.Capacitor = {PluginHeaders: [{name:'App', methods:[{name:'addListener',rtype:'callback'}]}],
    nativeCallback: () => 'qa-listener', nativePromise: async () => ({})};
 });
 await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: fontCss }));
 await context.route(/https:\/\/(?:www\.youtube-nocookie\.com|www\.youtube\.com|www\.google-analytics\.com)\//, route => route.abort());
 const page = await context.newPage();
 page.setDefaultTimeout(15_000);
 return { context, page };
}

let fontCss;
async function loadFonts() {
 const base = process.env.FLH_GUEST_FONT_ROOT;
 if (!base) return '';
 const cfg = [
  ['Fraunces','500 700','@fontsource-variable/fraunces','fraunces-latin-opsz-normal'],
  ['Source Serif 4','500 700','@fontsource-variable/source-serif-4','source-serif-4-latin-opsz-normal'],
  ['DM Sans','400 700','@fontsource-variable/dm-sans','dm-sans-latin-opsz-normal'],
  ...[400,500,600,700].map(w=>['Plus Jakarta Sans',w,'@fontsource/plus-jakarta-sans',`plus-jakarta-sans-latin-${w}-normal`]),
  ...[600,700].map(w=>['Cormorant Garamond',w,'@fontsource/cormorant-garamond',`cormorant-garamond-latin-${w}-normal`]),
 ];
 return (await Promise.all(cfg.map(async ([name, weight, pkg, file]) => {
  const bytes = await readFile(join(base,pkg,'files',file+'.woff2'), 'base64');
  return `@font-face { font-family: '${name}'; font-weight: ${weight}; src:url(data:font/woff2;base64,${bytes}); }`;
 }))).join('\n');
}
async function snap(page, file) {
 await page.evaluate(() => document.fonts.ready);
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page fits viewport');
 await page.screenshot({ path: join(shots, file + '.png'), animations: 'disabled' });
}
async function pickSearch(page, type) {
 await isUI(page, 'radio', new RegExp('^' + type + '$','i')).check();
 await button(page, 'Continue').click();
 await waitHeading(page, /How would you like/);
}
async function quick(page, type = 'Home to buy') {
 await page.goto(live + '/guest');
 await pickSearch(page, type);
 await button(page, /figure it out as I go/).click();
 await waitHeading(page, /the basics of/i);
 await button(page, 'Skip').click();
 await page.waitForURL('**/guest/signup');
 await waitHeading(page, 'Save your personalized search');
}
async function create(page, email) {
 await page.getByLabel('First name').fill('Jamie');
 await page.getByLabel('Last name').fill('Local');
 await page.getByLabel('Email').fill(email);
 await page.getByLabel('Password', {exact:true}).fill(password);
 await page.getByLabel('Confirm password', {exact:true}).fill(password);
 const submit = page.locator('form button[type=submit]');
 await submit.click();
}
async function signIn(page, email) {
 await page.getByLabel('Email').fill(email);
 await page.getByLabel('Password', {exact:true}).fill(password);
 await page.locator('form button[type=submit]').click();
 await page.waitForURL('**/guest/continue');
}
async function checkedTransfer(page, email, lost = false) {
 await page.getByText(email, {exact:true}).waitFor();
 const savedDraft = await draft(page);
 assert.ok(savedDraft && !JSON.stringify(savedDraft).includes(email));
 const tampering = await page.evaluate(async stored => {
  const { schema, step, completed, answers, skipped, startedAt } = stored.progress;
  stored.priorities.features.tiers['Kitchen Island'] = 'forged';
  const malformed = { draftId: stored.id, priorities: stored.priorities,
    progress: { schema, step, completed, answers, skipped, startedAt } };
  const outcomes = [];
  for (const body of [{ draftId: stored.id, userId: stored.id }, malformed]) {
   const response = await fetch('/api/guest-transfer', { method: 'POST',
     headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
   outcomes.push([response.status,(await response.json()).result]);
  }
  return outcomes;
 },savedDraft);
 assert.deepEqual(tampering, [[400,'invalid_draft'], [400,'invalid_draft']]);
 const action = button(page, 'Save your personalized search');
 if (lost) {
  await page.route('**/api/guest-transfer', async route => {
   const response = await route.fetch();
   assert.equal((await response.json()).result,'saved');
   await route.abort();
  }, {times:1});
  await action.click();
  await page.getByRole('alert').getByText(/your draft is still here/i).waitFor();
  assert.equal((await draft(page)).id,savedDraft.id);
 }
 await action.click();
 await waitHeading(page,'Your personalized search is saved');
 assert.equal(await draft(page),null);
 const rows = db(`select count(*) from public.searches s join auth.users u on u.id=s.user_id
 join public.search_member_priorities p on p.search_id=s.id and p.user_id=u.id
 join public.profiles f on f.id=u.id and f.onboarding_complete
 join flh_guest_transfer.attempts a on a.user_id=u.id and a.saved_at is not null
 where u.email='${email}';`);
 assert.equal(rows,'1');
}

(async () => {
 fontCss = await loadFonts();
 await mkdir(shots,{recursive:true});
 const browser = await chromium.launch({ executablePath:process.env.FLH_GUEST_CHROMIUM || '/usr/bin/chromium', args:['--no-sandbox'] });
 try {
  const off = await fetch(baseline+'/guest');
  assert.equal(off.status,404);
  const anonWrite = await fetch(live+'/api/guest-transfer',{method:'POST',headers:{Origin:'http://evil.test','Content-Type':'application/json'},body:'{}'});
  assert.equal(anonWrite.status,403);
  for (const width of [320,375,390,430,1440]) {
   const {context,page} = await candidate(browser,width,width<500);
   await page.goto(baseline);
   if(width<500) await isUI(page,'link','Get Started').click();
   else await button(page,'Create a free account').click();
   await page.getByLabel('First name').waitFor();
   await snap(page,`before-${width}`);
   await page.goto(live);
   if(width<500) await isUI(page,'link','Get Started').click();
   else await page.locator('.pl-hero').getByRole('link',{name:'Get started'}).click();
   await waitHeading(page,/what are you looking for/i);
   assert.equal(await page.getByLabel('First name').count(),0);
   await snap(page,`after-${width}`);
   await context.close();
   console.log('PASS before/after at',width);
  }
  const beforeGuest = db('select count(*) from public.searches;');
  const {context,page} = await candidate(browser,390,true);
  await page.goto(live+'/guest');
  await pickSearch(page,'Home to buy');
  await button(page,/personalize your search/i).click();
  await waitHeading(page,/the basics of/i);
  await page.getByLabel(/maximum budget/i).fill('650000');
  await page.reload();
  assert.match(await page.getByLabel(/maximum budget/i).inputValue(),/650,?000/);
  await button(page,'Continue').click();
  await button(page,'Skip').click();
  await button(page,/Kitchen Island/i).click();
  await button(page,/Must Have/i).click();
  for (let i=0;i<12;i++) {
   if (await button(page,'Save your personalized search').count()) break;
   await button(page,'Skip').click();
  }
  await button(page,'Save your personalized search').waitFor();
  await snap(page,'after-review-390');
  await button(page,'Save your personalized search').click();
  await page.waitForURL('**/guest/signup');
  await snap(page,'after-signup-390');
  const same = 'same-'+id()+'@example.test';
  assert.equal(db('select count(*) from public.searches;'),beforeGuest);
  assert.equal(db(`select count(*) from auth.users where email='${same}';`),'0');
  await create(page,same);
  await waitHeading(page,'Check your email');
  await page.goto(await mailLink(same));
  await page.waitForURL('**/guest/continue');
  await checkedTransfer(page,same,true);
  await snap(page,'after-saved-390');
  assert.equal(db(`select p.priorities #>> '{features,tiers,Kitchen Island}' from public.search_member_priorities p
    join auth.users u on u.id=p.user_id where u.email='${same}';`),'must');
  await isUI(page,'link','Go to My Homes to add a listing').click();
  await page.waitForURL('**/homes');
  await isUI(page,'button',/add (a |your first )?home/i).first().waitFor();
  await context.close();
  console.log('PASS personalized buy, refresh, same-browser verification, strict HTTP validation, lost acknowledgement, PostgreSQL receipt');

  const original = await candidate(browser,375,true);
  await quick(original.page,'Apartment to rent');
  const cross = 'cross-'+id()+'@example.test';
  await create(original.page,cross);
  await waitHeading(original.page,'Check your email');
  const other = await candidate(browser,430,false);
  await other.page.goto(await mailLink(cross));
  await other.page.waitForURL('**/guest/continue?verification=interrupted');
  await other.page.getByText(/same browser or app/i).waitFor();
  assert.equal(await draft(other.page),null);
  await other.context.close();
  await button(original.page,'Back to sign in').click();
  await signIn(original.page,cross);
  await checkedTransfer(original.page,cross);
  await original.context.close();
  console.log('PASS cross-context verification with original draft and proof via password recovery');

  const switched = await candidate(browser,390);
  await quick(switched.page,'Home to rent');
  const otherDraft = await draft(switched.page);
  await switched.page.evaluate(async ({ draftId, email }) => {
    const response = await fetch('/api/guest-transfer', {method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'prepare',draftId,email,replace:false})});
    if ((await response.json()).result !== 'prepared') throw new Error('Could not prepare the second signup');
  }, {draftId:otherDraft.id, email:'future-'+id()+'@example.test'});
  await button(switched.page,'Back to sign in').click();
  await signIn(switched.page,same);
  await button(switched.page,'Save your personalized search').click();
  await switched.page.getByRole('alert').getByText(/could not be applied/i).waitFor();
  assert.equal((await draft(switched.page)).id,otherDraft.id);
  assert.equal(db(`select p.priorities #>> '{features,tiers,Kitchen Island}' from public.search_member_priorities p
    join auth.users u on u.id=p.user_id where u.email='${same}';`),'must');
  await switched.context.close();
  console.log('PASS existing-account sign-in with another signup proof preserves draft and saved preferences');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
