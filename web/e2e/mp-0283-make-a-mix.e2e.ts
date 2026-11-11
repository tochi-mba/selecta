import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { resetMix, spyOnAudio, audioClock } from './helpers';

/**
 * ADR-0283 Make a Mix hero, idea cards and filters, measured from the real stylesheet in Edge against the
 * synthetic library in tests/e2e_server.py at 320, 768 and 1440. Candidates for an independent reviewer,
 * not a human visual approval.
 */
const WIDTHS = [320, 768, 1440] as const;

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/mixes');
  await expect(page.locator('.vibe-card').first()).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

/** Rectangles for each selector, inside the page. */
const boxes = (page: Page, selectors: string[], root = 'main#main') => page.evaluate(({ selectors, root }) => {
  const scope = document.querySelector(root)!;
  return Object.fromEntries(selectors.map((selector) => {
    const element = scope.querySelector(selector);
    const box = element?.getBoundingClientRect();
    return [selector, box && box.width ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } : null];
  }));
}, { selectors, root });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0283-01 the featured idea: title, matching songs, description and Play share one edge, in that order', async ({ page, request }) => {
  await request.post('/api/mix/clear');
  for (const width of WIDTHS) {
    await open(page, width);
    const quick = '.mix-quick';
    const at = await boxes(page, [`${quick} h3.display`, `${quick} .mix-quick-facts`, `${quick} .lede`, `${quick} .row .primary`]);
    const [title, facts, lede, play] = Object.values(at);
    const where = `${width}px`;
    for (const [name, box] of Object.entries(at)) expect(box, `${where}: ${name} shown`).not.toBeNull();
    for (const box of [facts!, lede!, play!]) expect(Math.abs(box.left - title!.left), `${where}: off the title's edge`).toBeLessThanOrEqual(1);
    expect(facts!.top, `${where}: matching songs under the title`).toBeGreaterThanOrEqual(title!.bottom - 1);
    expect(lede!.top, `${where}: description under the matching songs`).toBeGreaterThanOrEqual(facts!.bottom - 1);
    expect(play!.top, `${where}: Play under the description`).toBeGreaterThanOrEqual(lede!.bottom - 1);
    await expect(page.locator(`${quick} .mix-quick-facts`)).toContainText(/\d+ matching songs/);
    expect(play!.height, `${where}: Play is a full target`).toBeGreaterThanOrEqual(44);
  }
});

