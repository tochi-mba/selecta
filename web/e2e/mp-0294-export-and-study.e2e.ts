import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0294 export job progression and blind listening-study precision, measured in Edge against the
 * synthetic library in tests/e2e_server.py. Export jobs in states the synthetic server can't hold
 * still long enough to measure (encoding, failed, expired) and study trials are stubbed with made-up
 * values. Candidates for an independent reviewer, not a listening or visual approval.
 */
const WIDTHS = [320, 768, 1440] as const;

type MixItem = { song_id: number; title: string; artist: string; seam?: { state: { key: string } } };

async function currentMix(request: APIRequestContext): Promise<MixItem[]> {
  return (await (await request.get('/api/mix')).json()).mix;
}

/** One export job of the current mix, as GET /api/exports/jobs reports it, in a chosen state. */
function job(mix: MixItem[], state: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'job-synthetic', state, scope: 'current', draft: null, mix_name: 'Synthetic evening mix', revision: 'rev-0294-synthetic',
    songs: mix.map((item) => ({ song_id: item.song_id, title: item.title, artist: item.artist })),
    seams: mix.slice(1).map((item, index) => ({ key: item.seam?.state.key ?? `seam-${index}`, from: mix[index].title, to: item.title })),
    seams_total: mix.length - 1, seams_ready: state === 'preparing' ? 1 : mix.length - 1, seconds_estimate: 600,
    name: 'synthetic-evening-mix.flac', seconds: state === 'ready' ? 598 : null,
    error: state === 'failed' ? 'The encoder stopped before the file was finished.' : null,
    created_at: 1_793_000_000, can_cancel: ['preparing', 'encoding'].includes(state), quiet_seconds: 0, ...extra,
  };
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('MP-0294-01 mix name, revision, FLAC and what it waits on read as one clear hierarchy', async ({ page, request }) => {
  const mix = await currentMix(request);
  let jobs: unknown[] = [];
  await page.route('**/api/exports/jobs', (route) => route.request().method() === 'GET' ? route.fulfill({ json: { jobs } }) : route.fallback());
  for (const width of WIDTHS) {
    for (const started of [false, true]) {
      jobs = started ? [job(mix, 'preparing')] : [];
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/mix/current/edit');
      await page.getByRole('button', { name: 'Download audio' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
      await expect(dialog).toBeVisible();
      await settle(page);
      if (started) await expect(dialog.getByText('Frozen revision')).toBeVisible();
      const reading = await dialog.evaluate((panel) => {
        const body = panel.querySelector('.overlay-body')!;
        const identity = body.querySelector(':scope > p')!;
        const name = identity.querySelector('b')!;
        const meta = identity.querySelector('.soft')!;
        const revision = [...body.querySelectorAll('p')].find((node) => node.textContent?.startsWith('Frozen revision'));
        const stages = body.querySelector('.export-stages')!;
        const waits = [...body.querySelectorAll('p')].find((node) => /transitions ready|Ready|Didn’t work|Preparing|Creating/.test(node.textContent ?? '') && node.getBoundingClientRect().top > stages.getBoundingClientRect().top);
        const style = (node: Element) => getComputedStyle(node);
        return {
          nameWeight: Number(style(name).fontWeight), metaWeight: Number(style(meta).fontWeight),
          nameColor: style(name).color, metaColor: style(meta).color,
          nameSize: parseFloat(style(name).fontSize), metaSize: parseFloat(style(meta).fontSize),
          metaText: meta.textContent,
          identityTop: identity.getBoundingClientRect().top,
          revisionTop: revision?.getBoundingClientRect().top ?? null,
          stagesTop: stages.getBoundingClientRect().top,
          waitsTop: waits?.getBoundingClientRect().top ?? null,
          first: body.firstElementChild === identity,
        };
      });
      const at = `${width}px ${started ? 'started' : 'not started'}`;
      expect(reading.first, `${at}: the mix name opens the dialog`).toBe(true);
      expect(reading.metaText, at).toMatch(/current mix, \d+ songs, about .+\. FLAC\./);
      expect(reading.nameWeight, `${at}: name weight`).toBeGreaterThan(reading.metaWeight);
      expect(reading.nameSize, `${at}: name size`).toBeGreaterThanOrEqual(reading.metaSize);
      expect(reading.nameColor, `${at}: meta is quieter than the name`).not.toBe(reading.metaColor);
      expect(reading.waitsTop, `${at}: what it waits on`).not.toBeNull();
      expect(reading.stagesTop, `${at}: stages come after the identity`).toBeGreaterThan(reading.identityTop);
      expect(reading.waitsTop!, `${at}: prerequisites come after the stages`).toBeGreaterThan(reading.stagesTop);
      if (started) {
        expect(reading.revisionTop!, `${at}: revision sits under the identity`).toBeGreaterThan(reading.identityTop);
        expect(reading.revisionTop!, `${at}: revision comes before the stages`).toBeLessThan(reading.stagesTop);
      }
      await page.keyboard.press('Escape');
    }
  }
});

const ROW = (page: Page) => page.locator('.exports-list .export-job').first();

async function rowGeometry(page: Page) {
  return ROW(page).evaluate((row) => {
    const top = row.getBoundingClientRect().top;
    const at = (selector: string) => {
      const node = row.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top - top), width: Math.round(rect.width) };
    };
    return { name: at('.export-job-name b'), status: at(':scope > .status'), summary: at('.export-snapshot summary'), actions: at('.export-job-actions'), download: !!row.querySelector('a[download]') };
  });
}

