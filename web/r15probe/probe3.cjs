const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const w of [768, 900, 1024]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:9721/mix/current/edit');
  await p.waitForTimeout(3000);
  for (const view of ['Story', 'Arrange', 'Detail']) {
    await p.getByRole('radio', { name: view }).check();
    await p.waitForTimeout(800);
    const e = await p.evaluate(() => [...document.querySelectorAll('.song-select, .song-name b')].filter((s) => /Extraordinarily/.test(s.textContent)).map((s) => `${s.tagName} w=${Math.round(s.getBoundingClientRect().width)} h=${Math.round(s.getBoundingClientRect().height)}`));
    console.log(w, view, e.join(' | '));
    if (w === 768) await p.screenshot({ path: `r15probe/edit768-${view}.png` });
  }
  await ctx.close();
  }
  await b.close();
})();
