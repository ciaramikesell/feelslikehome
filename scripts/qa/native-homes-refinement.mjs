#!/usr/bin/env node
// Disposable local stand-in only. Exercises native presentation and proves web
// screenshots preserve the main website UI, with genuine FLH fonts loaded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { base, context, info, lit, ready, sql } from './saved-experience-support.mjs';
const out = process.argv[3]; mkdirSync(out,{recursive:true});
const baseline = process.env.FLH_BASELINE_URL || 'http://127.0.0.1:3310';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
const results=[];
const check=async(name,run)=>{await run();results.push({name,ok:true});console.log(`PASS ${name}`);};
const shot=async(p,name)=>{await ready(p);return p.screenshot({path:join(out,`${name}.png`)});};
async function homes(width,{native=true,who='owner',url=base}={}) {
 const c=await context(browser,width,{native,who,url});const p=await c.newPage();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.goto(`${url}/homes`);await p.locator('.hh-homes-toolbar').waitFor({state:'attached'});if(!native||url===baseline)await p.locator('.hh-homes-toolbar-row').first().waitFor({state:'visible'});await ready(p);if(native)await p.locator('.hh-root.hh-native').waitFor();if(native&&url!==baseline)await p.locator('.hh-native-homes-toolbar').waitFor({state:'visible'});return {c,p};
}
try {
 if(!process.env.FLH_QA_SKIP_POPULATED) for(const width of [320,375,390,430]) {
  const {c,p}=await homes(width);const toolbar=p.locator('.hh-native-homes-toolbar');
  await check(`${width}: real native bridge, compact toolbar, no duplicate top navigation, no overflow`,async()=>{
   assert.equal(await p.evaluate(()=>document.documentElement.hasAttribute('data-flh-native')),true);
   assert.equal(await toolbar.isVisible(),true);assert.equal(await p.locator('.hh-tabs').isVisible(),false);
   assert.equal(await p.locator('.hh-homes-toolbar-row').first().isVisible(),false);
   assert.equal(await p.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   assert.deepEqual(p.errors,[]);
   const count=sql(`select count(*) from public.homes h left join public.home_member_state s on s.home_id=h.id and s.user_id=${lit(info.users.owner.id)} where h.search_id=${lit(info.search)} and coalesce(s.status,h.status,'Saved') not in ('Archived','Passed','Not Interested')`);
   assert.match(await toolbar.innerText(),new RegExp(`${count} saved`));
   for(const b of await toolbar.locator('.hh-native-homes-actions button').all()){const r=await b.boundingBox();assert.ok(r.width>=44&&r.height>=44);}
  });
  await shot(p,`after-native-${width}-populated`);
  const first=await p.locator('.hh-home-card-photo').first().boundingBox();
  const before=await homes(width,{url:baseline});await shot(before.p,`before-native-${width}-populated`);
  const old=await before.p.locator('.hh-home-card-photo').first().boundingBox();
  results.push({name:`${width}: first photo position`,before:old.y,after:first.y,ok:first.y<old.y});assert.ok(first.y<old.y);await before.c.close();
  await check(`${width}: search opens, filters results, Escape restores trigger focus`,async()=>{
   await toolbar.getByRole('button',{name:/Search your/}).click();const input=toolbar.locator('input[type=search]');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   await input.fill('zzzz no such home');await p.getByText('Nothing matches that search',{exact:true}).waitFor();await shot(p,`after-native-${width}-search-open`);
   await input.fill('');await input.press('Escape');assert.equal(await input.count(),0);assert.match(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),/Search your/);
  });
  await check(`${width}: sort and independent Filter retain existing behavior and focus trap`,async()=>{
   await toolbar.getByRole('combobox').selectOption('matchDesc');
   await toolbar.getByRole('button',{name:/Filter/}).click();const dialog=p.getByRole('dialog',{name:'Filter my homes'});await dialog.waitFor();await shot(p,`after-native-${width}-filter`);
   for(let i=0;i<12;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')),true);}
   await p.keyboard.press('Escape');assert.equal(await dialog.count(),0);
   await toolbar.getByRole('button',{name:/Filter/}).click();await p.getByRole('dialog').getByLabel('Max price',{exact:true}).fill('1');
   await p.getByRole('dialog').getByRole('button',{name:/^Show /}).click();await p.getByText('No homes meet every filter yet',{exact:true}).waitFor();
   await p.getByRole('button',{name:'Clear filters',exact:true}).last().click();await p.locator('.hh-home-card').first().waitFor();
  });
  await check(`${width}: labeled Add opens existing flow and closes`,async()=>{
   await toolbar.getByRole('button',{name:/Add a Home/}).click();await p.locator('.hh-modal-backdrop').waitFor();await shot(p,`after-native-${width}-add`);await p.getByRole('button',{name:'Close add home',exact:true}).click();await p.locator('.hh-modal-backdrop').waitFor({state:'detached'});
  });
  await check(`${width}: Archive stays reachable`,async()=>{
   await toolbar.locator('a[href="/archive"]').click();await p.waitForURL('**/archive');await p.getByText('Nothing archived.',{exact:true}).waitFor();
  });
  await check(`${width}: card actions remain reachable above the bottom nav`,async()=>{
   await p.goto(`${base}/homes`);await p.locator('.hh-home-card').first().waitFor();const action=p.locator('.hh-card-primary-action').first();await action.evaluate(el=>el.scrollIntoView({block:'center'}));const r=await action.boundingBox(),nav=await p.locator('.hh-mobile-nav').boundingBox();assert.ok(r.y+r.height<=nav.y);
  });
  await c.close();
 }
 {
  const {c,p}=await homes(390);
  await check('native card opens Home Details and Close returns to the same list',async()=>{
   await p.locator('.hh-home-identity-link').first().click();await p.locator('.flh-overlay').waitFor();await p.getByRole('button',{name:'Close',exact:true}).click();await p.waitForURL('**/homes');await p.locator('.flh-overlay').waitFor({state:'detached'});
  });
  await check('native card archives and restores through existing authorized actions',async()=>{
   await p.getByRole('button',{name:'Archive',exact:true}).click();await p.getByRole('button',{name:'Archive home',exact:true}).click();await p.locator('.hh-native-homes-toolbar').getByText('0 saved homes',{exact:true}).waitFor();
   await p.locator('.hh-native-archive').click();await p.waitForURL('**/archive');const restore=p.getByRole('button',{name:/Restore/}).first();await restore.waitFor();await shot(p,'after-native-390-archived');await restore.click();await p.goto(`${base}/homes`);await p.locator('.hh-home-card').first().waitFor();await p.locator('.hh-native-homes-toolbar').getByText('1 saved home',{exact:true}).waitFor();
  });
  await c.close();
 }
 // Browser exclusion: identical rendered pixels before/after, both narrow and wide.
 for(const width of [390,1440]) {
  const pages=[];for(const [version,url]of[['before',baseline],['after',base]]){
   const {c,p}=await homes(width,{native:false,url});assert.equal(await p.locator('.hh-native-homes-toolbar').isVisible(),false);assert.equal(await p.evaluate(()=>document.documentElement.hasAttribute('data-flh-native')),false);
   pages.push({c,p,buffer:await shot(p,`${version}-website-${width}`)});
  }
  await check(`${width}: ordinary website UI pixels unchanged from main`,async()=>{
   const rects=await pages[1].p.locator('[data-home-photo]').evaluateAll(images=>images.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
   const comparison=await pages[1].p.evaluate(async({before,after,rects})=>{
    const pixels=async(data)=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);return{data:c.getImageData(0,0,img.width,img.height).data,width:img.width};};
    const a=await pixels(before),b=await pixels(after);let uiDifferences=0,photoDifferences=0,maxPhotoDelta=0;
    for(let i=0;i<a.data.length;i+=4){const x=(i/4)%a.width,y=Math.floor(i/4/a.width);const delta=Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])));if(!delta)continue;if(rects.some(r=>x>=Math.floor(r.x)-1&&x<=Math.ceil(r.right)+1&&y>=Math.floor(r.y)-1&&y<=Math.ceil(r.bottom)+1)){photoDifferences++;maxPhotoDelta=Math.max(maxPhotoDelta,delta);}else uiDifferences++;}
    return{uiDifferences,photoDifferences,maxPhotoDelta};
   },{before:pages[0].buffer.toString('base64'),after:pages[1].buffer.toString('base64'),rects});
   assert.equal(comparison.uiDifferences,0);assert.ok(comparison.maxPhotoDelta<=12);assert.ok(comparison.photoDifferences<width*844*.001);results.push({name:`${width}: screenshot pixel comparison`,...comparison,ok:true});
  });
  for(const{c}of pages)await c.close();
 }
 // Co-buyer already owns an independent empty search as well as this shared one.
 const own=sql(`select id from public.searches where user_id=${lit(info.users.coBuyer.id)}`);
 sql(`update public.profiles set active_search_id=${lit(own)} where id=${lit(info.users.coBuyer.id)}`);
 for(const width of [320,375,390,430]) {
  const {c,p}=await homes(width,{who:'coBuyer'});
  await check(`${width}: empty search has approved message, one Add, no meaningless filters/sort`,async()=>{
   await p.getByText("You found the homes. We'll help you choose.",{exact:true}).waitFor();
   assert.equal(await p.getByRole('button',{name:/Add a Home/}).count(),1);
   assert.equal(await p.getByRole('button',{name:/Add a Home/}).filter({visible:true}).count(),1);
   assert.equal(await p.locator('.hh-native-homes-toolbar select').count(),0);
   await shot(p,`after-native-${width}-empty`);
  });
  await c.close();
 }
 const {c,p}=await homes(390,{who:'coBuyer'});
 await check('co-buyer switches from own empty search to shared homes without permission changes',async()=>{
  await p.getByRole('button',{name:/Current search:.*Switch search/}).click();await shot(p,'after-native-390-switch-search');
  await p.locator('.hh-search-options button').filter({hasText:"Ciara"}).click();await p.locator('.hh-home-card').first().waitFor();
  assert.match(await p.locator('.hh-native-homes-toolbar').innerText(),/1 saved home/);
  assert.match(await p.locator('.hh-collaboration-pill').innerText(),/Searching together/);
 });
 for(const [label,path]of[['Homes','/homes'],['Tour','/tour'],['Compare','/compare'],['Map','/map'],['Search','/search']])await check(`bottom ${label}: existing destination preserved`,async()=>{
  await p.locator(`.hh-mobile-nav a[href="${path}"]`).click();await p.waitForURL(url=>url.pathname===path);await p.locator('.hh-mobile-nav').waitFor();
 });
 await c.close();
} finally {sql(`update public.profiles set active_search_id=${lit(info.search)} where id=${lit(info.users.coBuyer.id)}`);await browser.close();writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));}
