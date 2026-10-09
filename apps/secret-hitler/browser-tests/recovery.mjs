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
 assert.equal(await guest.locator('[data-recover]').count(),0);
 await host.locator(`[data-recover="${g.players[1].id}"]`).click();
 const link=await host.locator('#recovery-link').inputValue();
 assert.match(link, /#recover=[a-f0-9]{64}$/);
 await host.locator('#seat-recovery form button').click();
 const freshContext=await browser.newContext({viewport:{width:390,height:844}});
 try {
  const fresh=await freshContext.newPage();
  await fresh.goto(link);
  await fresh.locator('#accept-recovery').click();
  await fresh.locator('.action.president-discard').waitFor();
  assert.equal(new URL(fresh.url()).hash,'');
  const saved=await fresh.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')));
  assert.equal(saved.token,g.players[1].token);
  assert.equal(await fresh.locator('.player').count(),5);
  host.once('dialog',d=>d.accept());
  await host.locator('[data-action="end-game"]').click();
  await fresh.locator('.action.finished').waitFor();
  await fresh.locator('#leave-room').click();
  await fresh.locator('#entry').waitFor();
  assert.equal(await fresh.evaluate(code=>JSON.parse(localStorage.getItem('assembly-saved-seats'))[code].token,g.code),g.players[1].token);
  await host.locator('[data-action="restart"]').click();
  await host.locator('.action.lobby').waitFor();
  await fresh.goto(base+'/?room=ABCDEF');
  await fresh.locator('.action.lobby').waitFor();
  assert.equal(await fresh.locator('.player').count(),5);
  await fresh.locator('#leave-room').click();
  await fresh.locator('#entry').waitFor();
  await fresh.goto(base+'/?room=ABCDEF');
  await fresh.locator('#name').fill(g.players[1].name);
  await fresh.locator('#entry button[type="submit"]').click();
  await fresh.locator('.action.lobby').waitFor();
  const attempts=await fresh.evaluate(()=>JSON.parse(localStorage.getItem('assembly-join-attempts')));
  assert.equal(Object.keys(attempts).length,1);
  // Token storage lost, but the retained join key recovers the same seat.
  const token=await fresh.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')).token);
  await fresh.evaluate(()=>{localStorage.removeItem('assembly-session');localStorage.removeItem('assembly-saved-seats');});
  await fresh.reload();
  await fresh.locator('#name').fill(g.players[1].name);
  await fresh.locator('#entry button[type="submit"]').click();
  await fresh.locator('.action.lobby').waitFor();
  assert.equal(await fresh.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')).token),token);
 } finally {await freshContext.close();}
 assert.deepEqual(errors,[]);
 console.log('PASS: fresh-browser seat recovery, finished leave/restart resume, lobby leave/rejoin, retained join retry key');

} finally { await context.close(); await browser.close(); child.kill(); await once(child,'exit'); await rm(dir,{recursive:true,force:true}); }
