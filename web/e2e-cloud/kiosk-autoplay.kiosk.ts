import { expect, test } from '@playwright/test';
import { ALICE, audible, makeOrg, pairedKiosk } from './kioskHelpers';

// BZ-0445-04: a browser that allows no sound before a tap. The kiosk detects it without sound,
// asks for one tap, tells the manager through its health report, and one tap lasts for the life
// of the page. Headless Chromium lets Web Audio run whatever `--autoplay-policy` says (checked
// 2026-11-19), so the rule is applied in the page itself: until the page has had a user
// tap, an AudioContext stays suspended and media `play()` is refused with
// NotAllowedError, exactly as a blocking browser answers.
test.use({ launchOptions: { args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // a real tap on this page (Chromium marks a test-driven navigation as user activation, so
    // `navigator.userActivation` cannot be used here)
    let tapped = false;
    for (const name of ['pointerdown', 'keydown']) window.addEventListener(name, (event) => { if (event.isTrusted) tapped = true; }, true);
    const active = () => tapped;
    const Real = window.AudioContext;
    const state = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state')!;
    Object.defineProperty(BaseAudioContext.prototype, 'state', {
      get() { return active() ? state.get!.call(this) : 'suspended'; },
    });
    const resume = Real.prototype.resume;
    Real.prototype.resume = function (this: AudioContext) { return active() ? resume.call(this) : new Promise<void>(() => undefined); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      return active() ? play.call(this) : Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    };
  });
});

test.describe('autoplay blocked (BZ-0445-04)', () => {
  test('test_autoplay_blocked_shows_tap_to_start', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await pairedKiosk(page, baseURL!, org);
    const tap = page.getByRole('button', { name: 'Tap to start the music' });
    await expect(tap).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('data-audible', 'no');
    // the manager sees that this player needs a tap (from its health report)
    await expect.poll(async () => {
      const listed = await page.request.get('/api/business/kiosks', { headers: { Authorization: ALICE, 'X-Workspace-ID': org.org } });
      return (await listed.json()).kiosks[0]?.autoplay_allowed;
    }, { timeout: 30_000 }).toBe(false);
    await tap.click();
    await audible(page);
    await expect(page.locator('[data-screen="playing"]')).toBeVisible();
  });
});

