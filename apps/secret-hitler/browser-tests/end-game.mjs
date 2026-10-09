const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import { create, player, action } from '../game.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const dir = await mkdtemp('/tmp/sh-discard-');
const g = create('ABCDEF', 'Host');
for(let i=1;i<5;i++) g.players.push(player('Player '+i));
action(g,g.host,'start');
g.president=0; g.chancellor=g.players[1].id; g.phase='president-discard';
g.hand=['Liberal','Fascist','Fascist'];
await writeFile(dir+'/rooms.json',JSON.stringify({ABCDEF:g}));
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dir,PORT:'0',OPENROUTER_API_KEY:''},stdio:['ignore','pipe','pipe']});
const [buf]=await once(child.stdout,'data');
const base='http://127.0.0.1:'+String(buf).match(/listening on (\d+)/)[1];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844}});
try {
 const pages=[]; let actions=0; const errors=[];
 for(const person of g.players.slice(0,3)) {
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/action')) actions++;});
  await page.goto(base);
  await page.evaluate(s=>localStorage.setItem('assembly-session',JSON.stringify(s)),{code:g.code,token:person.token});
  await page.goto(base+'/?room=ABCDEF');
  await page.locator('.action.president-discard').waitFor(); pages.push(page);
 }
 const [host,guest]=pages;
 assert.equal(await guest.locator('[data-action="end-game"]').count(),0);
 host.once('dialog',d=>d.dismiss());
 await host.locator('[data-action="end-game"]').click();
 assert.equal(await host.locator('.action.president-discard').count(),1);
 assert.equal(actions,0);
 host.once('dialog',d=>d.accept());
 await host.locator('[data-action="end-game"]').click();
 await host.locator('.action.finished').waitFor();
 assert.match(await host.locator('.action.finished').innerText(),/Game ended/);
 assert.match(await host.locator('.action.finished').innerText(),/No winner/);
 await guest.locator('.action.finished').waitFor();
 assert.equal(await host.locator('[data-action="end-game"]').count(),0);
 await host.locator('[data-action="restart"]').click();
 await host.locator('.action.lobby').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: host-only end button, cancel, confirm, guest update and restart');

} finally { await context.close(); await browser.close(); child.kill(); await once(child,'exit'); await rm(dir,{recursive:true,force:true}); }
