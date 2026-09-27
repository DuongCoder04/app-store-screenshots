// Run against a disposable copy: this exercises uploads and /api/project.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/bug-bash.cjs http://localhost:3098
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.argv[2] || 'http://localhost:3098';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const slide = (id, extra = {}) => ({ id, layout: 'no-device', label: {en: 'LABEL'}, headline: {en: id}, screenshot: '', ...extra });
const fixture = (extra = {}) => ({schemaVersion:2,appName:'Bug bash',themeId:'clean-light',connectedCanvas:true,locales:['en'],locale:'en',device:'watchos',orientation:'portrait',slidesByDevice:{watchos:[slide('first'),slide('second')],android:[slide('android')],iphone:[slide('iphone')]},...extra});
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 const errors = [];
 async function open(state=fixture(), save) {
   const page = await browser.newPage({viewport:{width:1600,height:1000}});
   let latest=structuredClone(state);
   page.on('pageerror', error=>errors.push(error.message));
   await page.route('**/api/project',async route=>{
     if(route.request().method()==='POST') {
       const data=route.request().postDataJSON();
       if(save) await save(data);
       latest=data;
     }
     await route.fulfill({json:{ok:true,state:latest}});
   });
   await page.goto(baseURL);
   await page.getByRole('button',{name:'Export bundle',exact:true}).waitFor();
   return {page, latest:()=>latest};
 }
 let passed=0;
 async function check(name, run) {
   if(process.env.BUG_BASH_FILTER && !name.includes(process.env.BUG_BASH_FILTER)) return;
   await run(); passed++; console.log('PASS',name);
 }
 try {
 await check('menu arrows do not navigate slides',async()=>{
   const {page}=await open();
   await page.getByRole('combobox',{name:'Theme',exact:true}).click();
   await page.keyboard.press('ArrowDown');
   assert.match(await page.locator('main').innerText(),/Screen 1/);
   await page.keyboard.press('Escape'); await page.close();
 });
 await check('duplicate selects copy; undo and redo preserve edits',async()=>{
   const {page}=await open();
   await page.getByRole('button',{name:'Duplicate screen 1',exact:true}).click();
   assert.match(await page.locator('main').innerText(),/Screen 2/);
   await page.getByRole('button',{name:'Undo',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:/^Delete screen/}).count(),2);
   await page.getByRole('button',{name:'Redo',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:/^Delete screen/}).count(),3);
   await page.close();
 });
 await check('rapid edits on different decks have separate undo steps',async()=>{
   const {page}=await open();
   await page.locator('textarea').first().fill('watch changed');
   await page.getByRole('tab',{name:'Android',exact:true}).click();
   await page.locator('textarea').first().fill('android changed');
   await page.getByRole('button',{name:'Undo',exact:true}).click();
   assert.equal(await page.locator('textarea').first().inputValue(),'android');
   await page.getByRole('button',{name:'Undo',exact:true}).click();
   assert.equal(await page.locator('textarea').first().inputValue(),'first');
   await page.close();
 });
 await check('editing does not reset a manually panned canvas',async()=>{
   const {page}=await open();
   const scroller=page.locator('main .overflow-auto');
   await scroller.evaluate(el=>el.scrollTo({left:300,behavior:'instant'}));
   const before=await scroller.evaluate(el=>el.scrollLeft);
   assert.ok(before>0);
   await page.locator('textarea').first().fill('edited while panned');
   await pause(400);
   assert.equal(await scroller.evaluate(el=>el.scrollLeft),before);
   await page.close();
 });
 await check('slow autosaves never overlap or overwrite newer state',async()=>{
   let active=0,maxActive=0; const completed=[];
   const {page,latest}=await open(fixture(),async data=>{
     maxActive=Math.max(maxActive,++active);
     await pause(data.appName==='older'?1800:50);
     completed.push(data.appName); active--;
   });
   await pause(800);
   await page.getByRole('textbox',{name:'App name',exact:true}).fill('older');
   await pause(800);
   await page.getByRole('textbox',{name:'App name',exact:true}).fill('newer');
   await pause(2600);
   assert.equal(maxActive,1); assert.equal(latest().appName,'newer');
   assert.equal(completed.at(-1),'newer'); await page.close();
 });
 await check('export locks immediately and through completion, PNG dimensions/locales are correct',async()=>{
   const {page}=await open(fixture({locales:['en','de']}));
   let downloadCount=0; page.on('download',()=>downloadCount++);
   const downloaded=page.waitForEvent('download');
   await page.getByRole('button',{name:'Export bundle',exact:true}).click();
   assert.equal(await page.locator('main').evaluate(el=>!!el.closest('[inert]')),true);
   assert.equal(await page.getByRole('textbox',{name:'App name',exact:true}).isDisabled(),true);
   const download=await downloaded; const file=await download.path();
   const JSZip=require('../skills/app-store-screenshots/template/node_modules/jszip');
   const zip=await JSZip.loadAsync(await fs.readFile(file));
   const pngs=Object.values(zip.files).filter(f=>f.name.endsWith('.png'));
   assert.equal(pngs.length,24);
   for(const png of pngs) {
     const bytes=await png.async('nodebuffer'); const [,w,h]=png.name.match(/\/(\d+)x(\d+)\//);
     assert.equal(bytes.readUInt32BE(16),Number(w)); assert.equal(bytes.readUInt32BE(20),Number(h));
     assert.equal(bytes[25],2,'stores need opaque 24-bit RGB PNGs, not RGBA');
   }
   await page.getByRole('button',{name:'Export bundle',exact:true}).waitFor();
   assert.equal(await page.locator('[inert]').count(),0); assert.equal(downloadCount,1); await page.close();
 });
 await check('missing referenced image blocks export and recovers controls',async()=>{
   const {page}=await open(fixture({slidesByDevice:{watchos:[slide('broken',{layout:'hero',screenshot:'/missing-bugbash.png'})]}}));
   let downloads=0;page.on('download',()=>downloads++);
   await page.getByRole('button',{name:'Export bundle',exact:true}).click();
   await page.getByText('Export failed',{exact:true}).waitFor();
   assert.match(await page.locator('body').innerText(),/Images could not be loaded/);
   assert.equal(downloads,0); assert.equal(await page.locator('[inert]').count(),0); await page.close();
 });
 await check('latest upload wins; clear cancels pending replacement',async()=>{
   const {page,latest}=await open(fixture({slidesByDevice:{watchos:[slide('upload',{layout:'hero'})]}}));
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,10,10);return c.toDataURL().split(',')[1]});
   let count=0;
   await page.route('**/api/upload',async route=>{const n=++count;await pause(n===1?1200:100);await route.fulfill({json:{ok:true,path:`/upload-${n}.png`}})});
   const input=page.locator('input[type=file]').last();
   await input.setInputFiles({name:'first.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await pause(150);
   await input.setInputFiles({name:'second.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await pause(1800);assert.equal(latest().slidesByDevice.watchos[0].screenshot,'/upload-2.png');
   await input.setInputFiles({name:'third.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await page.getByRole('button',{name:'Clear screenshot',exact:true}).click();
   await pause(850);assert.equal(latest().slidesByDevice.watchos[0].screenshot,'');await page.close();
 });
 await check('feature graphic background, contrast, and selection match inspector',async()=>{
   const {page}=await open(fixture({device:'feature-graphic',slidesByDevice:{'feature-graphic':[slide('banner one',{layout:'feature-graphic'}),slide('banner two',{layout:'feature-graphic'})]}}));
   const inspector=page.locator('aside').last();
   await inspector.getByRole('combobox').nth(1).click();
   await page.getByRole('option',{name:'Custom color',exact:true}).click();
   await page.getByRole('textbox',{name:'Custom background hex color',exact:true}).fill('#FFFFFF');
   const caption=page.locator('main [contenteditable=plaintext-only]').first();
   assert.equal(await caption.evaluate(el=>getComputedStyle(el).color),'rgb(23, 23, 23)');
   assert.equal(await caption.evaluate(el=>getComputedStyle(el.parentElement.parentElement.parentElement).backgroundColor),'rgb(255, 255, 255)');
   await page.locator('main [contenteditable=plaintext-only]').nth(1).focus();
   assert.match(await page.locator('main').innerText(),/Screen 2/);
   assert.equal(await page.locator('textarea').first().inputValue(),'banner two');
   await page.close();
 });
 await check('connected overlays split across PNG crops; isolated mode clips them',async()=>{
   const JSZip=require('../skills/app-store-screenshots/template/node_modules/jszip');
   for(const connectedCanvas of [true,false]) {
     const {page}=await open(fixture({connectedCanvas}));
     const src=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;const ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,10,10);return c.toDataURL()});
     await page.close();
     const probe=await open(fixture({connectedCanvas,slidesByDevice:{watchos:[slide('left',{label:{},headline:{},imageElements:[{id:'cross',src,transform:{x:350,y:220,width:144,height:80,zIndex:10}}]}),slide('right',{label:{},headline:{}})]}}));
     const download=probe.page.waitForEvent('download');
     await probe.page.getByRole('button',{name:'Export bundle',exact:true}).click();
     const file=await (await download).path();const zip=await JSZip.loadAsync(await fs.readFile(file));
     const image=await zip.file('ios/watchos/422x514/en/02-no-device.png').async('base64');
     const pixel=await probe.page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=422;c.height=514;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(25,250,1,1).data)},image);
     assert.equal(pixel[0]===255&&pixel[1]===0&&pixel[2]===0,connectedCanvas);
     await probe.page.close();
   }
 });
 await check('every device exports real images at its advertised sizes',async()=>{
   const JSZip=require('../skills/app-store-screenshots/template/node_modules/jszip');
   const devices=['iphone','ipad','tvos','watchos','carplay','mac','android','android-7','android-10','feature-graphic'];
   for(const device of devices) {
     const bootstrap=await open();
     const src=await bootstrap.page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=400;const x=c.getContext('2d');x.fillStyle='#ff00ff';x.fillRect(0,0,200,400);return c.toDataURL()});
     await bootstrap.page.close();
     const {page}=await open(fixture({device,appIcon:src,slidesByDevice:{[device]:[slide('device',{layout:device==='feature-graphic'?'feature-graphic':'hero',screenshot:src})]}}));
     const downloaded=page.waitForEvent('download');
     await page.getByRole('button',{name:'Export bundle',exact:true}).click();
     const file=await (await downloaded).path();const zip=await JSZip.loadAsync(await fs.readFile(file));
     const pngs=Object.values(zip.files).filter(f=>f.name.endsWith('.png'));
     const expected={iphone:4,ipad:2,tvos:2,watchos:6,carplay:4,mac:4,android:1,'android-7':1,'android-10':1,'feature-graphic':1};
     assert.equal(pngs.length,expected[device],device);
     for(const png of pngs) {
       const bytes=await png.async('nodebuffer');const [,w,h]=png.name.match(/\/(\d+)x(\d+)\//);
       assert.equal(bytes.readUInt32BE(16),Number(w));assert.equal(bytes.readUInt32BE(20),Number(h));
     }
     const pixels=await page.evaluate(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=50;c.height=50;const x=c.getContext('2d');x.drawImage(image,0,0,50,50);const p=x.getImageData(0,0,50,50).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]>230&&p[i+1]<30&&p[i+2]>230)n++;return n},await pngs[0].async('base64'));
     assert.ok(pixels>5,`${device}: screenshot missing from rendered PNG`);
     await page.close();
   }
 });
 await check('malformed generated project does not crash or autosave over disk',async()=>{
   let writes=0;
   const {page}=await open(fixture({locales:'en'}),async()=>{writes++});
   await page.getByText('save failed',{exact:false}).waitFor();
   await pause(800); assert.equal(writes,0); await page.close();
 });
 await check('project API rejects invalid data without overwriting valid state',async()=>{
   const context=await browser.newContext();const request=context.request;
   const original=await request.get(baseURL+'/api/project'); const payload=await original.json();
   assert.equal(original.status(),200);
   for(const body of [null,[],{},fixture({device:'bad'}),fixture({slidesByDevice:{watchos:[null]}})]) {
     const response=await request.post(baseURL+'/api/project',{data:JSON.stringify(body),headers:{'content-type':'application/json'}});
     assert.equal(response.status(),400);
   }
   const after=await request.get(baseURL+'/api/project');assert.deepEqual((await after.json()).state,payload.state);
   const saved=await request.post(baseURL+'/api/project',{data:payload.state});assert.equal(saved.status(),200);
   const roundTrip=await request.get(baseURL+'/api/project');assert.deepEqual((await roundTrip.json()).state,payload.state);
   await context.close();
 });
 await check('out-of-bounds elements export where the editor shows them',async()=>{
   const {page}=await open(fixture({connectedCanvas:false,slidesByDevice:{watchos:[slide('a',{textElements:[{id:'t1',text:{en:'WIDE'},transform:{x:300,y:10,width:300,height:80,zIndex:6}}]})]}}));
   const editorX=await page.locator('main .rnd-editable').last().evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);
   const exportX=await page.locator('[aria-hidden] [contenteditable=false]').filter({hasText:'WIDE'}).last().evaluate(el=>parseFloat(el.closest('div[style*="z-index"]').style.left));
   assert.equal(exportX,editorX); await page.close();
 });
 await check('clearing inline copy saves nothing and shows the fallback after blur',async()=>{
   const {page,latest}=await open(fixture({locales:['en','de'],locale:'de',slidesByDevice:{watchos:[slide('a',{headline:{en:'English',de:'Deutsch'}})]}}));
   const headline=page.locator('main [contenteditable=plaintext-only]').nth(1);
   await headline.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
   await page.locator('textarea').first().click(); await pause(900);
   assert.equal(latest().slidesByDevice.watchos[0].headline.de,undefined);
   assert.equal(await headline.textContent(),'English'); await page.close();
 });
 await check('overlay text can be cleared and retyped in a non-default locale',async()=>{
   const {page,latest}=await open(fixture({locales:['en','de'],locale:'de',slidesByDevice:{watchos:[slide('a',{textElements:[{id:'t1',text:{en:'Hello'},transform:{x:10,y:10,width:300,height:80,zIndex:6}}]})]}}));
   await page.locator('main [contenteditable=plaintext-only]').nth(2).focus();
   const text=page.getByRole('textbox',{name:'Overlay text',exact:true});
   assert.equal(await text.inputValue(),''); assert.equal(await text.getAttribute('placeholder'),'Hello');
   await text.fill('Hallo'); await pause(900);
   assert.deepEqual(latest().slidesByDevice.watchos[0].textElements[0].text,{en:'Hello',de:'Hallo'}); await page.close();
 });
 await check('RTL copy gets its own base direction',async()=>{
   const {page}=await open(fixture({locales:['en','he'],locale:'he',slidesByDevice:{watchos:[slide('a',{headline:{en:'Hi',he:'שלום עולם!'}})]}}));
   const headline=page.locator('main [contenteditable=plaintext-only]').nth(1);
   assert.equal(await headline.evaluate(el=>getComputedStyle(el).direction),'rtl');
   assert.equal(await page.locator('main [contenteditable=plaintext-only]').first().evaluate(el=>getComputedStyle(el).direction),'ltr'); await page.close();
 });
 await check('generated feature-graphic decks normalise without an undo step',async()=>{
   const {page,latest}=await open(fixture({device:'feature-graphic',slidesByDevice:{'feature-graphic':[slide('one',{layout:'hero'}),slide('two',{layout:'hero'})]}}));
   await pause(1000);
   assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled(),false);
   assert.deepEqual(latest().slidesByDevice['feature-graphic'].map(s=>s.layout),['feature-graphic','feature-graphic']); await page.close();
 });
 await check('feature graphic app icon can be picked and exports',async()=>{
   const JSZip=require('../skills/app-store-screenshots/template/node_modules/jszip');
   const {page,latest}=await open(fixture({device:'feature-graphic',slidesByDevice:{'feature-graphic':[slide('banner',{layout:'feature-graphic'})]}}));
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#00ff00';x.fillRect(0,0,64,64);return c.toDataURL().split(',')[1]});
   await page.route('**/api/upload',route=>route.fulfill({json:{ok:true,path:'/bugbash-icon.png'}}));
   await page.locator('aside').last().locator('input[type=file]').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await pause(900); assert.equal(latest().appIcon,'/bugbash-icon.png');
   const downloaded=page.waitForEvent('download');
   await page.route('**/bugbash-icon.png',route=>route.fulfill({body:Buffer.from(png,'base64'),contentType:'image/png'}));
   await page.getByRole('button',{name:'Export bundle',exact:true}).click();
   const zip=await JSZip.loadAsync(await fs.readFile(await (await downloaded).path()));
   const image=await Object.values(zip.files).find(f=>f.name.endsWith('.png')).async('base64');
   const green=await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]<30&&p[i+1]>225&&p[i+2]<30)n++;return n},image);
   assert.ok(green>1000,'icon missing from feature graphic export'); await page.close();
 });
 await check('reset all devices keeps project settings and locales',async()=>{
   const {page,latest}=await open(fixture({appName:'Keep me',themeId:'dark-bold',locales:['en','de'],locale:'de',connectedCanvas:false}));
   await page.getByRole('button',{name:/reset/i}).first().click();
   await page.getByRole('button',{name:'Reset all devices',exact:true}).click(); await pause(900);
   const state=latest();
   assert.equal(state.appName,'Keep me'); assert.equal(state.themeId,'dark-bold'); assert.deepEqual(state.locales,['en','de']);
   assert.equal(state.locale,'de'); assert.equal(state.connectedCanvas,false); assert.equal(state.device,'watchos');
   assert.notEqual(state.slidesByDevice.watchos[0].id,'first'); await page.close();
 });
 await check('pasted rich text stays plain on the canvas',async()=>{
   const context=await browser.newContext({viewport:{width:1600,height:1000}});
   await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(baseURL).origin});
   const page=await context.newPage(); let latest=fixture();
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/project',async route=>{if(route.request().method()==='POST')latest=route.request().postDataJSON();await route.fulfill({json:{ok:true,state:latest}})});
   await page.goto(baseURL); await page.getByRole('button',{name:'Export bundle',exact:true}).waitFor();
   await page.evaluate(async()=>navigator.clipboard.write([new ClipboardItem({'text/html':new Blob(['<span style="color:red;font-size:80px">Pasted</span>'],{type:'text/html'}),'text/plain':new Blob(['Pasted'],{type:'text/plain'})})]));
   const headline=page.locator('main [contenteditable=plaintext-only]').nth(1);
   await headline.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+V'); await pause(900);
   assert.equal(await headline.evaluate(el=>el.children.length),0); assert.equal(await headline.textContent(),'Pasted');
   assert.equal(latest.slidesByDevice.watchos[0].headline.en,'Pasted'); await context.close();
 });
 await check('export finishes inline when PNG workers fail to load',async()=>{
   const JSZip=require('../skills/app-store-screenshots/template/node_modules/jszip');
   const context=await browser.newContext({viewport:{width:1600,height:1000}});
   // A worker whose script never loads: it reports an error and never replies.
   await context.addInitScript(()=>{window.Worker=class extends EventTarget{constructor(){super();setTimeout(()=>this.onerror?.(new ErrorEvent('error',{message:'blocked'})),200)}postMessage(){}terminate(){}}});
   const page=await context.newPage(); let latest=fixture();
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/project',async route=>{if(route.request().method()==='POST')latest=route.request().postDataJSON();await route.fulfill({json:{ok:true,state:latest}})});
   await page.goto(baseURL); await page.getByRole('button',{name:'Export bundle',exact:true}).waitFor();
   const downloaded=page.waitForEvent('download',{timeout:60000});
   await page.getByRole('button',{name:'Export bundle',exact:true}).click();
   const zip=await JSZip.loadAsync(await fs.readFile(await (await downloaded).path()));
   const pngs=Object.values(zip.files).filter(f=>f.name.endsWith('.png'));
   assert.equal(pngs.length,12);
   for(const png of pngs) assert.equal((await png.async('nodebuffer'))[25],2);
   await context.close();
 });
 assert.deepEqual(errors,[]);
 assert.ok(passed>0,'No matching checks');
 console.log(`${passed} browser regression checks passed in Google Chrome.`);
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
