const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');import assert from 'node:assert/strict';
const base=process.env.CHECK_URL||'http://127.0.0.1:3000';const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});let h,guestSeat;
try{
 const host=await browser.newPage({viewport:{width:390,height:844}}),guest=await browser.newPage();
 await host.goto(base);await host.getByLabel('YOUR NAME').fill('Kick check host');await host.getByRole('button',{name:'Create a private room'}).click();await host.locator('.room-ticket').waitFor();h=await host.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')));
 await guest.goto(base+'/?room='+h.code);await guest.getByLabel('YOUR NAME').fill('Retry guest');
 await guest.route('**/api/join',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 await guest.locator('button[type=submit]').click();await guest.locator('#error').filter({hasText:/fetch|network|Failed/i}).waitFor();
 await guest.reload();await guest.getByLabel('YOUR NAME').fill('Retry guest');await guest.locator('button[type=submit]').click();await guest.locator('.room-ticket').waitFor();guestSeat=await guest.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')));
 await host.getByRole('button',{name:'Kick Retry guest',exact:true}).waitFor();assert.equal(await guest.locator('[data-kick]').count(),0);assert.equal(await host.locator('.player').count(),2);
 host.once('dialog',d=>d.dismiss());await host.getByRole('button',{name:'Kick Retry guest',exact:true}).click();assert.equal(await host.locator('.player').count(),2);
 host.once('dialog',d=>d.accept());await host.getByRole('button',{name:'Kick Retry guest',exact:true}).click();await host.waitForFunction(()=>document.querySelectorAll('.player').length===1);
 await guest.locator('#entry').waitFor();assert.match(await guest.locator('#error').innerText(),/seat is no longer available/);assert.equal(await guest.evaluate(()=>localStorage.getItem('assembly-session')),null);
 await guest.getByLabel('YOUR NAME').fill('Retry guest');await guest.locator('button[type=submit]').click();await guest.locator('.room-ticket').waitFor();const newSeat=await guest.evaluate(()=>JSON.parse(localStorage.getItem('assembly-session')));assert.notEqual(newSeat.token,guestSeat.token);guestSeat=newSeat;
 assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);console.log('PASS: lost join response + reload retries same seat; only host sees Kick; cancel is safe; kick clears removed browser session; same name can rejoin; no duplicate ghost.');
}finally{await browser.close();for(const s of [guestSeat,h].filter(Boolean))await fetch(base+'/api/rooms/'+s.code+'/leave',{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:'{}'});}
