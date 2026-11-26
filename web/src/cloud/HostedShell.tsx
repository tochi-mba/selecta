import { ReactNode, useEffect, useLayoutEffect } from 'react';
import { accountFlagOn, setFlags, useFlags } from '../flags';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { navigate, useLocationText } from '../router';
import { describeRoute, moreDestinationsFor, moreRouteOf, type Experience, type MoreDestinationId, type ShellRoute } from '../shell/manifest';
import { Shell, type ShellAccount } from '../shell/Shell';
import { setJobsSource } from '../state/jobs';
import { Section } from '../ui/controls';
import { pageShown, type Account } from './api';

/** Hosted Cloud on the shared shell (`cloud.hosted_shell`): one shell for every Cloud account.
 *
 * The same Shell, manifest and router as local mode and browser-first Cloud, with the hosted pages
 * as its children and the account places in More, exactly as CloudShell has them. Hosted
 * playback is the CloudTransportDock's own media element, drawn by CloudApp in the banner, so the
 * shell gets a player that does nothing and is never shown: no engine, media store or DSP is
 * imported here, and the hosted bundle stays free of them. With the flag off CloudApp draws the
 * legacy rail exactly as before.
 */

/** What a hosted address shows. `mixes` is Make a Mix (the hosted mix maker). */
export type HostedView = 'home' | 'listen' | 'mixes' | 'library' | { more: MoreDestinationId } | { missing: string };

/** Shell features this shell cannot serve: they belong to this computer's own server or to the
 * browser-first engine. Off in the one flag read while the shell is open, so their buttons are gone
 * rather than dead; `cloud.local_first` off is the truth here (this is not the local-first shell),
 * and it is what drops My Mixes from the shared navigation. */
export const NOT_IN_HOSTED = {
  'cloud.local_first': false,
  // this is the shell an account gets with cloud.one_shell off (an old server never names it)
  'cloud.one_shell': false,
  // the browser Workspace belongs to browser-first Cloud, so the hosted rail has none
  'cloud.workspace': false,
  requests: false,
  editor: false,
  drafts: false,
  'app.activity': false,
  'app.command_palette': false,
  'app.shortcuts': false,
  'app.classic_nav': false,
} as const;

/** The hosted experience, as the shared manifest reads it: account places and uploads, no device
 * library. Uploads still need `cloud.uploads`, as the legacy page always did. */
const HOSTED: Experience = { local_first: false, hosted: true };

const IDLE_NOW: NowState = {
  phase: 'idle', position: 0, songTime: 0, duration: 0, inSeam: false, seamAt: null, notice: '',
  nextReady: false, lastSeamKey: null, volume: 1, muted: false,
};
const NOTHING = async () => {};

/** The null player facade: the shell's transport is never shown in hosted Cloud (no `hasPlayer`),
 * so every control is a quiet no-op rather than a second audio owner beside the dock. */
export const NO_PLAYER: PlayerLike = {
  state: IDLE_NOW,
  onChange: () => {},
  playFrom: NOTHING, togglePause: NOTHING, next: NOTHING, previous: NOTHING, skip: NOTHING, seek: NOTHING,
  stop: () => {}, toggleMute: () => {}, setVolume: () => {},
  getSpectrum: () => null,
};

/** Hosted pages that a flag can take away. */
export type Optional = 'mixes' | 'library';

/** The hosted view and the shell route for an address. A page or place whose feature is off is not
 * there: its address shows the overview instead, as the legacy rail did. */
export function hostedRoute(pathname: string, more: readonly { id: MoreDestinationId }[], shown: (what: Optional) => boolean): { view: HostedView; route: ShellRoute; redirect?: string } {
  const path = pathname.replace(/\/+$/, '') || '/';
  const home = { view: 'home' as const, route: { page: 'home' as const } };
  if (path === '/') return home;
  if (path === '/listen') return { view: 'listen', route: { page: 'listen' } };
  if (path === '/mixes') return shown('mixes') ? { view: 'mixes', route: { page: 'mixes', tab: 'browse' } } : { ...home, redirect: '/' };
  if (path === '/library') return shown('library') ? { view: 'library', route: { page: 'library' } } : { ...home, redirect: '/' };
  // the first rail answered `/uploads` too, so it stays an address for Add music
  const moreRoute = moreRouteOf(path === '/uploads' ? '/upload' : path);
  if (moreRoute) return more.some((item) => item.id === moreRoute.id) ? { view: { more: moreRoute.id }, route: moreRoute } : { ...home, redirect: '/' };
  return { view: { missing: pathname }, route: { page: 'missing', path: pathname } };
}

export function HostedShell({ account, page, notices, dock, footer, signedIn }: {
  account: Pick<Account, 'features'>;
  /** Who is signed in, for the side bar's account menu with Sign out. */
  signedIn?: ShellAccount;
  /** Draws a hosted page or account place; CloudApp owns the pages and their handlers. */
  page: (view: HostedView) => ReactNode;
  /** The account's notices and the page feedback, first in the banner (one source for both frames). */
  notices?: ReactNode;
  /** The hosted transport dock beside the page shown, when this account has one audio owner. It
   * stays mounted from page to page, so the music never stops for a move. */
  dock?: (view: HostedView) => ReactNode;
  /** The foot of every page: who makes SelectaDJ. */
  footer?: ReactNode;
}) {
  const on = useFlags();
  // No server of this computer's own: the job badge and the local-only buttons stand down while
  // this shell is open, and come back exactly as they were when it closes. Before the first paint,
  // so the navigation never flashes a destination this shell does not have.
  useLayoutEffect(() => {
    setJobsSource(false);
    setFlags({ ...NOT_IN_HOSTED });
    // Cloud has no jobs server at all, so the source stays off (React's dev double-mount would
    // otherwise switch it back on before the shell's child subscribes).
    return () => { setFlags(null); };
  }, []);

  const place = useLocationText().split('?')[0];
  const moreItems = moreDestinationsFor({ mode: 'cloud', feature: on, experience: HOSTED });
  // the same reads the hosted pages make: Make a Mix needs `cloud.mix_create`, the Library
  // `cloud.stored_media`, both from the account's own decisions
  const shown = (what: Optional) => (what === 'mixes' ? accountFlagOn('cloud.mix_create', account.features) : pageShown(account, 'library'));
  const { view, route, redirect } = hostedRoute(place, moreItems, shown);
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);
  const title = describeRoute(route).title;

  return (
    <Shell
      route={route}
      player={NO_PLAYER}
      now={IDLE_NOW}
      showPlayer={false}
      hasMix={false}
      hasNext={false}
      stage={false}
      waitingRequests={0}
      onRequests={() => {}}
      onHelp={() => {}}
      mode="cloud"
      more={moreItems}
      account={signedIn}
      banner={<>{notices}{dock?.(view)}</>}
    >
      {/* one page at a time, each in its own Section: a page that fails to draw says so and can
          start again, and the shell, the navigation and the dock stay */}
      <Section key={place} name={title}>
        <main className="page cloud-hosted-page" id="main" data-place={typeof view === 'object' && 'more' in view ? view.more : undefined}>
          <h1 className="display small">{typeof view === 'object' && 'missing' in view ? 'Page not found' : title}</h1>
          <div className="stack">{page(view)}</div>
        </main>
      </Section>
      {footer}
    </Shell>
  );
}