test('MP-0283-02 card interiors: one padding, one content edge, the tempo badge on the title baseline', async ({ page }, info) => {
  const readings = [];
  for (const width of WIDTHS) {
    await open(page, width);
    const cards = await page.locator('.vibe-card').evaluateAll((elements) => elements.map((card) => {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const inner = { left: box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth), right: box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) };
      const baseline = (element: Element | null) => {
        if (!element) return null;
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        element.prepend(probe);
        const y = probe.getBoundingClientRect().top;
        probe.remove();
        return y;
      };
      const part = (selector: string) => card.querySelector(selector)?.getBoundingClientRect() ?? null;
      const title = card.querySelector('.vibe-card-head h3');
      const tempo = card.querySelector('.vibe-tempo');
      return {
        key: card.getAttribute('data-vibe'),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        inner,
        top: box.top,
        lefts: ['.vibe-motif', '.vibe-card-head', '.vibe-card-summary', '.vibe-card-facts', '.vibe-card-detail', '.card-actions'].map((selector) => [selector, part(selector)?.left ?? null, part(selector)?.right ?? null]),
        titleBaseline: baseline(title),
        titleBottom: title?.getBoundingClientRect().bottom ?? 0,
        tempoBaseline: baseline(tempo),
        tempoTop: tempo?.getBoundingClientRect().top ?? null,
        motifTop: part('.vibe-motif')?.top ?? null,
      };
    }));
    expect(cards.length, 'idea cards').toBeGreaterThan(2);
    for (const card of cards) {
      const where = `${card.key} at ${width}px`;
      expect(new Set(card.padding).size, `${where}: padding differs by side`).toBe(1);
      expect(card.padding[0], `${where}: padding is the card token`).toBe(cards[0].padding[0]);
      for (const [selector, left, right] of card.lefts) {
        if (left === null) continue;
        expect(Math.abs((left as number) - card.inner.left), `${where}: ${selector} starts off the content edge`).toBeLessThanOrEqual(1);
        expect(right as number, `${where}: ${selector} runs past the content edge`).toBeLessThanOrEqual(card.inner.right + 1);
      }
      // on one line with the title, the badge shares its first baseline; wrapped, it starts on the content edge
      if (card.tempoBaseline !== null && card.tempoTop! < card.titleBottom) {
        expect(Math.abs(card.tempoBaseline - card.titleBaseline!), `${where}: tempo badge off the title baseline`).toBeLessThanOrEqual(1);
      }
    }
    // cards side by side: the motif and the title's first baseline line up across the row
    const rows = new Map<number, typeof cards>();
    for (const card of cards) rows.set(Math.round(card.top), [...(rows.get(Math.round(card.top)) ?? []), card]);
    for (const row of rows.values()) {
      for (const card of row) {
        expect(Math.abs(card.motifTop! - row[0].motifTop!), `${width}px: motifs off one line`).toBeLessThanOrEqual(1);
        expect(Math.abs(card.titleBaseline! - row[0].titleBaseline!), `${width}px: titles off one baseline`).toBeLessThanOrEqual(1);
      }
    }
    readings.push({ width, cards });
  }
  writeFileSync(info.outputPath('mp-0283-02-cards.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0283-03 Play leads, Shape first follows, Save draft is the quiet third', async ({ page }) => {
  for (const width of WIDTHS) {
    await open(page, width);
    const tiers = await page.locator('.vibe-card .card-actions').first().evaluate((row) => [...row.children].map((button) => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      // an Action keeps its busy label in the button, hidden, so its size never jumps: read the shown label
      return { name: (button.querySelector('.action-labels > :first-child') ?? button).textContent?.trim(), background: style.backgroundColor, border: style.borderTopColor, color: style.color, weight: Number(style.fontWeight), top: box.top, bottom: box.bottom, height: box.height, width: box.width };
    }));
    const where = `${width}px`;
    expect(tiers.map((tier) => tier.name), `${where}: order`).toEqual(['Play', 'Shape first', 'Save draft']);
    const [play, shape, draft] = tiers;
    const clear = (colour: string) => colour === 'rgba(0, 0, 0, 0)' || colour === 'transparent';
    expect(clear(play.background), `${where}: Play is filled`).toBe(false);
    expect(clear(shape.background), `${where}: Shape first is not filled`).toBe(true);
    expect(clear(shape.border), `${where}: Shape first keeps its outline`).toBe(false);
    expect(clear(draft.background) && clear(draft.border), `${where}: Save draft has no fill or outline`).toBe(true);
    expect(draft.color, `${where}: Save draft is soft text`).not.toBe(shape.color);
    expect(Math.abs(play.height - shape.height), `${where}: Play and Shape first are one height`).toBeLessThanOrEqual(1);
    expect(Math.abs(play.top - shape.top), `${where}: Play and Shape first share a line`).toBeLessThanOrEqual(1);
    expect(draft.top, `${where}: Save draft is under them`).toBeGreaterThanOrEqual(play.bottom - 1);
    expect(draft.height, `${where}: Save draft is still a full target`).toBeGreaterThanOrEqual(24);
    expect(draft.width, `${where}: Save draft is narrower than Play`).toBeLessThan(play.width * 2);
  }
});

