import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { rewriteJson, stickingOut } from '../e2e/helpers';
import { layoutProblems } from '../e2e/layout';
import { FLAG_IDS, REGISTRY, type FlagId } from '../src/flags';
import { listener, signedIn } from './cloud';

// The Cloud reflow and teaser sweeps (SC-0414-05, SC-0414-10, SC-0406-03): the local sweep's
// contract (web/e2e/flags.e2e.ts) held on the Cloud site, where flags are decided per account.
//
// Each test switches features off for its own test person with a real per-user targeting rule
// (POST /test/flags/off, the rule "Off for these users" writes), so the decision runs through
// every layer (build, mode, plan, rules) as in production and nobody else's pages change. Every
// page the feature shows up on (its `cloud.*` surfaces in the registry) is then opened at phone
// and desktop widths, for a Free and a Premium account, and must close up: nothing sticking out
// sideways, no empty container or heading, no word the registry gives the feature, no menu entry
// for a page that's gone, and no request to a route the feature owns (nor any refusal).
//
// A feature locked by the plan with `when_locked: teaser` is the one exception: it may show as a
// locked teaser naming the plan, and the teaser pass checks it does. A feature a rule switched
// off is always hidden, never teased.

// BF-0456-05: 320 px and both themes. Every page is checked at the narrowest phone width SelectaDJ
// supports and in both colour schemes (tokens.css follows prefers-color-scheme). The one-flag
// tests run two views, 320 px light and desktop dark, so each scheme and both ends of the width
// range are met by every flag; the all-off, cloud-defaults and Browser-first sweeps run all six.
type Scheme = 'light' | 'dark';
type View = { width: number; height: number; scheme: Scheme };
const VIEWS: View[] = [{ width: 320, height: 720, scheme: 'light' }, { width: 1280, height: 900, scheme: 'dark' }];
const FULL_VIEWS: View[] = (['light', 'dark'] as const).flatMap((scheme) => [[320, 720], [375, 812], [1280, 900]].map(([width, height]) => ({ width, height, scheme })));
type Plan = 'free' | 'premium';
const PLANS: Plan[] = ['free', 'premium'];

/** Every page of the Cloud site, by its registry surface name, and the title it shows. */
const SURFACES: Record<string, { at: string; title: string }> = {
  'cloud.home': { at: '/', title: 'Your music workspace' },
  'cloud.listen': { at: '/listen', title: 'Listen' },
  'cloud.library': { at: '/library', title: 'Your library' },
  'cloud.uploads': { at: '/upload', title: 'Add music' },
  'cloud.billing': { at: '/account/billing', title: 'Plan & billing' },
  'cloud.settings': { at: '/account', title: 'Account settings' },
};
const EVERYWHERE = Object.keys(SURFACES);

/** Menu entries that are whole pages, and the flag each needs (web/src/cloud/api.ts PAGE_FLAGS). */
const MENU: Record<string, FlagId> = { Library: 'cloud.stored_media', 'Add music': 'cloud.uploads' };

/** Parts of a page that belong to one feature: with it off (and not teased), they're gone. Words
 * can't say this for every feature, since the local site uses some of the same words. */
const PARTS: Record<string, FlagId> = {
  '.lucy-settings': 'account.lucy_settings',
  '.devices-panel': 'devices',
  '.playing-bar': 'devices',
  '.room-panel': 'rooms',
  '.cloud-hero': 'cloud.uploads',
};

/** Legacy cloud-only features with no page of their own. New exclusions belong in the JSON
 * registry as cloud_surface_kind + cloud_surface_reason, reviewed by Python registry tests.
 * Otherwise a non-core targetable cloud flag must name a sweepable `cloud.*` page. */