test('MP-0294-02/03/04 export rows hold still through every state, offer the file only when ready, and keep recovery beside the job', async ({ page, request }) => {
  const mix = await currentMix(request);
  let state = 'preparing';
  await page.route('**/api/exports/jobs', (route) => route.fulfill({ json: { jobs: [job(mix, state)] } }));
  for (const width of WIDTHS) {
    const seen: Record<string, Awaited<ReturnType<typeof rowGeometry>>> = {};
    for (const next of ['preparing', 'encoding', 'ready', 'failed', 'expired', 'interrupted']) {
      state = next;
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/workshop');
      await expect(ROW(page)).toHaveAttribute('data-state', next);
      await settle(page);
      seen[next] = await rowGeometry(page);
      const row = ROW(page);
      // MP-0294-03: the file is offered only once the job says the file is ready
      expect(seen[next].download, `${width}px ${next}: download link`).toBe(next === 'ready');
      if (next === 'ready') await expect(row.getByRole('link', { name: 'download synthetic-evening-mix.flac' })).toHaveAttribute('href', '/api/exports/synthetic-evening-mix.flac');
      // MP-0294-04: recovery for a failed or vanished file sits in that job's own row
      if (['failed', 'expired', 'interrupted'].includes(next)) {
        const again = row.getByRole('link', { name: 'Open this mix to export it again' });
        await expect(again).toBeVisible();
        await expect(again).toHaveAttribute('href', '/mix/current/edit');
        if (next === 'expired') await expect(row.getByText('can’t be downloaded')).toBeVisible();
        if (next === 'failed') await expect(row.locator('.warn')).toHaveText('The encoder stopped before the file was finished.');
      }
      if (next === 'preparing' || next === 'encoding') await expect(row.getByRole('button', { name: 'Cancel the export of Synthetic evening mix' })).toBeVisible();
    }
    // MP-0294-02: the name, status and actions never move between states
    const base = seen.preparing;
    for (const [name, reading] of Object.entries(seen)) {
      const at = `${width}px ${name}`;
      expect(reading.name, `${at}: name moved`).toEqual(base.name);
      expect(reading.status!.left, `${at}: status moved sideways`).toBe(base.status!.left);
      expect(reading.status!.top, `${at}: status moved down`).toBe(base.status!.top);
      expect(reading.actions!.left, `${at}: actions moved sideways`).toBe(base.actions!.left);
      if (name !== 'failed') expect(Math.abs(reading.summary!.top - base.summary!.top), `${at}: contents summary moved`).toBeLessThanOrEqual(1);
    }
  }
  // the export dialog for the same version: no download link until ready, then exactly one
  for (const next of ['preparing', 'encoding', 'failed', 'ready']) {
    state = next;
    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Download audio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('a[download]')).toHaveCount(next === 'ready' ? 1 : 0);
  }
});

const TRIALS = [{ id: 'trial-1' }, { id: 'trial-2' }];

