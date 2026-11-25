import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** GP-0257-01, motion half (the foreground-message half is in gp-0257-comfort.test.tsx): every
 * animation in the app, counted by how much it asks of the listener. Only waiting indicators may loop,
 * and the system and Still settings stop all of them. A new animation fails here until it is placed.
 * ADR-0477 adds the feel's keyframes (each answers you or arrives, once) and a fourth kind, chrome that
 * follows the music, which is never a CSS keyframe: the beat bus (feel/beatBus.ts) plays it. Leaving
 * is filed as answering you, as the exit protocol always was. */

type Severity = 'answers-you' | 'arrives' | 'waiting' | 'follows-music';
/** What each kind may do. `follows-music` is the beat bus's MUSIC_MOTIONS, never a keyframe here. */
const KINDS: Record<Severity, string> = {
  'answers-you': 'answers a press, a choice or a navigation the listener made, once; leaving is one of these',
  arrives: 'something new comes into place once, when it is first drawn or when real news arrives',
  waiting: 'says work is still going; the only kind that may loop, and every loop stops under Still and reduced motion',
  'follows-music': 'moves only in response to a measured kick, onset or analysed grid beat; never loops in CSS; stops when paused, hidden, Still, reduced motion or low power',
};
const INVENTORY: Record<string, Severity> = {
  'button-working': 'waiting',
  'k-slide': 'waiting', // kiosk waiting for saved music; disabled under reduced motion
  'overlay-appear': 'answers-you',
  'route-reveal': 'arrives',
  'skeleton-reveal': 'arrives',
  'feeling-reveal': 'arrives',
  'toast-appear': 'arrives',
  'skeleton-breathe': 'waiting',
  'pending-flow': 'waiting',
  'request-pulse': 'waiting',
  'lucy-slide': 'waiting',
  // the exit protocol and pop-in (polish.css): each answers an open or close the listener asked for
  'drawer-appear': 'answers-you',
  'pop-appear': 'answers-you',
  'fade-exit': 'answers-you',
  'dialog-exit': 'answers-you',
  'drawer-exit': 'answers-you',
  'toast-exit': 'answers-you',
  // the Room display (display.css): new songs settle in; an always-on screen drifts very slowly
  // while it waits for the next song, so a still picture never burns into the TV
  'd-arrive': 'arrives',
  'd-drift': 'waiting',
  // the guest page (guest.css)
  'g-settle': 'arrives',
  'g-draw': 'answers-you', // the tick drawn when a song is chosen or sent
  'g-pop': 'answers-you', // a vote pressed
  'g-flash': 'arrives', // a request whose state just changed
  'g-breathe': 'waiting', // a request waiting for the host, loading outlines
  'g-working': 'waiting', // a busy button
  'g-turn': 'waiting', // the ring on a waiting line or a busy button
  'g-bump': 'answers-you', // the count beside a request, when a press changed it
  'g-no-a': 'answers-you', // a row that says no to a press (twice named, so a second no replays)
  'g-no-b': 'answers-you',
  // the Room display (display.css), continued
  'd-turn': 'waiting', // the ring while the display connects
  // the host's request list (rooms.css)
  'ask-in': 'arrives', // a guest's request arriving in the list
  // Cloud pages (cloud-ui.css)
  'cloud-spin': 'waiting', // the ring before a busy button's words
  'cloud-arrive': 'arrives', // a page, or a card in a grid, coming into place
  'meter-fill': 'arrives', // a meter filling to its value when it is first drawn
  // the welcome page and the gates (boot.css)
  'rise-in': 'arrives', // the headline, the lead and the cards coming up as the page opens
  // The blend drawing on the welcome and not-found pages loops, slowly, for as long as the page
  // waits to be acted on: decoration that shows what a blend is, never a thing to wait for. As
  // with the Room display's drift, a loop that nobody started is filed as waiting.
  'blend-head': 'waiting',
  'blend-skip': 'waiting',
  'blend-ring': 'waiting',
  'blend-kick': 'waiting',
  'blend-tag': 'waiting',
  // ADR-0477, the feel. Shared asks (styles/feel.css)
  'feel-arrive': 'arrives', // data-arrive and data-stagger: rises a little and fades in once
  'feel-pop': 'answers-you', // .feel-pop: something a press, a count or a badge just brought
  'feel-draw': 'answers-you', // .feel-tick: a tick drawn after work that really finished
  'feel-flash': 'arrives', // .feel-flash: a new or changed row glows once
  'feel-collapse': 'answers-you', // .feel-collapse-out: a removed row folds away (leaving)
  // the small engines (styles/feel-parts.css)
  'feel-tick-draw': 'answers-you', // the tick on an Action whose work resolved
  'feel-moment-ray': 'arrives', // the celebration at a rare moment
  // pages (styles/feel-scene.css)
  'feel-scene-leave': 'answers-you', // the page being left
  'feel-scene-enter': 'answers-you', // the page arriving from the side it was asked from
  'feel-scene-travel': 'answers-you', // a shared thing gliding between its two places
  // shared components (styles/feel-components.css)
  'feel-panel-in': 'answers-you', // a tab panel from the side of the chosen tab
  'feel-item-in': 'answers-you', // a menu's items the first time it opens
  'feel-fade-in': 'answers-you', // a dialog's scrim
  'feel-countdown': 'waiting', // a toast's ring showing the time it has left
  'feel-nudge': 'answers-you', // a field's warning after what was typed
  'feel-check': 'answers-you', // a check or radio just taken
  'feel-skeleton-sweep': 'waiting', // one band of light across a placeholder, three times at most
  'feel-bloom': 'arrives', // progress that reached done while on screen
  // the Shell (styles/feel-shell.css)
  'feel-rail-label': 'answers-you', // the rail's words as it opens
  'feel-menu-grow': 'answers-you', // a menu growing from its button
  'feel-crumb-in': 'arrives', // the page's name when the page changes
  'feel-ring': 'arrives', // the bell, once, when new activity arrives
  'feel-dock-rise': 'arrives', // the mini player when playback starts
  'feel-dock-sink': 'answers-you', // the mini player leaving
  'feel-glyph-swap': 'answers-you', // Play turning into Pause
  'feel-title-in': 'arrives', // a new song's title
  'feel-palette-grow': 'answers-you', // the command palette from the button that opened it
  'feel-banner-in': 'arrives', // the connection banner and import chip
  'feel-banner-out': 'answers-you', // the banner leaving
  'feel-theme-reveal': 'answers-you', // the new theme spreading from the theme button
  // boot, Welcome and onboarding (styles/feel-entry.css)
  'feel-sweep': 'arrives', // one pass of light over a lit welcome word
  'feel-line-down': 'arrives', // the line between two welcome steps, drawn as it scrolls in
  'feel-line-across': 'arrives',
  'feel-arrive-forward': 'answers-you', // an onboarding step after Next
  'feel-arrive-back': 'answers-you', // an onboarding step after Back
  // Make a Mix and Listen (styles/feel-listen.css)
  'feel-listen-skip': 'answers-you', // the ring where a skip was pressed
  'feel-listen-rise': 'arrives', // the next song's card as a real hand-over nears
  'feel-listen-build-out': 'answers-you', // the build moment leaving once the mix is made
  // Rooms and devices (styles/feel-rooms.css)
  'feel-qr-wave': 'arrives', // the room's QR code, opacity only, so it scans as drawn
  'feel-beacon': 'arrives', // this device's edge lights once
  // the local app (styles/feel-local.css)
  'feel-word-light': 'arrives', // a word the first scan found
  // Lucy (styles/lucy.css)
  'feel-lucy-rise': 'answers-you', // your message rising from the box
  'feel-lucy-fade': 'arrives', // Lucy's words and each streamed chunk
  'feel-lucy-shimmer': 'arrives', // one pass of light when the server names a new step
  'feel-lucy-edge': 'arrives', // a song a revision added
  // the staff deck (business/staff/staff.css)
  'feel-pin-refused': 'answers-you', // a refused PIN's dots, once, in the danger colour; no shake
};

