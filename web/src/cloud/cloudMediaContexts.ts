// Every place the Cloud site makes or measures sound (AV-0419-01). The prose inventory is
// docs/engineering/cloud-media-contexts.md; apaCloudMediaContexts.test.ts scans web/src/cloud,
// web/src/rooms and web/src/devices and fails when a media element or audio context appears in
// a file that isn't listed here with the same count. Adding one means deciding, here, who owns
// its sound and how it yields to the one Cloud player (cloudTransport.ts).

export type MediaContext = {
  /** Path under web/src. */
  file: string;
  /** How many media elements or audio contexts the file creates. */
  count: number;
  kind: 'audio element' | 'audio context';
  /** Who owns the sound, and how it takes part in exclusive focus. */
  owner: string;
};

export const CLOUD_MEDIA_CONTEXTS: MediaContext[] = [
  {
    file: 'cloud/Library.tsx', count: 1, kind: 'audio element',
    owner: 'Library page-local player. Rendered only with cloud.single_audio_owner off; with it on the page plays through the dock.',
  },
  {
    file: 'cloud/CloudTransportDock.tsx', count: 1, kind: 'audio element',
    owner: 'The dock Library player, above the routes. Claims focus "library" on play; paused when the speaker starts.',
  },
  {
    file: 'devices/PlayingBar.tsx', count: 1, kind: 'audio element',
    owner: 'This browser as the session speaker (lease, heartbeat). In the dock with the flag on, claims focus "device" on play.',
  },
  {
    file: 'devices/DeviceCheck.tsx', count: 1, kind: 'audio context',
    owner: 'Settings > Device check reads the sample rate and closes the context at once. Silent; never takes focus.',
  },
];

/** What counts as making a media context, matched against source with comments removed. */
export const MEDIA_PATTERNS: RegExp[] = [
  /<audio\b/g,
  /<video\b/g,
  /new\s+Audio\s*\(/g,
  /new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/g,
  /window\.AudioContext\b/g,
  /createElement\(\s*['"](?:audio|video)['"]/g,
];

export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

export function mediaCount(source: string): number {
  const code = withoutComments(source);
  return MEDIA_PATTERNS.reduce((total, pattern) => total + (code.match(pattern)?.length ?? 0), 0);
}
