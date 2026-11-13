// PLAYWRIGHT_MODULE may name an existing Playwright installation. No app dependency required.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const out=process.env.COMBUSTION_EVIDENCE_DIR || 'output/playwright/combustion-final'; fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:out,size:{width:1440,height:1000}}});
 const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(process.env.COMBUSTION_URL || 'http://localhost:5178');await page.waitForFunction(()=>window.render_game_to_text);
 const state=async()=>{await page.evaluate(()=>window.advanceTime(0));return page.evaluate(()=>JSON.parse(window.render_game_to_text()));};
 const advanceTo=async(target)=>{let s=await state();while(s.ticks<target){await page.evaluate(()=>window.advanceTime(500));s=await state();}return s;};
 await page.locator('[data-scene="burn-tree"]').click();
 const samples=[];
 for(const seconds of (process.env.COMBUSTION_CONTROLS_ONLY ? [5] : [10,30,60])){
   samples.push(await advanceTo(seconds*60));await page.locator('#pause').click();await page.waitForTimeout(300);
   await page.screenshot({path:`${out}/tree-${seconds}s.png`});
   await page.locator('#pause').click();
 }
 fs.writeFileSync(`${out}/tree-samples.json`,JSON.stringify(samples,null,2));
 // Capture several ordinary, unstepped frames to show asynchronous flicker.
 for(let i=0;i<4;i++){await page.waitForTimeout(130);await page.locator('canvas').screenshot({path:`${out}/flame-frame-${i}.png`});}
 await page.locator('#pause').click();await page.evaluate(()=>window.advanceTime(0));const paused=await state();
 await page.locator('#step').click();await page.evaluate(()=>window.advanceTime(0));const stepped=await state();if(stepped.ticks!==paused.ticks+1)throw Error('Single-step mismatch');
 await page.locator('#zoom-in').click();await page.waitForTimeout(100);if((await state()).zoom<=1)throw Error('Zoom failed');
 await page.locator('#zoom-reset').click();
 await page.locator('[data-material="2"]').click();
 const box=await page.locator('canvas').boundingBox();await page.mouse.click(box.x+box.width*.49,box.y+box.height*.85);await page.waitForTimeout(200);
 await page.locator('#pause').click();await page.evaluate(()=>window.advanceTime(500));
 samples.push(await state());await page.screenshot({path:`${out}/water.png`});
 await page.locator('#pause').click();await page.locator('#clear').click();await page.waitForTimeout(200);if(Object.keys((await state()).counts).length)throw Error('Clear failed');
 await page.locator('[data-scene="fire"]').click();await page.locator('#pause').click();await advanceTo(600);await page.locator('#pause').click();await page.waitForTimeout(300);await page.screenshot({path:`${out}/lava-wood-after.png`});
 await page.setViewportSize({width:390,height:844});await page.locator('#fullscreen').click();await page.waitForTimeout(200);await page.screenshot({path:`${out}/mobile.png`});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.keyboard.press('Escape');
 fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({samples,errors,controls:['pause','step','zoom','water paint','clear','scene reset','mobile fullscreen']},null,2));
 await context.close();await browser.close();if(errors.length)throw Error(errors.join('\n'));
})();
