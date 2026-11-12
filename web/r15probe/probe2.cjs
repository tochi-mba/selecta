const { chromium } = require('@playwright/test');
const B = 'http://127.0.0.1:9721';
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const out = [];
  for (const density of ['comfortable', 'compact']) for (const width of [320, 768, 1024, 1440]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript((d) => localStorage.setItem('selecta.prefs', JSON.stringify({ libraryLayout: 'list', density: d })), density);
    await p.goto(B + '/library');
    await p.locator('.library-rows .song-row').first().waitFor({ timeout: 30000 });
    const r = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.library-rows .song-row')];
      for (const row of rows) row.style.contentVisibility = 'visible';
      const hs = rows.map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
      const est = getComputedStyle(document.querySelector('.library-rows')).getPropertyValue('--library-row-estimate');
      return { median: hs[Math.floor(hs.length / 2)], est };
    });
    out.push(`${density} ${width}: median ${r.median} est ${r.est}`);
    await ctx.close();
  }
  console.log(out.join('\n'));
  // editor at 768
  const ctx = await b.newContext({ viewport: { width: 768, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(B + '/mix/current/edit');
  await p.waitForTimeout(4000);
  const e = await p.evaluate(() => [...document.querySelectorAll('.timeline .song .song-select')].slice(0, 12).map((s) => `${s.textContent.slice(0, 25)} w=${Math.round(s.getBoundingClientRect().width)} h=${Math.round(s.getBoundingClientRect().height)} name=${Math.round(s.closest('.song-name').getBoundingClientRect().width)} row=${Math.round(s.closest('.song').getBoundingClientRect().width)} cols=${getComputedStyle(s.closest('.song')).gridTemplateColumns}`));
  console.log(e.join('\n'));
  await p.screenshot({ path: 'r15probe/edit768.png' });
  await b.close();
})();
