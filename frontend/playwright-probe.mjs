import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  args: ['--no-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage','--disable-setuid-sandbox','--disable-software-rasterizer'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const logs = [];
page.on('console', msg => logs.push(`[CONSOLE ${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message}\n${err.stack || ''}`));
page.on('response', res => { if (res.status() >= 400) logs.push(`[HTTP ${res.status()}] ${res.url()}`); });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => logs.push('[GOTO ERROR] ' + e.message));
await page.waitForTimeout(2000);
const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML || '(no root)');
console.log('===== ROOT HTML (first 400 chars) =====');
console.log(rootHtml.slice(0, 400));
console.log('===== ERRORS =====');
console.log(logs.length === 0 ? '(nothing)' : logs.join('\n'));
await browser.close();
