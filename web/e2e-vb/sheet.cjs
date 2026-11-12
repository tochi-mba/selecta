// Contact sheets for reading many captures at once: node e2e-vb/sheet.cjs <outDir> <png...>
const { chromium } = require('@playwright/test');
const { readFileSync, statSync } = require('node:fs');
const { basename } = require('node:path');

(async () => {
  const [out, ...files] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const per = 6;
  for (let start = 0, n = 0; start < files.length; start += per, n += 1) {
    const chunk = files.slice(start, start + per);
    const cells = chunk.map((file) => `<figure><figcaption>${basename(file)} (${Math.round(statSync(file).size / 1024)} KB)</figcaption><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"></figure>`).join('');
    await page.setContent(`<style>body{margin:0;background:#888;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px}figure{margin:0;background:#fff}figcaption{padding:2px 4px}img{max-width:100%;display:block}</style>${cells}`);
    await page.screenshot({ path: `${out}-${n}.png`, fullPage: true });
  }
  await browser.close();
})();
