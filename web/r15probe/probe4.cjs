const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const w of [768, 900, 1024, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:9721/mix/current/edit');
  await p.getByRole('radio', { name: 'Arrange' }).check();
  await p.locator('.song-select').nth(1).click();
  await p.waitForTimeout(1000);
  const e = await p.evaluate(() => [...document.querySelectorAll('.timeline .song-select b')].map((s) => `w=${Math.round(s.getBoundingClientRect().width)}`).slice(0, 3).join(','));
  console.log(w, e);
  await p.screenshot({ path: `r15probe/sel${w}.png` });
  await ctx.close();
  }
  await b.close();
})();