const SRC = join(process.cwd(), 'src');
function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith('.css') ? [path] : [];
  });
}
const css = stylesheets(SRC).map((file) => readFileSync(file, 'utf8')).join('\n');

describe('GP-0257-01 motion changes, counted by severity', () => {
  const names = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((found) => found[1]))];

  it('places every animation in the app, and counts them by how much they ask of you', () => {
    const unplaced = names.filter((name) => !(name in INVENTORY));
    expect(unplaced).toEqual([]);
    const gone = Object.keys(INVENTORY).filter((name) => !names.includes(name));
    expect(gone, 'the inventory names a keyframe that no longer exists').toEqual([]);
    const counts: Record<Severity, number> = { 'answers-you': 0, arrives: 0, waiting: 0, 'follows-music': 0 };
    for (const name of names) counts[INVENTORY[name]] += 1;
    console.log(`GP-0257-01 motion changes by severity: ${JSON.stringify(counts)}`);
    expect(counts['answers-you'] + counts.arrives + counts.waiting).toBe(names.length);
    for (const kind of Object.keys(KINDS) as Severity[]) expect(KINDS[kind].length, kind).toBeGreaterThan(20);
  });

  it('never files a CSS keyframe as following the music, and the music sheet has no loop or keyframe', () => {
    expect(Object.entries(INVENTORY).filter(([, kind]) => kind === 'follows-music')).toEqual([]);
    const music = readFileSync(join(SRC, 'styles', 'feel-music.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(music).not.toMatch(/@keyframes|\binfinite\b/);
  });

  it('the beat bus animates only transform, translate, scale or opacity for every kind', async () => {
    const { MUSIC_MOTIONS } = await import('../feel/beatBus');
    const allowed = new Set(['transform', 'translate', 'scale', 'opacity']);
    const kinds = Object.entries(MUSIC_MOTIONS);
    expect(kinds.length).toBeGreaterThan(0);
    for (const [kind, motion] of kinds) {
      for (const property of motion.properties) expect(allowed.has(property), `${kind} declares ${property}`).toBe(true);
      for (const [level, rest] of [[0, 0.4], [0.5, 0.4], [1, 0.4], [1, 0]]) {
        const frames = motion.keyframes(level, rest) as Keyframe[];
        expect(frames.length).toBeGreaterThan(1);
        for (const frame of frames) {
          const touched = Object.keys(frame).filter((key) => !['offset', 'easing', 'composite'].includes(key));
          for (const property of touched) {
            expect(allowed.has(property), `${kind} animates ${property}`).toBe(true);
            expect(motion.properties as readonly string[], `${kind} animates ${property} without declaring it`).toContain(property);
          }
        }
      }
    }
  });

  it('only lets something waiting loop forever', () => {
    const looping = [...css.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map((found) => found[1]);
    expect(looping.length).toBeGreaterThan(0);
    for (const name of looping) expect(INVENTORY[name], `${name} loops`).toBe('waiting');
  });

  it('stops every animation under the system setting and under Still', () => {
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((found) => found[1]);
    expect(reduced.some((block) => /\*, \*::before, \*::after/.test(block)
      && /animation-duration: 0ms !important/.test(block) && /animation-iteration-count: 1 !important/.test(block))).toBe(true);
    expect(css).toMatch(/:root\[data-motion='still'\] \*,[\s\S]*?animation: none !important;/);
  });
});