test('MP-0283-04 filter chips wrap whole, headings introduce their cards, and gutters match both ways', async ({ page }) => {
  for (const width of WIDTHS) {
    await open(page, width);
    const where = `${width}px`;
    const chips = await page.locator('.vibe-filters').evaluate((group) => {
      const style = getComputedStyle(group);
      return {
        rowGap: style.rowGap, columnGap: style.columnGap,
        right: group.getBoundingClientRect().right,
        chips: [...group.querySelectorAll('button')].map((chip) => ({ clipped: chip.scrollWidth > chip.clientWidth + 1, right: chip.getBoundingClientRect().right, height: chip.getBoundingClientRect().height })),
      };
    });
    expect(chips.rowGap, `${where}: chip rows and columns share a gap`).toBe(chips.columnGap);
    for (const chip of chips.chips) {
      expect(chip.clipped, `${where}: a chip is cut`).toBe(false);
      expect(chip.right, `${where}: a chip leaves the window`).toBeLessThanOrEqual(width);
    }
    expect(new Set(chips.chips.map((chip) => Math.round(chip.height))).size, `${where}: chips one height`).toBe(1);
    const groups = await page.locator('.vibe-group').evaluateAll((elements) => elements.map((group) => {
      const heading = group.querySelector(':scope > .eyebrow')!.getBoundingClientRect();
      const grid = group.querySelector(':scope > .cards')!;
      const cards = [...grid.children].map((card) => card.getBoundingClientRect());
      const style = getComputedStyle(grid);
      return { headingToCards: grid.getBoundingClientRect().top - heading.bottom, rowGap: style.rowGap, columnGap: style.columnGap, cards: cards.map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })) };
    }));
    expect(groups.length).toBeGreaterThan(0);
    const spacing = groups[0].headingToCards;
    for (const group of groups) {
      expect(Math.abs(group.headingToCards - spacing), `${where}: heading-to-cards spacing differs`).toBeLessThanOrEqual(1);
      expect(group.rowGap, `${where}: card rows and columns share a gutter`).toBe(group.columnGap);
      const gutter = parseFloat(group.columnGap);
      for (let index = 1; index < group.cards.length; index += 1) {
        const [before, after] = [group.cards[index - 1], group.cards[index]];
        const measured = Math.abs(after.top - before.top) < 1 ? after.left - before.right : after.top - before.bottom;
        if (measured > 0) expect(Math.abs(measured - gutter), `${where}: gutter ${measured}px`).toBeLessThanOrEqual(1);
      }
    }
    expect(spacing, `${where}: heading sits close to its cards`).toBeLessThanOrEqual(16);
  }
});

test('MP-0283-05 an opened card disclosure shows every reason whole, with the actions still in the card', async ({ page }) => {
  for (const width of [320, 1440]) {
    await open(page, width);
    const cards = page.locator('.vibe-card');
    const count = Math.min(await cards.count(), 6);
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const before = await card.boundingBox();
      await card.locator('.vibe-card-detail > summary').click();
      const shown = await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const detail = element.querySelector('details')!;
        const parts = [...detail.querySelectorAll('p, a')].map((part) => {
          const rect = part.getBoundingClientRect();
          return { text: part.textContent ?? '', inside: rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1, clipped: part.scrollHeight > part.clientHeight + 1 || part.scrollWidth > part.clientWidth + 1 };
        });
        const actions = element.querySelector('.card-actions')!.getBoundingClientRect();
        return { open: detail.open, parts, actionsInside: actions.bottom <= box.bottom + 1, summary: element.querySelector('.vibe-card-summary')!.textContent };
      });
      const where = `card ${index} at ${width}px`;
      expect(shown.open, where).toBe(true);
      for (const part of shown.parts) {
        expect(part.inside, `${where}: "${part.text.slice(0, 30)}" outside the card`).toBe(true);
        expect(part.clipped, `${where}: "${part.text.slice(0, 30)}" cut off`).toBe(false);
      }
      // the summary on the card is clamped to two lines; the disclosure carries the whole reason
      expect(shown.parts[0].text, `${where}: full reason`).toBe(shown.summary);
      expect(shown.actionsInside, `${where}: actions pushed out`).toBe(true);
      const after = await card.boundingBox();
      expect(after!.height, `${where}: the card grows to fit`).toBeGreaterThanOrEqual(before!.height);
      await card.locator('.vibe-card-detail > summary').press('Enter');
      expect(await card.locator('details').evaluate((detail) => (detail as HTMLDetailsElement).open), `${where}: keyboard closes`).toBe(false);
    }
  }
});