async function stubStudy(page: Page, extra: Record<string, unknown> = {}) {
  const posted: unknown[] = [];
  const audio = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route(/\/api\/listening\?/, (route) => route.fulfill({ json: TRIALS.map((trial) => ({ ...trial, ...extra })) }));
  await page.route('**/api/listening/*/*/audio', (route) => route.fulfill({ body: audio, contentType: 'audio/flac' }));
  await page.route('**/api/listening/*/response', (route) => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  return posted;
}

async function openStudy(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/listening');
  const study = page.locator('section.study');
  await study.getByLabel('Study code').fill('SYNTH-1');
  await study.getByLabel('Listener nickname').fill('listener-one');
  await study.getByLabel('Listening setup').fill('headphones in a quiet room');
  await study.getByRole('button', { name: 'Open study' }).click();
  await expect(study.locator('.study-version')).toHaveCount(2);
  await settle(page);
  return study;
}

test('MP-0294-05 the A and B arms carry equal weight, in the same order every time', async ({ page }) => {
  await stubStudy(page);
  for (const width of WIDTHS) {
    const study = await openStudy(page, width);
    const arms = await study.evaluate((section) => [...section.querySelectorAll('.study-version')].map((arm) => {
      const rect = arm.getBoundingClientRect();
      const style = getComputedStyle(arm);
      const heading = arm.querySelector('h3')!;
      return {
        heading: heading.textContent, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        border: `${style.borderTopWidth} ${style.borderTopColor} ${style.borderTopLeftRadius}`, background: style.backgroundColor,
        headingStyle: `${getComputedStyle(heading).fontSize} ${getComputedStyle(heading).fontWeight} ${getComputedStyle(heading).color}`,
        controls: arm.querySelectorAll('input, audio').length,
      };
    }));
    const [a, b] = arms;
    const at = `${width}px`;
    expect([a.heading, b.heading]).toEqual(['Version A', 'Version B']);
    expect(Math.abs(a.width - b.width), `${at}: arm widths`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height), `${at}: arm heights`).toBeLessThanOrEqual(1);
    expect(b.border, `${at}: arm frames`).toBe(a.border);
    expect(b.background, `${at}: arm fill`).toBe(a.background);
    expect(b.headingStyle, `${at}: arm headings`).toBe(a.headingStyle);
    expect(b.controls, `${at}: arm controls`).toBe(a.controls);
    // A comes first, reading left to right or top to bottom
    expect(a.top < b.top || (Math.abs(a.top - b.top) <= 1 && a.left < b.left), `${at}: A comes first`).toBe(true);
    const choices = await study.locator('.study-choices button').evaluateAll((buttons) => buttons.map((button) => ({
      text: button.textContent, className: button.className, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
      weight: getComputedStyle(button).fontWeight, background: getComputedStyle(button).backgroundColor,
    })));
    expect(choices.map((choice) => choice.text)).toEqual(['Prefer A', 'Prefer B', 'No preference', 'Cannot judge']);
    const [preferA, preferB] = choices;
    expect(preferB.className, `${at}: preference buttons`).toBe(preferA.className);
    expect(preferA.className, `${at}: neither preference is primary`).not.toContain('primary');
    expect(Math.abs(preferA.width - preferB.width), `${at}: preference widths`).toBeLessThanOrEqual(1);
    expect(new Set(choices.map((choice) => `${choice.weight} ${choice.background} ${Math.round(choice.height)}`)).size, `${at}: choice weights`).toBe(1);
  }
});

