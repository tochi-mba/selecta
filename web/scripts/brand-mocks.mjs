// Screenshots of the branded pages we own, for docs/engineering/branded-surfaces.md: the
// Cloudflare error pages and one of our emails, in light and dark. Run from web/ after
// `uv run python infra/cloudflare/error-pages/build.py` and after writing the sample email
// (`uv run python -c "..."` in the doc). Uses Playwright's Chromium; nothing is downloaded.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'docs', 'engineering', 'branded-surfaces');
const PAGES = [
  ['infra/cloudflare/error-pages/5xx.html', 'cloudflare-5xx'],
  ['infra/cloudflare/error-pages/rate-limited.html', 'cloudflare-rate-limited'],
  ['docs/engineering/branded-surfaces/sample-email.html', 'email-payment-failed'],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 720, height: 640 }, colorScheme: scheme });
    for (const [source, name] of PAGES) {
      await page.setContent(await readFile(join(root, source), 'utf8'));
      await page.screenshot({ path: join(out, `${name}-${scheme}.png`), fullPage: true });
      console.log(`${name}-${scheme}.png`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