test('MP-0283-06 Shape groups energy, length and song count, with Done and Escape to leave', async ({ page }) => {
  for (const width of [320, 1440]) {
    await open(page, width);
    const trigger = page.getByRole('button', { name: 'Customize' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
    await expect(dialog).toBeVisible();
    const group = dialog.locator('.setup-group', { hasText: 'Where the mix goes' });
    await expect(group).toBeVisible();
    const length = dialog.getByRole('group', { name: 'How long, roughly' });
    await expect(length.getByRole('button')).toHaveCount(3);
    await expect(length.getByRole('button', { name: /About 1 hour · 24 songs/ })).toBeVisible();
    const order = await dialog.evaluate((element) => {
      const top = (selector: string) => element.querySelector(selector)?.getBoundingClientRect().top ?? null;
      return { heading: [...element.querySelectorAll('.setup-group')].find((heading) => heading.textContent === 'Where the mix goes')!.getBoundingClientRect().top, length: top('.mix-length'), energy: top('.energy-arc') };
    });
    expect(order.length!, `${width}px: length under its group heading`).toBeGreaterThan(order.heading);
    if (order.energy !== null) expect(order.energy, `${width}px: energy shape in the same group`).toBeGreaterThan(order.length!);
    await length.getByRole('button', { name: /About 1 hour/ }).click();
    await expect(length.getByRole('button', { name: /About 1 hour/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Done shaping' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done shaping' }).click();
    await expect(dialog).toBeHidden();
    // the choice made in the dialog is the one Make a Mix will ask for
    await expect(page.locator('.mix-quick').getByRole('button', { name: 'About 1 hour' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mix-quick')).toContainText('24 songs');
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test('MP-0283-07 saving, building and a failure keep each card its size, and what is playing keeps playing', async ({ page, request }) => {
  await spyOnAudio(page);
  await resetMix(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0.3);
  await page.getByRole('link', { name: 'Make a Mix' }).first().click();
  await expect(page.locator('.vibe-card').first()).toBeVisible();
  const card = page.locator('.vibe-card').first();
  const size = async () => {
    const box = (await card.boundingBox())!;
    const buttons = await card.locator('.card-actions > button').evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().width)));
    return { width: Math.round(box.width), height: Math.round(box.height), buttons };
  };
  const before = await size();

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let fail = false;
  await page.route('**/api/vibes/*/build*', async (route) => {
    await held;
    if (fail) await route.fulfill({ status: 500, json: { detail: 'The test server refused this one.' } });
    else await route.fallback();
  });
  // Save draft, held on the server: the card and every button keep their size while it says Saving
  await card.getByRole('button', { name: /^Save draft for / }).click();
  await expect(card.locator('.save-draft')).toHaveAttribute('aria-busy', 'true');
  expect(await size(), 'while saving').toEqual(before);
  release();
  await expect(card.locator('.save-draft')).not.toHaveAttribute('aria-busy', 'true');
  expect(await size(), 'after saving').toEqual(before);

  // a build that fails: the card keeps its size, the reason shows, and the music never stopped
  fail = true;
  const clock = (await audioClock(page))[0];
  await card.getByRole('button', { name: 'Play', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Replace and play' }).click();
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  expect(await size(), 'after a failure').toEqual(before);
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clock + 0.3);
  expect(await page.evaluate(() => window.audioSpy.contexts.map((context) => context.state))).toContain('running');
});
