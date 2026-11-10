import { test } from '@playwright/test';
import { resetMix } from './helpers';

test('dump', async ({ page, request }) => {
  await resetMix(request);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/mixes', '/library', '/listen', '/mix/current/edit', '/mixes/mine', '/workshop', '/glossary', '/listening']) {
      await page.goto(route);
      await page.locator('main#main').waitFor();
      await page.waitForTimeout(400);
      const out = await page.evaluate(() => {
        const rows: string[] = [];
        for (const h of document.querySelectorAll<HTMLElement>('main h1, main h2, main h3')) {
          const r = h.getBoundingClientRect();
          if (!r.height) continue;
          let next = h.nextElementSibling as HTMLElement | null;
          while (next && !next.getBoundingClientRect().height) next = next.nextElementSibling as HTMLElement | null;
          let prev = h.previousElementSibling as HTMLElement | null;
          while (prev && !prev.getBoundingClientRect().height) prev = prev.previousElementSibling as HTMLElement | null;
          const below = next ? Math.round(next.getBoundingClientRect().top - r.bottom) : null;
          const above = prev ? Math.round(r.top - prev.getBoundingClientRect().bottom) : null;
          rows.push(`${h.tagName}.${h.className} "${(h.textContent ?? '').slice(0, 24)}" above=${above}(${prev?.className ?? ''}) below=${below}(${next?.tagName}.${next?.className ?? ''})`);
        }
        const icons: string[] = [];
        for (const icon of document.querySelectorAll<SVGElement>('.ui-icon')) {
          const parent = icon.parentElement!;
          const ir = icon.getBoundingClientRect();
          if (!ir.width) continue;
          const range = document.createRange();
          range.selectNodeContents(parent);
          const textRects = [...parent.childNodes].filter((n) => n !== icon && (n.textContent ?? '').trim() && !(n instanceof HTMLElement && n.classList.contains('visually-hidden'))).map((n) => {
            const rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect();
          }).filter((x) => x.width);
          if (!textRects.length) continue;
          const t = textRects[0];
          icons.push(`${parent.tagName}.${parent.className} "${(parent.textContent ?? '').trim().slice(0, 20)}" gap=${Math.round((t.left - ir.right) * 10) / 10} dy=${Math.round(((t.top + t.height / 2) - (ir.top + ir.height / 2)) * 10) / 10}`);
        }
        return { rows, icons, main: document.querySelector('main')?.className };
      });
      console.log(`\n== ${route} @${width} main=${out.main}\n` + out.rows.join('\n') + '\n-- icons\n' + out.icons.join('\n'));
    }
  }
});