test('MP-0294-06 code, nickname, setup, instruction, error and judgement controls line up', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/\/api\/listening\?/, (route) => route.fulfill({ status: 500, json: { detail: 'down' } }));
    await page.goto('/listening');
    const study = page.locator('section.study');
    for (const [label, value] of [['Study code', 'SYNTH-1'], ['Listener nickname', 'listener-one'], ['Listening setup', 'headphones']]) await study.getByLabel(label).fill(value);
    await study.getByRole('button', { name: 'Open study' }).click();
    await expect(study.getByRole('alert')).toHaveText('Could not load this listening study. Check the study code and try again.');
    const reading = await study.evaluate((section) => {
      const fields = [...section.querySelectorAll('.study-setup .field')].map((field) => {
        const label = field.querySelector('label')!.getBoundingClientRect();
        const input = field.querySelector('input')!.getBoundingClientRect();
        const help = field.querySelector('.hint, small, [id$="help"]')?.getBoundingClientRect() ?? null;
        return { label: label.toJSON(), input: input.toJSON(), help: help?.toJSON() ?? null };
      });
      const button = section.querySelector('.study-setup button')!.getBoundingClientRect();
      const alert = section.querySelector('[role="alert"]')!.getBoundingClientRect();
      return { fields, button: button.toJSON(), alert: alert.toJSON(), page: document.documentElement.scrollWidth };
    });
    const at = `${width}px`;
    expect(reading.page, `${at}: sideways scroll`).toBeLessThanOrEqual(width);
    const left = reading.fields[0].label.left;
    for (const field of reading.fields) {
      expect(Math.abs(field.label.left - left), `${at}: label edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(field.input.left - left), `${at}: input edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(field.input.width - reading.fields[0].input.width), `${at}: input widths`).toBeLessThanOrEqual(1);
      if (field.help) {
        expect(field.help.left - left, `${at}: help edge`).toBeLessThanOrEqual(1);
        expect(Math.min(Math.abs(field.help.top - field.label.bottom), Math.abs(field.help.top - field.input.bottom)), `${at}: help sits apart from its field`).toBeLessThanOrEqual(12);
      }
    }
    expect(Math.abs(reading.button.left - left), `${at}: Open study edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(reading.alert.left - left), `${at}: error edge`).toBeLessThanOrEqual(1);
    expect(reading.alert.top, `${at}: error comes after the button`).toBeGreaterThanOrEqual(reading.button.bottom);
    expect(reading.alert.top - reading.button.bottom, `${at}: error is far from the button`).toBeLessThanOrEqual(32);
    await page.unroute(/\/api\/listening\?/);
  }
  // judgement controls: one height, one top line where they fit, quality chips on a shared edge
  await stubStudy(page);
  for (const width of WIDTHS) {
    const study = await openStudy(page, width);
    const judged = await study.evaluate((section) => {
      const buttons = [...section.querySelectorAll('.study-choices button')].map((button) => button.getBoundingClientRect().toJSON());
      const arms = [...section.querySelectorAll('.study-version')].map((arm) => {
        const frame = arm.getBoundingClientRect().left;
        return [...arm.querySelectorAll('h3, audio, fieldset')].map((node) => Math.round(node.getBoundingClientRect().left - frame));
      });
      return { buttons, arms };
    });
    const at = `${width}px`;
    expect(new Set(judged.buttons.map((button) => Math.round(button.height))).size, `${at}: choice heights`).toBe(1);
    if (width >= 768) expect(new Set(judged.buttons.map((button) => Math.round(button.top))).size, `${at}: choices on one line`).toBe(1);
    for (const offsets of judged.arms) expect(new Set(offsets).size, `${at}: arm contents share an edge`).toBe(1);
    expect(judged.arms[1], `${at}: both arms indent alike`).toEqual(judged.arms[0]);
  }
});

test('MP-0294-07 the study page shows no private path and nothing that unblinds a version', async ({ page }) => {
  // a server that over-shares must still not leak through the page
  await stubStudy(page, { arm_a: 'crossfade-baseline', arm_b: 'stem-bridge-candidate', source_path: 'C:\\Users\\private-person\\Music\\secret.flac' });
  const study = await openStudy(page, 1440);
  const exposed = await study.evaluate((section) => {
    const attributes = [...section.querySelectorAll('*')].flatMap((node) => [...node.attributes].map((attribute) => attribute.value));
    return `${section.textContent}\n${attributes.join('\n')}`;
  });
  for (const secret of ['crossfade', 'baseline', 'candidate', 'stem-bridge', 'private-person', 'C:\\Users', 'secret.flac']) {
    expect(exposed, `exposes ${secret}`).not.toContain(secret);
  }
  const sources = await study.locator('audio').evaluateAll((players) => players.map((player) => player.getAttribute('src')));
  expect(sources).toEqual(['/api/listening/trial-1/a/audio', '/api/listening/trial-1/b/audio']);
  await expect(study.locator('audio').first()).toHaveAttribute('aria-label', 'Version A');
});

test('MP-0294-08 (automated part) a participant hears both versions and completes the trials without a nudge', async ({ page }) => {
  const posted = await stubStudy(page);
  const study = await openStudy(page, 1440);
  await expect(study.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
  await expect(study.getByRole('button', { name: 'Cannot judge' })).toBeEnabled();
  for (const option of ['a', 'b']) {
    await study.locator('audio').nth(option === 'a' ? 0 : 1).evaluate(async (player: HTMLAudioElement) => {
      player.muted = true;
      await player.play();
      await new Promise<void>((done) => { const tick = () => (player.currentTime >= 0.6 ? done() : setTimeout(tick, 50)); tick(); });
      player.pause();
    });
  }
  await study.getByRole('radio', { name: '4' }).first().check();
  await expect(study.getByRole('button', { name: 'Prefer A' })).toBeEnabled();
  await study.getByRole('button', { name: 'No preference' }).click();
  await expect(study.getByText('Comparison 2 of 2')).toBeVisible();
  await study.getByRole('button', { name: 'Cannot judge' }).click();
  await expect(study.getByRole('status').filter({ hasText: 'All responses saved' })).toBeVisible();
  expect(posted).toEqual([
    expect.objectContaining({ choice: 'tie', listener: 'listener-one', quality: { a: { grade: 4, tags: [] } } }),
    expect.objectContaining({ choice: 'cannot_judge', listener: 'listener-one' }),
  ]);
});