const NO_SURFACE: Partial<Record<FlagId, string>> = {
  'account.labs': 'The Labs settings page is not built yet (SC-0414-09); only the API exists.',
  'cloud.signups': 'Decided before anyone is signed in: onboarding answers flag_off.',
  'cloud.error_reporting': 'Sentry error transport is server-side observability, with no customer-facing page.',
  'cloud.email': 'Maintenance sends notification emails in the background; it has no customer-facing control.',
  'autopilot.venue_mode': 'Autopilot session APIs exist but the Cloud venue dashboard has not been released.',
  'autopilot.venue_policy': 'Venue policy APIs are server-only until the venue console ships.',
  'autopilot.horizon': 'The rolling horizon planner runs on the server, not on a Cloud page.',
  'autopilot.safe_transitions': 'The transition safety gate is evaluated by the server, not on a Cloud page.',
  'autopilot.ai_director': 'AI director decisions run in the server planner; its control UI is not yet released.',
  'business.signups': 'Business self-serve sign-up is disabled pending legal review; no Cloud sign-up page.',
  'business.orgs': 'Business organisation, venue and crate APIs are not yet wired to a customer-facing page.',
  'business.schedules': 'Venue scheduling APIs are server-only until the venue console is built.',
  'business.offline': 'Offline venue playback is managed by kiosk/server commands, not a Cloud page.',
  'business.workspaces': 'Business workspace switching currently has an API but no visible menu in Cloud.',
  'business.pilots': 'Staff-only pilot provisioning is an admin API, not a customer-facing Cloud page.',
  'cloud.tracing': 'Server-side OpenTelemetry job spans, with no person-facing Cloud page.',
  'cloud.metrics': 'Server-side service telemetry consumed by SLOs and alerts, with no person-facing Cloud page.',
  'cloud.export_expiry': 'Server-side maintenance sweep for retained exports, with no person-facing Cloud page.',
  'cloud.autoscale': 'Server-side maintenance task that sizes worker pools, with no person-facing Cloud page.',
  'cloud.dmca_renewal_reminder': 'Server-side maintenance alert for the owner, with no person-facing Cloud page.',
  'lucy.deep_plan': 'No control on the site: the server decides it for each Lucy turn.',
};

type Spec = (typeof REGISTRY)[FlagId] & { modes?: string[]; when_locked?: string; default?: boolean; owner?: string };
const spec = (id: FlagId) => REGISTRY[id] as Spec;
const cloudSurfaces = (id: FlagId) => (spec(id).surfaces ?? []).filter((surface) => surface.startsWith('cloud.'));
const untargetable = (id: FlagId) => id === 'admin' || id.startsWith('admin.') || id === 'staff' || id.startsWith('staff.');
/** Features the sweep turns off one at a time: everything non-core with a Cloud page to check. */
const SWEPT = FLAG_IDS.filter((id) => !spec(id).core && !untargetable(id) && cloudSurfaces(id).length);

type Account = { user: { id: string }; workspace: { id: string }; features: Record<string, boolean>; feature_locks: Record<string, string> };

async function accountOf(request: APIRequestContext, user: string): Promise<Account> {
  const answer = await request.get('/api/account', { headers: { Authorization: `Bearer e2e:${user}` } });
  expect(answer.ok(), await answer.text()).toBeTruthy();
  return answer.json();
}

async function switchOff(request: APIRequestContext, user: string, flags: FlagId[]) {
  const answer = await request.post('/test/flags/off', { data: { user, flags } });
  expect(answer.ok(), await answer.text()).toBeTruthy();
  expect((await answer.json()).error).toBeUndefined();
}

/** A new person on `plan`, signed in on `page`; a Premium one also has a room open, so the room
 * panel's own parts (votes, big screen, the paused-music note) are on the page to check. */
