// Every word the kiosk player screen shows (ADR-0453 D11, D15). Customers can see this screen,
// so the copy is limited to neutral music states and never names a cause: no billing, licence,
// pilot, seats, network or fault words. customerSeparation.test.ts scans this module.
// The hidden staff panel's labels live here too; they describe the player, never the business.

export const KIOSK_COPY = {
  pairTitle: 'Pair this player',
  pairAt: 'Open /pair in your SelectaDJ app to pair this player',
  pairHow: 'Type the code shown on the player, then choose the zone it plays in.',
  pairRenews: 'The code changes every 10 minutes.',
  pairCodeLabel: (code: string) => `Pairing code ${code.split('').join(' ')}`,
  pairQrLabel: 'QR code to pair this player',
  thisPlayer: (name: string) => `This player: ${name}`,
  tapToStart: 'Tap to start the music',
  guideLink: 'Setting up a player',
  closedAt: (time: string) => `Closed. Music starts at ${time}`,
  closedSoon: 'Closed. Music starts soon',
  closed: 'Closed',
  starting: 'Starting the music',
  paused: 'Music paused',
  backShortly: 'The music will be back shortly',
  updating: 'Updating, back in a moment',
  nowPlaying: 'Now playing',
  next: (line: string) => `Next: ${line}`,
  songLine: (title: string, artist: string) => (artist ? `${title} by ${artist}` : title),
  codeFor: (code: string) => `Code ${code}`,
  // the hidden staff panel (read only)
  staffCorner: 'Player details. Press and hold for 3 seconds',
  pinTitle: 'Staff PIN',
  pinLabel: 'Type the staff PIN',
  pinWrong: "That PIN didn't match. Try again",
  pinOpen: 'Open',
  cancel: 'Cancel',
  panelTitle: 'Player details',
  deviceName: 'Player',
  zone: 'Zone',
  network: 'Network',
  savedAhead: 'Music saved ahead',
  hours: (hours: number) => (hours === 1 ? '1 hour' : `${Math.round(hours * 10) / 10} hours`),
  lastSync: 'Last sync',
  never: 'Not yet',
  version: 'App version',
  reload: 'Reload player',
  showCode: 'Show pairing code',
  close: 'Close',
  done: 'Done',
  networkWords: { online: 'Connected', offline: 'Not connected', unknown: 'Unknown' },
} as const;

/** The pairing link a manager's phone opens from the QR. */
export const PAIR_PATH = '/pair';
/** The kiosk-flags guide for managers (ADR-0445 setup guide), linked from Tap to start. */
export const GUIDE_URL = '/help/kiosk-setup';
