const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const density of ['comfortable', 'compact']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript((d) => localStorage.setItem('selecta.prefs', JSON.stringify({ libraryLayout: 'list', density: d })), density);
    await p.goto('http://127.0.0.1:9721/library');
    await p.locator('.library-rows .song-row').first().waitFor({ timeout: 30000 });
    const r = await p.evaluate(() => {
      const row = document.querySelector('.library-rows .song-row');
      const kids = [...row.children].map((c) => `${c.className}:${Math.round(c.getBoundingClientRect().height)}`);
      const inner = [...row.querySelectorAll('.song-name > *, .song-readiness > *, .song-actions > *')].map((c) => `${c.tagName}.${c.className}:${Math.round(c.getBoundingClientRect().height)}`);
      const cs = getComputedStyle(row);
      return { h: row.getBoundingClientRect().height, pad: cs.padding, kids, inner, name: getComputedStyle(row.querySelector('.song-name')).display + ' ' + getComputedStyle(row.querySelector('.song-name')).gap };
    });
    console.log(density, JSON.stringify(r));
    await ctx.close();
  }
  await b.close();
})();
