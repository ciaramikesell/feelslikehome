import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parsePhotoUrl, serializePhotoFrame } from '../../src/lib/photoFraming.js';
// Development-only. Both phases use the same throwaway Supabase stand-in.
// Run before against base main, then after against the Part C build.
const [phase, infoPath, outputRoot, base] = process.argv.slice(2);
if (!['before','after'].includes(phase) || !infoPath || !outputRoot || !base) throw Error('Usage: photo-experience-part-c.mjs <before|after> <standin.json> <outputRoot> <baseUrl>');
const root=resolve(outputRoot);mkdirSync(root,{recursive:true});
const fixturePath=join(root,'fixture.json');
const uploadFile=fileURLToPath(new URL('../../public/images/Warm Cottage.png',import.meta.url));
const info=JSON.parse(readFileSync(infoPath,'utf8').split('\n')[0]);
const backend=info.url;
if (!info.database.startsWith('flh_test_')) throw Error('Use a throwaway QA database.');
const pg='psql';
const lit=v=>`'${String(v).replaceAll("'","''")}'`;
function sql(s){const r=spawnSync(pg,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',process.env.FLH_TEST_PGHOST,'-p',process.env.FLH_TEST_PGPORT||'5432','-U','postgres','-d',info.database,'-c',s],{encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
let fixture=phase==='before'?{id:randomUUID()}:JSON.parse(readFileSync(fixturePath));
if(phase==='before')sql(`insert into public.homes(id,user_id,search_id,address,price,beds,baths,sqft,photo_url) values (${lit(fixture.id)},${lit(info.users.owner.id)},${lit(info.search)},'14 Linden Lane, Maple Hollow, MI 48001','485000','3','2','1840','')`);
const row=()=>JSON.parse(sql(`select row_to_json(h) from public.homes h where id=${lit(fixture.id)}`));
const results=[];const check=(name,ok)=>{results.push({name,ok:!!ok});console.log(ok?'PASS':'FAIL',name);if(!ok)throw Error(name)};
async function until(fn,label='saved database value'){const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,120))}}
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{});
async function pageFor(who='owner',width=390){const c=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700});await c.addCookies([{name:'sb-localhost-auth-token',value:`base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`,domain:'localhost',path:'/'}]);await c.addInitScript(()=>{for(const k of ['flh-mobile-tour-dismissed','flh-name-prompt-dismissed','flh-install-dismissed'])localStorage.setItem(k,'1')});await c.route('https://fonts.googleapis.com/**',r=>r.abort());await c.route('https://fonts.gstatic.com/**',r=>r.abort());const p=await c.newPage();return p;}
const go=async(p,path)=>{await p.goto(base+path,{waitUntil:'networkidle'});await p.addStyleTag({content:'nextjs-portal,.beta-feedback-tab{display:none!important}'});};
const home=async p=>{await go(p,`/homes/${fixture.id}`);await p.locator('.flh-hf2-photo').waitFor()};
const out=join(root,'screenshots',phase);mkdirSync(out,{recursive:true});
try{
if(phase==='before'){
 const p=await pageFor();await home(p);await p.locator('input[type=file]').setInputFiles(uploadFile);await until(()=>row().photo_url.includes('/storage/'));
 fixture.source=row().photo_url+'#keep%23original';sql(`update public.homes set photo_url=${lit(fixture.source)} where id=${lit(fixture.id)}`);writeFileSync(fixturePath,JSON.stringify(fixture));await p.context().close();
}else{
 sql(`update public.homes set photo_url=${lit(fixture.source)} where id=${lit(fixture.id)}`);
 const p=await pageFor();await home(p);
 const network=[];p.on('request',r=>network.push({url:r.url(),method:r.method(),body:r.method()==='DELETE'?r.postData():null}));
 const original=JSON.stringify(row());
 const originalBytes=createHash('sha256').update(await (await p.request.get(fixture.source)).body()).digest('hex');
 await p.getByRole('button',{name:'Position photo',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'Position photo',exact:true});await dialog.getByRole('button',{name:'Save position',exact:true}).waitFor();
 await dialog.getByRole('slider',{name:/Horizontal/}).fill('20');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 check('Cancel changes no database field',JSON.stringify(row())===original);
 check('Cancel restores opener focus',await p.getByRole('button',{name:'Position photo',exact:true}).evaluate(n=>n===document.activeElement));
 await p.getByRole('button',{name:'Position photo',exact:true}).click();
 const preview=dialog.locator('.flh-position-preview');await dialog.getByRole('button',{name:'Save position',exact:true}).isEnabled();await p.waitForTimeout(300);
 const box=await preview.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2-20,box.y+box.height/2, {steps:5});await p.mouse.up();
 check('pointer drag changes framing preview',await dialog.getByRole('slider',{name:/Horizontal/}).inputValue()!=='50');
 await dialog.getByRole('slider',{name:/Horizontal/}).fill('50');
 const cdp=await p.context().newCDPSession(p);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2+20,y:box.y+box.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 check('touch drag changes framing preview',await dialog.getByRole('slider',{name:/Horizontal/}).inputValue()!=='50');
 await cdp.detach();
 await dialog.getByRole('slider',{name:/Horizontal/}).fill('15');await dialog.getByRole('slider',{name:/Vertical/}).fill('75');
 network.length=0;await dialog.getByRole('button',{name:'Save position',exact:true}).click();await until(()=>parsePhotoUrl(row().photo_url,backend).position.x===15);
 await dialog.waitFor({state:'hidden'});
 check('framing save creates no storage upload/delete or listing import request',network.every(r=>!r.url.includes('/api/import-listing')&&!(r.url.includes('/storage/v1/object')&&r.method!=='GET')));
 check('no image request exposes FLH metadata',network.filter(r=>r.url.includes('/storage/')).every(r=>!r.url.includes('flh-photo-frame')));
 check('framing retains original URL/fragment and all other home fields',parsePhotoUrl(row().photo_url,backend).source===fixture.source && row().address==='14 Linden Lane, Maple Hollow, MI 48001' && row().listing_import===null);
 check('original image bytes are unchanged',createHash('sha256').update(await (await p.request.get(fixture.source)).body()).digest('hex')===originalBytes);
 await home(p);check('position survives refresh',await p.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='15% 75%');
 check('image element source contains no FLH metadata',!(await p.locator('.flh-hf2-photo img').getAttribute('src')).includes('flh-photo-frame='));
 const co=await pageFor('coBuyer',375);await home(co);check('another shared-search user/device reads the same framing',await co.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='15% 75%');
 const realtor=await pageFor('realtor',430);await go(realtor,`/people/${info.search}/homes/${fixture.id}`);check('Realtor view shows framing without positioning controls',await realtor.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='15% 75%' && await realtor.getByRole('button',{name:'Position photo',exact:true}).count()===0);
 await p.getByRole('button',{name:'Position photo',exact:true}).click();await dialog.getByRole('slider',{name:/Horizontal/}).fill('90');
 const replaced=fixture.source.replace('#keep%23original','#replacement');sql(`update public.homes set photo_url=${lit(replaced)} where id=${lit(fixture.id)}`);
 await dialog.getByRole('button',{name:'Save position',exact:true}).click();await dialog.getByRole('alert').waitFor();check('stale framing save cannot overwrite a concurrent photo change',row().photo_url===replaced);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 sql(`update public.homes set photo_url=${lit(serializePhotoFrame(fixture.source,{x:15,y:75},backend))} where id=${lit(fixture.id)}`);
 await home(p);await p.getByRole('button',{name:'Position photo',exact:true}).click();await dialog.getByRole('slider',{name:/Horizontal/}).fill('30');
 let block=true;await p.route('**/rest/v1/homes*',r=>block&&r.request().method()==='PATCH'?r.fulfill({status:503,json:{message:'QA failure'}}):r.continue());
 await dialog.getByRole('button',{name:'Save position',exact:true}).click();await dialog.getByRole('alert').waitFor();check('failed position save keeps original and preview',parsePhotoUrl(row().photo_url,backend).position.x===15 && await dialog.getByRole('slider',{name:/Horizontal/}).inputValue()==='30');
 block=false;await dialog.getByRole('button',{name:'Save position',exact:true}).click();await until(()=>parsePhotoUrl(row().photo_url,backend).position.x===30);await dialog.waitFor({state:'hidden'});await p.unroute('**/rest/v1/homes*');
 check('retry saves the same original object',parsePhotoUrl(row().photo_url,backend).source===fixture.source);
 // Broken URLs are validated/display-only, never positionable, and have a fallback.
 const framed=row().photo_url;sql(`update public.homes set photo_url='https://example.invalid/no-photo.jpg' where id=${lit(fixture.id)}`);await home(p);await p.locator('.flh-hf2-photo-empty,.flh-hf2-photo .flh-home-photo-fallback').waitFor();check('failed external image has stable fallback and no framing control',await p.getByRole('button',{name:'Position photo',exact:true}).count()===0);
 sql(`update public.homes set photo_url=${lit(framed)} where id=${lit(fixture.id)}`);

 // Unknown metadata is centered and retained; source fragments are not repaired away.
 const unsupported=fixture.source.split('#')[0]+'#flh-photo-frame='+encodeURIComponent(JSON.stringify({version:9,fragment:'keep%23original',position:{x:1,y:2}}));
 sql(`update public.homes set photo_url=${lit(unsupported)} where id=${lit(fixture.id)}`);await home(p);
 check('future metadata centers without mutation or editing',await p.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='50% 50%' && row().photo_url===unsupported && await p.getByRole('button',{name:'Position photo',exact:true}).count()===0);
 sql(`update public.homes set photo_url=${lit(framed)} where id=${lit(fixture.id)}`);await home(p);
 const beforeUpload=row().photo_url;
 await p.locator('input[type=file]').setInputFiles({name:'bad.gif',mimeType:'image/gif',buffer:Buffer.from('GIF')});
 await p.getByRole('alert').filter({hasText:/JPEG, PNG, or WebP/}).waitFor();check('unsupported upload type is rejected without changing URL',row().photo_url===beforeUpload);
 await p.locator('input[type=file]').setInputFiles({name:'too-big.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)});
 await p.getByRole('alert').filter({hasText:/larger than 5MB/}).waitFor();check('5MB validation remains unchanged',row().photo_url===beforeUpload);
 await p.route('**/storage/v1/object/home-photos/**',r=>r.fulfill({status:503,json:{message:'QA upload failed'}}));
 await p.locator('input[type=file]').setInputFiles(uploadFile);
 await p.getByRole('alert').filter({hasText:/couldn.t upload/}).waitFor();check('failed upload retains the old framed photo',row().photo_url===beforeUpload);
 await p.unroute('**/storage/v1/object/home-photos/**');
 await p.locator('input[type=file]').setInputFiles(uploadFile);
 await until(()=>row().photo_url!==beforeUpload && row().photo_url.includes('/storage/'));
 fixture.source=row().photo_url+'#keep%23original';writeFileSync(fixturePath,JSON.stringify(fixture));
 check('replacement receives a new object and resets framing',parsePhotoUrl(row().photo_url,backend).position.x===50 && !row().photo_url.includes('flh-photo-frame'));
 check('replacement cleanup contains no framing metadata',network.filter(r=>r.method==='DELETE').every(r=>!r.url.includes('flh-photo-frame')&&!r.body?.includes('flh-photo-frame')));
 await p.getByRole('button',{name:'Remove photo',exact:true}).click();await until(()=>row().photo_url==='');check('remove clears the saved photo URL',true);
 await p.getByRole('button',{name:'Photo URL',exact:true}).click();
 await p.getByLabel('Photo URL',{exact:true}).fill('javascript:alert(1)');await p.getByLabel('Photo URL',{exact:true}).press('Tab');
 check('unsafe Photo URL cannot be saved',row().photo_url==='');
 await p.getByLabel('Photo URL',{exact:true}).fill(fixture.source);await p.getByLabel('Photo URL',{exact:true}).press('Tab');await until(()=>row().photo_url===fixture.source);
 check('valid Photo URL preserves original fragment',true);
 await home(p);await p.getByRole('button',{name:'Position photo',exact:true}).click();
 await dialog.getByRole('slider',{name:/Horizontal/}).fill('30');await dialog.getByRole('slider',{name:/Vertical/}).fill('75');await dialog.getByRole('button',{name:'Save position',exact:true}).click();await until(()=>parsePhotoUrl(row().photo_url,backend).position.x===30);await dialog.waitFor({state:'hidden'});

 // Full-row editor saves must not delete an object when only its framing changed.
 const priorities=sql(`select priorities from public.search_member_priorities where search_id=${lit(info.search)} and user_id=${lit(info.users.owner.id)}`);
 const rental={...JSON.parse(priorities),searchType:'rental',onboardingSearchType:'home_rent'};
 sql(`update public.search_member_priorities set priorities=${lit(JSON.stringify(rental))}::jsonb where search_id=${lit(info.search)} and user_id=${lit(info.users.owner.id)}`);
 await home(p);await p.getByRole('button',{name:'More home details',exact:true}).click();
 const fullEditor=p.locator('.hh-edit-home-modal');await fullEditor.getByRole('button',{name:'Paste by URL',exact:true}).click();
 await fullEditor.getByLabel('Photo URL',{exact:true}).fill(serializePhotoFrame(row().photo_url,{x:55,y:75},backend));
 network.length=0;await fullEditor.getByRole('button',{name:'Save changes',exact:true}).click();await until(()=>parsePhotoUrl(row().photo_url,backend).position.x===55);await fullEditor.waitFor({state:'hidden'});
 check('full editor skips cleanup for a framing-only URL change',network.every(r=>!(r.method==='DELETE'&&r.url.includes('/storage/'))));
 check('full editor preserves original image bytes',createHash('sha256').update(await (await p.request.get(fixture.source)).body()).digest('hex')===originalBytes);
 sql(`update public.search_member_priorities set priorities=${lit(priorities)}::jsonb where search_id=${lit(info.search)} and user_id=${lit(info.users.owner.id)}`);
 sql(`update public.homes set photo_url=${lit(serializePhotoFrame(fixture.source,{x:30,y:75},backend))} where id=${lit(fixture.id)}`);
 // The Realtor can still submit an existing Photo URL through its existing RPC.
 const suggested=await realtor.request.post(backend+'/rest/v1/rpc/create_realtor_suggestion',{headers:{authorization:`Bearer ${info.users.realtor.session.access_token}`},data:{p_search_id:info.search,p_home:{address:'29 Birch Lane, Maple Hollow, MI 48001',photoUrl:row().photo_url,price:'495000',beds:'3',baths:'2'}}});
 check('existing Realtor suggestion creation remains authorized',suggested.ok());
 await go(co,'/homes/suggestions');
 check('suggestion photos use the same framing utility',await co.locator('.hh-suggestion-photo img[data-home-photo]').evaluateAll(nodes=>nodes.some(n=>n.style.objectPosition==='30% 75%')));
 await Promise.all([p.context().close(),co.context().close(),realtor.context().close()]);
}
for(const width of [320,375,390,430,1280]){
 const p=await pageFor('owner',width);await home(p);
 const shot=async name=>p.screenshot({path:`${out}/${name}-${width}.png`,animations:'disabled'});
 await shot('detail');
 if(phase==='after'){
  check(`${width}: detail uses shared framing`,await p.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='30% 75%');
  await p.getByRole('button',{name:'Position photo',exact:true}).click();await p.waitForTimeout(200);await shot('position-editor');
  const editorDialog=p.getByRole('dialog',{name:'Position photo',exact:true});
  for(const size of [24,32]){await p.evaluate(size=>document.documentElement.style.fontSize=`${size}px`,size);check(`${width}: editor fits at ${size/16*100}% text`,await editorDialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
  await p.evaluate(()=>document.documentElement.style.fontSize='16px');
  check(`${width}: editor has no horizontal overflow`,await p.getByRole('dialog',{name:'Position photo',exact:true}).evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  await p.getByRole('dialog',{name:'Position photo',exact:true}).getByRole('slider',{name:/Horizontal/}).focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('Escape');
  check(`${width}: keyboard/Escape cancel keeps saved frame`,parsePhotoUrl(row().photo_url,backend).position.x===30);
 }
 await go(p,'/homes');await shot('my-homes');
 if(phase==='after')check(`${width}: cards use same frame`,await p.locator(`a[href*="${fixture.id}"] img[data-home-photo]`).first().evaluate(n=>n.style.objectPosition)==='30% 75%');
 await go(p,'/compare');await shot('compare');
 if(phase==='after')check(`${width}: comparison uses same frame`,await p.locator('img[data-home-photo]').evaluateAll(nodes=>nodes.some(n=>n.style.objectPosition==='30% 75%')));
 const r=await pageFor('realtor',width);await go(r,`/people/${info.search}/homes/${fixture.id}`);await r.screenshot({path:`${out}/realtor-${width}.png`,animations:'disabled'});
 if(phase==='after')check(`${width}: read-only Realtor framing matches`,await r.locator('.flh-hf2-photo img').evaluate(n=>n.style.objectPosition)==='30% 75%');
 await Promise.all([p.context().close(),r.context().close()]);
}
}finally{writeFileSync(join(root,`${phase}-results.json`),JSON.stringify(results,null,2));await browser.close()}
console.log(`${results.length} checks passed (${phase})`);
