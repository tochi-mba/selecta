// The kiosk's screens (ADR-0453 D11): KioskPairing, KioskTapToStart and the calm music states.
// Plain DOM, no buttons in normal use. Text always goes in as text; song and venue names come
// from people. Long names wrap to two lines, then truncate with the full text as a tooltip.

import { h } from '../rooms/dom';
import { qrSvg } from '../rooms/qr';
import { GUIDE_URL, KIOSK_COPY as C, PAIR_PATH } from './copy';
import type { KioskScreen } from './state';
import type { KioskView } from './view';

/** A line of text that clamps to two lines and keeps the full words in a tooltip. */
function clamp(tag: string, className: string, text: string, props: Record<string, string> = {}): HTMLElement {
  return h(tag, { className: `${className} k-clamp`, title: text, ...props }, text);
}

export type PairingProps = { code: string | null; deviceName: string; origin?: string; onDone?: () => void };

export function KioskPairing({ code, deviceName, origin, onDone }: PairingProps): HTMLElement {
  const qr = h('div', { className: 'k-qr' });
  if (code) {
    const link = `${origin ?? (typeof location === 'undefined' ? '' : location.origin)}${PAIR_PATH}?code=${encodeURIComponent(code)}`;
    qr.innerHTML = qrSvg(link, C.pairQrLabel); // our own SVG; the label is escaped by qrSvg
    qr.dataset.link = link;
  }
  return h('section', { className: 'k-screen k-pairing', 'data-screen': 'unpaired' },
    h('div', { className: 'k-pair-text' },
      h('h1', { className: 'k-pair-title' }, C.pairTitle),
      h('p', { className: 'k-code', id: 'k-code', 'aria-label': code ? C.pairCodeLabel(code) : C.pairTitle }, code ?? '------'),
      h('p', { className: 'k-lede' }, C.pairAt),
      h('p', { className: 'k-quiet' }, C.pairHow),
      h('p', { className: 'k-quiet' }, C.pairRenews),
      clamp('p', 'k-quiet k-device', C.thisPlayer(deviceName)),
      onDone ? h('button', { type: 'button', className: 'k-plain', onclick: onDone }, C.done) : null),
    code ? qr : null);
}

export function KioskTapToStart(onTap: () => void): HTMLElement {
  return h('section', { className: 'k-screen k-tap', 'data-screen': 'needs_tap' },
    h('h1', { className: 'k-visually-hidden' }, C.tapToStart),
    h('button', { type: 'button', className: 'k-tap-button', id: 'k-tap', onclick: onTap }, C.tapToStart),
    h('a', { className: 'k-guide', href: GUIDE_URL, target: '_blank', rel: 'noopener noreferrer' }, C.guideLink));
}

function message(kind: string, words: string, ...extra: (Node | null)[]): HTMLElement {
  return h('section', { className: `k-screen k-message k-${kind}`, 'data-screen': kind }, h('h1', { className: 'k-big' }, words), ...extra);
}

export function KioskClosed(opensAt: string | null, sleep: boolean): HTMLElement {
  const node = message('closed', opensAt ? C.closedAt(opensAt) : C.closedSoon);
  if (sleep) node.dataset.sleep = 'allowed';
  return node;
}

export function KioskStarting(): HTMLElement {
  return message('starting', C.starting, h('div', { className: 'k-progress', role: 'progressbar', 'aria-label': C.starting }, h('span', {})));
}

export function KioskPaused(): HTMLElement {
  return message('paused', C.paused);
}

export function KioskProblem(code: string): HTMLElement {
  return message('problem', C.backShortly, h('p', { className: 'k-code-small', 'data-code': code }, C.codeFor(code)));
}

export function KioskUpdating(): HTMLElement {
  return message('updating', C.updating);
}

/** The tiny cloud-off mark for playing from saved music: no words, staff know it from the guide. */
function savedMark(): HTMLElement {
  const mark = h('span', { className: 'k-saved', 'aria-hidden': 'true', 'data-saved': 'on' });
  mark.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.3 9.2 4.5 4.5 0 0 0 7 18z"/><path d="M3 3l18 18"/></svg>';
  return mark;
}

export function KioskPlaying(view: KioskView, saved: boolean): HTMLElement {
  const where = [view.venue_name, view.zone_name].filter(Boolean).join(' · ');
  const now = view.now;
  const next = view.next;
  return h('section', { className: 'k-screen k-playing', 'data-screen': saved ? 'playing_saved' : 'playing' },
    where ? clamp('p', 'k-where', where) : null,
    h('div', { className: 'k-song', 'data-song': now ? `${now.title}\u0000${now.artist}` : '' },
      h('p', { className: 'k-visually-hidden' }, C.nowPlaying),
      clamp('h1', 'k-title', now?.title ?? ''),
      now?.artist ? clamp('p', 'k-artist', now.artist) : null),
    next ? clamp('p', 'k-next', C.next(C.songLine(next.title, next.artist))) : null,
    h('div', { className: 'k-motif', 'aria-hidden': 'true' }, h('span', {}), h('span', {}), h('span', {})),
    saved ? savedMark() : null);
}

export type RenderContext = { deviceName: string; pairingCode: string | null; onTap: () => void; onDonePairing?: () => void };

export function renderScreen(screen: KioskScreen, view: KioskView, ctx: RenderContext): HTMLElement {
  switch (screen.kind) {
    case 'unpaired': return KioskPairing({ code: ctx.pairingCode, deviceName: ctx.deviceName, onDone: ctx.onDonePairing });
    case 'needs_tap': return KioskTapToStart(ctx.onTap);
    case 'closed': return KioskClosed(screen.opensAt, screen.sleep);
    case 'starting': return KioskStarting();
    case 'playing': return KioskPlaying(view, screen.saved);
    case 'paused': return KioskPaused();
    case 'problem': return KioskProblem(screen.code);
    case 'updating': return KioskUpdating();
  }
}