async function person(page: Page, request: APIRequestContext, plan: Plan, path = '/', seed: Record<string, unknown> = {}) {
  const user = listener(`sweep-${plan}`);
  const seeded = await request.post('/test/seed', { data: { ...seed, user, plan } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  if (plan === 'premium') {
    const opened = await request.post('/api/rooms', {
      headers: { Authorization: `Bearer e2e:${user}`, Origin: String(test.info().project.use.baseURL) },
      data: { name: 'Sweep room', settings: { votes: true } },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  }
  await signedIn(page, request, user, { path });
  return user;
}

type Seen = { requests: { method: string; path: string }[]; refused: string[] };

function watch(page: Page): Seen {
  const seen: Seen = { requests: [], refused: [] };
  page.on('request', (asked) => {
    const url = new URL(asked.url());
    if (url.pathname.startsWith('/api/')) seen.requests.push({ method: asked.method(), path: url.pathname });
  });
  page.on('response', (answer) => {
    const url = new URL(answer.url());
    if (url.pathname.startsWith('/api/') && answer.status() === 403) seen.refused.push(`${answer.request().method()} ${url.pathname}`);
  });
  return seen;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asPattern = (route: string) => {
  const [method, template] = route.split(' ');
  return { method, path: new RegExp(`^${template.split(/\{[^}]+\}/).map(escapeRegExp).join('[^/]+')}$`) };
};

const off = (account: Account, id: FlagId) => account.features[id] === false;
const teased = (account: Account, id: FlagId) => Boolean(account.feature_locks[id]);

/** Everything wrong with the page as it is now, for this account's decisions. */
async function problems(page: Page, where: string, account: Account): Promise<string[]> {
  const found = [...(await stickingOut(page, where)), ...(await layoutProblems(page, where))];
  const text = await page.locator('body').innerText();
  for (const id of FLAG_IDS) {
    if (!off(account, id) || teased(account, id)) continue;
    for (const words of spec(id).words ?? []) {
      if (text.includes(words)) found.push(`${where}: says “${words}”, but ${id} is off`);
    }
  }
  for (const [selector, id] of Object.entries(PARTS)) {
    if (off(account, id) && !teased(account, id) && (await page.locator(selector).count())) found.push(`${where}: shows ${selector}, but ${id} is off`);
  }
  const menu = await page.getByRole('navigation', { name: 'Cloud workspace' }).getByRole('button').allInnerTexts();
  for (const [label, id] of Object.entries(MENU)) {
    if (off(account, id) && menu.includes(label)) found.push(`${where}: the menu has ${label}, but ${id} is off`);
  }
  return found;
}

async function open(page: Page, surface: string) {
  const { at } = SURFACES[surface];
  await page.goto(at);
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
  await expect(page.locator('main h1')).not.toBeEmpty();
  // Panels load their own data (the room, devices, Lucy's settings): let them settle.
  await page.waitForTimeout(600);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** The page's own background token, so a sweep can prove the colour scheme really changed. */
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());

type SweepOptions = { plans?: Plan[]; views?: View[]; seed?: Record<string, unknown>; extra?: (page: Page, where: string) => Promise<string[]> };

/** Switch `flags` off for a new person on each plan and check every page in `surfaces`, in each
 * view (width and colour scheme). `seed` adds to the person's seed; `extra` adds a caller's own
 * checks on every page. */
async function sweep(page: Page, request: APIRequestContext, flags: FlagId[], surfaces: string[], { plans = PLANS, views = VIEWS, seed, extra }: SweepOptions = {}) {
  const found: string[] = [];
  for (const plan of plans) {
    const user = await person(page, request, plan, '/', seed);
    // No rule to write for a sweep of the build's own decisions (and nothing to clear after).
    if (flags.length) await switchOff(request, user, flags);
    const account = await accountOf(request, user);
    for (const id of flags) {
      if (!off(account, id)) found.push(`${plan}: ${id} is still on after a rule switched it off`);
      if (teased(account, id)) found.push(`${plan}: ${id} is switched off by a rule but still teased`);
    }
    const seen = watch(page);
    const schemes = new Map<Scheme, string>();
    for (const { width, height, scheme } of views) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height });
      for (const surface of surfaces) {
        await open(page, surface);
        const where = `${flags.join(' ') || 'cloud defaults'} · ${plan} · ${surface} at ${width}px ${scheme}`;
        if (!schemes.has(scheme)) schemes.set(scheme, await background(page));
        found.push(...(await problems(page, where, account)));
        if (extra) found.push(...(await extra(page, where)));
      }
    }
    // Both schemes asked for must really have rendered differently, or the theme pass is a no-op.
    if (schemes.size > 1 && new Set(schemes.values()).size < schemes.size) found.push(`${plan}: light and dark rendered the same background (${[...schemes.values()].join(', ')})`);
    await page.emulateMedia({ colorScheme: 'light' });
    const routes = FLAG_IDS.filter((id) => off(account, id)).flatMap((id) => (spec(id).routes ?? []).map((route) => ({ id, ...asPattern(route) })));
    for (const asked of seen.requests) {
      const gone = routes.find((route) => route.method === asked.method && route.path.test(asked.path));
      if (gone) found.push(`${plan}: asked the server ${asked.method} ${asked.path}, but ${gone.id} is off`);
    }
    found.push(...seen.refused.map((refusal) => `${plan}: the server refused ${refusal}`));
    page.removeAllListeners('request');
    page.removeAllListeners('response');
    if (flags.length) await switchOff(request, user, []);
  }
  return [...new Set(found)];
}

test('every cloud feature a person can see is in the sweep, or says why not', () => {
  const missing: string[] = [];
  for (const id of FLAG_IDS) {
    const flag = spec(id);
    const cloudOnly = (flag.modes ?? []).length === 1 && flag.modes?.[0] === 'cloud';
    if (!cloudOnly || flag.core || untargetable(id)) continue;
    const excluded = Boolean(flag.cloud_surface_kind && flag.cloud_surface_reason);
    if (!cloudSurfaces(id).length && !NO_SURFACE[id] && !excluded) missing.push(`${id} names no cloud surface`);
    if (cloudSurfaces(id).length && (NO_SURFACE[id] || excluded)) missing.push(`${id} has surfaces and a nonvisual exclusion`);
  }
  for (const id of FLAG_IDS) {
    for (const surface of cloudSurfaces(id)) if (!SURFACES[surface]) missing.push(`${id}: the sweep doesn't open ${surface}`);
  }
  expect(missing).toEqual([]);
  expect(SWEPT.length).toBeGreaterThan(8);
});


/** A declared exclusion is not a pretend UI page. New venue pages must replace their exclusion
 * with a real cloud.* surface and be picked up by the disabled-feature Playwright sweep. */
test('each venue flag names its real nonvisual Cloud ownership, without fabricating a page', () => {
  const expected: Record<string, string> = {
  'venue.continuity': 'headless',
  'venue.fault_injection': 'rehearsal',
  'venue.speakers': 'unreleased',
  'venue.staff_dashboard': 'unreleased',
  'venue.moderated_requests': 'headless',
  'venue.learning': 'headless',
  'venue.rights_gate': 'headless',
  'venue.roles': 'headless',
  'venue.safe_gain': 'headless',
  'venue.health': 'operations',
  'venue.soak': 'rehearsal',
  'venue.rollout_gates': 'operations',
  };
  const venueIds = FLAG_IDS.filter((id) => id.startsWith('venue.'));
  expect([...venueIds].sort()).toEqual(Object.keys(expected).sort());
  for (const id of venueIds) {
    const flag = spec(id);
    expect(flag.modes, id).toEqual(['cloud']);
    expect(flag.default, id).toBe(false);
    expect(flag.owner, id).toBe('autopilot');
    expect(cloudSurfaces(id), id).toEqual([]);
    expect(flag.cloud_surface_kind, id).toBe(expected[id]);
    expect(flag.cloud_surface_reason?.length ?? 0, id).toBeGreaterThan(20);
    expect(NO_SURFACE[id], id).toBeUndefined();
  }
});

test('with the cloud defaults, lyric display is off and every page closes up around it', async ({ page, request }) => {
  test.setTimeout(600_000); // all six views
  // SC-0406-03: `lyrics.display` has `cloud_default: false`, so it and everything that shows
  // lyric text are off for every plan, with no rule at all; lookups stay on for internal use.
  const lyrics: FlagId[] = ['lyrics.display', 'listen.lyrics', 'listen.word_focus', 'listen.stage', 'discover.word_links'];
  for (const plan of PLANS) {
    const user = listener(`defaults-${plan}`);
    await request.post('/test/seed', { data: { user, plan } });
    const account = await accountOf(request, user);
    expect(lyrics.filter((id) => !off(account, id)), `${plan}: lyric features on in the cloud`).toEqual([]);
    expect(lyrics.filter((id) => teased(account, id))).toEqual([]);
    expect(account.features['lyrics.lookup']).toBe(true);
  }
  expect(await sweep(page, request, [], EVERYWHERE, { views: FULL_VIEWS })).toEqual([]);
});

test('with every swept cloud feature off for one account, every page still holds together', async ({ page, request }) => {
  test.setTimeout(600_000); // all six views
  expect(await sweep(page, request, SWEPT, EVERYWHERE, { views: FULL_VIEWS })).toEqual([]);
});

for (const id of SWEPT) {
  test(`with ${id} off for one account, the cloud pages it was on still hold together`, async ({ page, request }) => {
    expect(await sweep(page, request, [id], cloudSurfaces(id))).toEqual([]);
  });
}

test('a Free account sees each plan-locked feature as a teaser naming its plan, and asks nothing about it', async ({ page, request }) => {
  const seen = watch(page);
  const user = await person(page, request, 'free', '/listen');
  const account = await accountOf(request, user);
  const teasers = FLAG_IDS.filter((id) => spec(id).when_locked === 'teaser' && cloudSurfaces(id).length);
  expect(teasers).toContain('rooms');
  for (const id of teasers) {
    expect(off(account, id), `${id} is on for Free`).toBe(true);
    expect(account.feature_locks[id], `${id} isn't teased for Free`).toBe('premium');
  }
  // Listen: the room panel is a locked teaser, with the plan, and nothing about votes or screens.
  const teaser = page.locator('.room-locked');
  await expect(teaser.getByRole('heading', { name: 'Rooms Premium' })).toBeVisible();
  await expect(teaser).toContainText('Rooms are part of Premium.');
  // Overview: the rooms card names the plan and leads to it.
  await page.getByRole('navigation', { name: 'Cloud workspace' }).getByRole('button', { name: 'Overview' }).click();
  await expect(page.getByText('PREMIUM FEATURE')).toBeVisible();
  await page.getByRole('button', { name: 'Explore Premium' }).click();
  await expect(page.locator('main h1')).toHaveText('Plan & billing');
  await expect(page.getByRole('region', { name: 'Premium' })).toContainText('guest request rooms');
  const rooms = teasers.flatMap((id) => (spec(id).routes ?? []).map(asPattern));
  expect(seen.requests.filter((asked) => rooms.some((route) => route.method === asked.method && route.path.test(asked.path)))).toEqual([]);
  expect(seen.refused).toEqual([]);

  // Switched off by a rule, the same feature is hidden, never teased, even though Premium has it.
  await switchOff(request, user, ['rooms']);
  const ruled = await accountOf(request, user);
  expect(ruled.feature_locks.rooms).toBeUndefined();
  for (const surface of ['cloud.listen', 'cloud.home', 'cloud.billing']) {
    await open(page, surface);
    expect(await problems(page, `rooms ruled off · ${surface}`, ruled)).toEqual([]);
    await expect(page.locator('.room-locked')).toHaveCount(0);
    await expect(page.getByText('PREMIUM FEATURE')).toHaveCount(0);
  }
  await switchOff(request, user, []);
});

test('a feature switched off while its page is open closes up at once, without a reload', async ({ page, request }) => {
  // Decisions reach an open page over the event stream (`flags.changed`), not only on the next load.
  const user = await person(page, request, 'premium', '/listen');
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  const panel = page.locator('.room-panel');
  await expect(panel.getByRole('heading', { name: 'Big screen' })).toBeVisible();
  await expect(panel.getByLabel('Guests can vote')).toBeVisible();

  await switchOff(request, user, ['rooms.display']);
  await expect(panel.getByRole('heading', { name: 'Big screen' })).toHaveCount(0, { timeout: 10_000 });
  await expect(panel.getByLabel('Guests can vote')).toBeVisible();

  await switchOff(request, user, ['rooms']);
  await expect(panel).toHaveCount(0, { timeout: 10_000 });
  const menu = page.getByRole('navigation', { name: 'Cloud workspace' });
  await expect(menu.getByRole('button', { name: 'Add music' })).toBeVisible();
  await switchOff(request, user, ['cloud.uploads']);
  await expect(menu.getByRole('button', { name: 'Add music' })).toHaveCount(0, { timeout: 10_000 });
  // The Library reads stored media (cloud.stored_media, ADR-0456), so it stays.
  await expect(menu.getByRole('button', { name: 'Library' })).toBeVisible();

  // Back on: everything comes back the same way.
  await switchOff(request, user, []);
  await expect(menu.getByRole('button', { name: 'Add music' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.room-panel').getByRole('heading', { name: 'Big screen' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
});

test('hosted media is an account grant: revoking it hides uploads but keeps stored-library access', async ({ page, request }) => {
  const user = await person(page, request, 'premium', '/library');
  const menu = page.getByRole('navigation', { name: 'Cloud workspace' });
  await expect(menu.getByRole('button', { name: 'Add music' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Library' })).toBeVisible();

  // cloud.uploads requires this umbrella grant. The live flag event must remove every upload
  // entry without reloading, while cloud.stored_media remains independently reachable so an
  // existing customer's library never goes dark (ADR-0456).
  await switchOff(request, user, ['cloud.hosted_media']);
  await expect(menu.getByRole('button', { name: 'Add music' })).toHaveCount(0, { timeout: 10_000 });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your library', exact: true })).toBeVisible();
  await expect(page.getByText(/upload tracks|add music/i)).toHaveCount(0);

  await switchOff(request, user, []);
  await expect(menu.getByRole('button', { name: 'Add music' })).toBeVisible({ timeout: 10_000 });
});

// -- Browser-first Cloud (BF-0463-05, BF-0456-05) ----------------------------------------------
//
// Every Browser-first flag declares its `surfaces` in the registry, and the sweep proves, in all
// six views (320, 375 and 1280 px, light and dark), that with the flag off nothing of it is left
// on any page it names: none of its marks below, no request to a route it owns, and the page
// still closes up. The person is seeded with a stored song and catalogue songs on a device, so a
// mark that leaked would have something to show.
//
// Honest scope: a flag on for a new account on this server (`cloud.hosted_media` and
// `cloud.stored_media` ship on; this test build also turns `cloud.local_media` on) is switched
// off by a real per-user rule. The others ship off and a rule can never grant past the build
// (ADR-0414), so off is every account's state and the sweep checks that state as is. Where a
// flag has a visible on-state (the local-first shell, its catalogue, the upload entry), the
// "marks are real" test first shows each mark with the flag on, so an absent mark means
// something. `devices.browser_player`, `cloud.browser_dsp`, `cloud.venue_tablet` and
// `cloud.local_export` have no Cloud UI of their own yet; their marks are their own names and the
// player refusal, and the sweep proves only that none appears.

type Mark = { text?: RegExp; role?: { role: 'navigation' | 'heading' | 'button' | 'link'; name: string } };

/** Each BF flag: the `cloud.*` pages it must name in the registry, and its marks on them. */
const BF: Record<string, { surfaces: string[]; marks: Mark[]; ships: boolean }> = {
  'cloud.hosted_media': { surfaces: ['cloud.uploads'], ships: true, marks: [{ role: { role: 'button', name: 'Add music' } }, { text: /upload tracks/i }] },
  'cloud.stored_media': { surfaces: ['cloud.library', 'cloud.listen'], ships: true, marks: [{ role: { role: 'button', name: 'Library' } }] },
  'cloud.local_first': { surfaces: ['cloud.home', 'cloud.listen', 'cloud.library', 'cloud.settings'], ships: false, marks: [{ role: { role: 'navigation', name: 'Main' } }, { role: { role: 'link', name: 'Make a Mix' } }] },
  'cloud.local_media': { surfaces: ['cloud.library'], ships: false, marks: [{ role: { role: 'heading', name: 'Connect music' } }, { text: /Local song \d/ }] },
  'devices.browser_player': { surfaces: ['cloud.listen'], ships: false, marks: [{ text: /Browser player/ }, { text: /This device can.t play mixes/ }] },
  'cloud.browser_dsp': { surfaces: ['cloud.listen'], ships: false, marks: [{ text: /Browser DSP/ }] },
  'cloud.venue_tablet': { surfaces: ['cloud.listen', 'cloud.settings'], ships: false, marks: [{ text: /Venue tablet/ }] },
  'cloud.local_export': { surfaces: ['cloud.listen'], ships: false, marks: [{ text: /Local export/ }] },
};
const BF_IDS = Object.keys(BF) as FlagId[];
const BF_SEED = { songs: 1, local_songs: 2 };

async function marksShown(page: Page, marks: Mark[]): Promise<string[]> {
  const shown: string[] = [];
  for (const mark of marks) {
    const found = mark.role ? page.getByRole(mark.role.role, { name: mark.role.name, exact: true }) : page.getByText(mark.text!);
    if (await found.count()) shown.push(mark.role ? `${mark.role.role} "${mark.role.name}"` : String(mark.text));
  }
  return shown;
}

test('every Browser-first flag declares its Cloud surfaces, and the sweep covers each of them', () => {
  for (const id of BF_IDS) {
    expect(FLAG_IDS, id).toContain(id);
    expect([...cloudSurfaces(id)].sort(), `${id} surfaces`).toEqual([...BF[id].surfaces].sort());
    for (const surface of BF[id].surfaces) expect(SURFACES[surface], `${id}: ${surface}`).toBeTruthy();
    // The registry default: only hosted and stored media ship on; the rest ship dark.
    expect(spec(id).default !== false, `${id} default`).toBe(BF[id].ships);
  }
});

test('each Browser-first mark is real: shown with its flag on', async ({ page, request }) => {
  // The account answer is amended in the browser for the flags a rule cannot grant (as
  // local-first-shell.cloud.ts does); hosted and stored media are on for everyone already.
  const user = listener('bf-marks');
  const seeded = await request.post('/test/seed', { data: { user, plan: 'premium', ...BF_SEED } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/library');
  const menu = page.getByRole('navigation', { name: 'Cloud workspace' });
  await expect(menu.getByRole('button', { name: 'Add music' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload tracks' })).toBeVisible();

  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: true },
    features: { ...account.features, 'cloud.local_first': true, 'cloud.local_media': true },
  })));
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Make a Mix', exact: true }).first()).toBeVisible();
  // This test build turns the catalogue on (tests/e2e_cloud_server.py), so its marks show.
  await expect(page.getByRole('heading', { name: 'Connect music' })).toBeVisible();
  await expect(page.getByText('Local song 1')).toBeVisible();
});

for (const id of BF_IDS) {
  test(`with ${id} off, its Cloud pages hold together at 320 px and in both themes, with no trace of it`, async ({ page, request }) => {
    test.setTimeout(480_000); // all six views
    const extra = async (current: Page, where: string) => (await marksShown(current, BF[id].marks)).map((mark) => `${where}: shows ${mark}, but ${id} is off`);
    // On for a new account here: a real per-user rule switches it off. Off already (the build
    // ships it dark): no rule, the sweep checks the state every account is in.
    const fresh = listener('bf-check');
    expect((await request.post('/test/seed', { data: { user: fresh } })).ok()).toBeTruthy();
    const account = await accountOf(request, fresh);
    const flags = account.features[id] === false ? [] : [id];
    expect(teased(account, id), `${id} is teased`).toBe(false);
    expect(await sweep(page, request, flags, BF[id].surfaces, { views: FULL_VIEWS, seed: BF_SEED, extra })).toEqual([]);
  });
}
