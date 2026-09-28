import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base=process.env.BASE??'http://localhost:3217';
const browser=await chromium.launch({channel:'msedge',headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await ctx.newPage(); const errors=[]; const failures=[]; let checks=0;
page.on('pageerror',e=>errors.push(e.message));
function check(name,ok,detail=''){checks++;if(!ok)failures.push(name+': '+detail);console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);}
await page.goto(base+'/login');await page.fill('#email','admin@company.com');await page.fill('#password','Admin@123');await page.locator('button[type=submit]').click();await page.waitForURL(/dashboard/);
await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();check('compact sidebar',await page.locator('.sidebar-compact').count()===1);
await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.sidebar-compact'));check('sidebar expands',true);
await page.keyboard.press('Control+k');await page.getByRole('combobox').fill('reports');await page.keyboard.press('Enter');await page.waitForURL(/reports/);check('command keyboard navigation',true);
await page.goto(base+'/employees');await page.getByRole('searchbox',{name:'Search this table'}).fill('zz-no-match');check('table empty search',await page.getByText('No matching records').isVisible());await page.getByRole('searchbox',{name:'Search this table'}).fill('');
await page.getByRole('button',{name:'Add Employee',exact:true}).click();await page.getByRole('dialog').waitFor();check('employee dialog',await page.getByRole('dialog').isVisible());await page.keyboard.press('Escape');check('dialog Escape',await page.getByRole('dialog').count()===0);
await page.goto(base+'/settings');for(const name of ['Company','Shift','Locations','Department','Holiday','Leave type','Desktop agent']){let tab=page.getByRole('tab',{name,exact:true});if(!await tab.count())tab=page.getByRole('tab',{name:'HOLIDAY',exact:true});await tab.click();check('settings '+name,await tab.getAttribute('aria-selected')==='true');}
for(const lang of ['en','ur'])for(const theme of ['dark','light']){
 await ctx.addCookies([{name:'lang',value:lang,url:base},{name:'theme',value:theme,url:base}]);
 for(const width of [1440,820,390]){
  await page.setViewportSize({width,height:950});
  for(const route of ['/dashboard','/team','/attendance','/employees','/employees/2','/leave','/corrections','/approvals','/reports','/settings','/audit','/profile','/apps']){
   await page.goto(base+route);await page.locator('h1').first().waitFor();
   const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,screen:innerWidth}));
   check(`${lang} ${theme} ${width} ${route}`,overflow.width<=overflow.screen+1,overflow.width>overflow.screen+1?JSON.stringify(overflow):'');
   if(route==='/dashboard'||(route==='/employees'&&width===1440))await page.screenshot({path:`test-run/ui-${lang}-${theme}-${width}-${route.slice(1)}.png`,fullPage:true});
  }
 }
}
await ctx.addCookies([{name:'lang',value:'en',url:base}]);await page.goto(base+'/dashboard');await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('dialog').waitFor();check('mobile menu dialog',await page.getByRole('dialog').isVisible());await page.keyboard.press('Escape');
await page.emulateMedia({reducedMotion:'reduce'});check('reduced motion',await page.locator('.rise').first().evaluate(el=>getComputedStyle(el).animationName)==='none');
await page.goto(base+'/attendance');const next=page.getByRole('button',{name:'Next page',exact:true});await next.waitFor();await next.click();check('table pagination',await page.getByRole('button',{name:'Previous page',exact:true}).isEnabled());
await page.goto(base+'/kiosk');await page.locator('img[alt="Check-in QR code"]').waitFor();check('kiosk loaded',true);await page.screenshot({path:'test-run/ui-kiosk-mobile.png',fullPage:true});
check('no runtime errors',errors.length===0,errors.join('\n'));fs.writeFileSync('test-run/ui-verification.json',JSON.stringify({checks,failures,errors},null,2));
await browser.close();console.log(`${checks-failures.length}/${checks} passed`);if(failures.length)process.exitCode=1;
