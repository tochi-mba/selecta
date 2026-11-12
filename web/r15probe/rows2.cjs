const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem('selecta.prefs', JSON.stringify({ libraryLayout: 'list', density: 'compact' })));
  await p.goto('http://127.0.0.1:9721/library');
  await p.locator('.library-rows .song-row').first().waitFor({ timeout: 30000 });
  const r = await p.evaluate(() => [...document.querySelectorAll('.library-rows .song-row')].slice(0, 6).map((row) => ({
    h: Math.round(row.getBoundingClientRect().height),
    name: [...row.querySelector('.song-name').children].map((c) => `${c.tagName}.${c.className}[${c.textContent.slice(0, 30)}]:${Math.round(c.getBoundingClientRect().height)} ${getComputedStyle(c).minHeight} ${getComputedStyle(c).padding}`),
  })));
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
