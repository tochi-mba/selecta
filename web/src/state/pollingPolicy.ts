/**
 * Selecta 2.0 T0068 (ADR-0005): one place that says who keeps each piece of server data and how
 * often anything asks the server again. `pollingPolicy.test.ts` reads the source and fails when a
 * file starts a timer or a poll that isn't listed here, so the policy can't drift silently.
 *
 * The default is `useVisiblePoll` (web/src/ui/useVisiblePoll.ts): no reads while the tab is hidden,
 * one read straight away on return, and a slow read never piles up behind another. A timer that
 * keeps going while hidden says why.
 */

export type Hidden = 'pauses' | 'continues';

export type PollRule = {
  /** Source file under web/src. */
  file: string;
  /** What it asks the server for, or `null` when the timer never touches the server. */
  reads: string | null;
  everyMs: number | string;
  hidden: Hidden;
  why: string;
};

export const POLLING: readonly PollRule[] = [
  { file: 'business/BusinessApp.tsx', reads: 'business overview while streaming is unavailable', everyMs: 'TICK_MS', hidden: 'continues', why: 'the visual clock keeps ticking while useVisiblePoll pauses network reads in hidden tabs' },
  { file: 'business/console/HqConsole.tsx', reads: 'HQ venue state when the stream is unavailable', everyMs: 10000, hidden: 'pauses', why: 'useVisiblePoll pauses requests when the tab is hidden and refreshes on return' },
  { file: 'business/staff/useStaffCommands.ts', reads: null, everyMs: 'SWEEP_MS', hidden: 'continues', why: 'the offline command queue still expires stale commands even when the page is hidden' },
  { file: 'App.tsx', reads: '/status, /mix, /drafts/{id}', everyMs: '4000 status, 1500 mix while busy, 2000 draft while busy', hidden: 'pauses', why: 'the app shell owns status, the current mix and the open draft (useVisiblePoll)' },
  { file: 'state/async.ts', reads: 'whatever a page reads with useAsync', everyMs: 'options.every', hidden: 'pauses', why: 'checks visibilityState and reads again on return' },
  { file: 'state/jobs.ts', reads: '/jobs', everyMs: 'per subscriber', hidden: 'pauses', why: 'one shared jobs snapshot for every page that shows work' },
  { file: 'ui/useVisiblePoll.ts', reads: null, everyMs: 'caller', hidden: 'pauses', why: 'the shared policy itself' },
  { file: 'views/Adder.tsx', reads: '/songs search', everyMs: 4000, hidden: 'pauses', why: 'only while something is typed' },
  { file: 'views/Drafts.tsx', reads: '/drafts', everyMs: 4000, hidden: 'pauses', why: 'drafts list (useVisiblePoll)' },
  { file: 'views/Library.tsx', reads: '/library page shown', everyMs: '4000 while searching, else 15000', hidden: 'pauses', why: 'useVisiblePoll' },
  { file: 'views/Links.tsx', reads: '/discoveries, /links, /seams/{key}', everyMs: '15000, 6000, 1500 while a render runs', hidden: 'continues', why: 'lists use useVisiblePoll; the 1500 ms timer only waits on a render the person just asked for, and stops when it is done' },
  { file: 'views/Requests.tsx', reads: '/requests, /requests/consider, /seams/{key}', everyMs: '4000, 5000, preview wait', hidden: 'pauses', why: 'the consider loop skips hidden ticks and runs again on return; the preview wait stops once the clip is ready' },
  { file: 'views/Start.tsx', reads: '/status while scanning', everyMs: 1000, hidden: 'pauses', why: 'useVisiblePoll, only during a scan' },
  { file: 'views/WorkshopPanels.tsx', reads: '/storage', everyMs: 15000, hidden: 'pauses', why: 'useVisiblePoll' },
  { file: 'views/Lucy.tsx', reads: '/lucy/status', everyMs: 5000, hidden: 'continues', why: 'only while Lucy cannot be reached, to notice it coming back (Library/Lucy programme)' },
  { file: 'player.ts', reads: '/seams/{key} for the next transition', everyMs: '50 ms audio clock', hidden: 'continues', why: 'the music keeps playing in a hidden tab, so its next transition must still be watched' },
  { file: 'studio.ts', reads: null, everyMs: 'audio clock', hidden: 'continues', why: 'Stem Studio playback position' },
  { file: 'ui/ActivityPanel.tsx', reads: null, everyMs: 30000, hidden: 'continues', why: 'refreshes "x minutes ago" wording only' },
  { file: 'cloud/events.ts', reads: 'cloud events fallback', everyMs: 'pollMs', hidden: 'pauses', why: 'useVisiblePoll when the event stream is unavailable (Cloud programme)' },
  { file: 'cloud/checkout.ts', reads: 'checkout confirmation', everyMs: 'bounded tries', hidden: 'continues', why: 'a payment confirmation must finish; it stops after a set number of tries (Cloud programme)' },
  { file: 'devices/DevicesPanel.tsx', reads: 'devices', everyMs: 15000, hidden: 'continues', why: 'Cloud programme' },
  { file: 'devices/usePlaybackDevice.ts', reads: 'remote playback state and heartbeat', everyMs: '1000 or 2000', hidden: 'continues', why: 'remote playback keeps going while this tab is hidden (Cloud programme)' },
  { file: 'devices/PlayingBar.tsx', reads: null, everyMs: 1000, hidden: 'continues', why: 'clock text only' },
  { file: 'devices/audioSpeaker.ts', reads: null, everyMs: 'fade steps', hidden: 'continues', why: 'volume fade' },
  { file: 'rooms/RoomPanel.tsx', reads: 'room state', everyMs: 3000, hidden: 'continues', why: 'Cloud programme' },
];

/** Who keeps each shared piece of server data. Anything else is read by the page that shows it. */
export const CACHE_OWNERS: readonly { resource: string; owner: string; others: string }[] = [
  { resource: 'status (counts, steering, flags)', owner: 'App.tsx', others: 'pages get it as `status` and ask for a refresh with `refreshStatus`' },
  { resource: 'current mix', owner: 'App.tsx', others: 'pages get `mix` and replace it only through `setMixData` with a server answer' },
  { resource: 'open draft', owner: 'App.tsx', others: 'the editor gets it as `draftData`' },
  { resource: 'jobs and failures', owner: 'state/jobs.ts', others: 'useJobsStatus subscribers share one snapshot and one timer' },
  { resource: 'export jobs', owner: 'views/exportStore.ts', others: 'Export panels subscribe to one store' },
  { resource: 'preferences', owner: 'state/prefs.ts', others: 'kept in this browser, not on the server' },
];
