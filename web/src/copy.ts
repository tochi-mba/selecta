/** Words that depend on where Selecta runs (ADR-0392, docs/saas/11-ui-ux.md §11.2).
 *
 * Locally, Selecta runs on the listener's own computer, so the pages say "this PC", point at File
 * Explorer and suggest restarting Selecta. In Cloud none of that is true: the music lives in a
 * private Cloud workspace, there is no folder to copy, and there is nothing for the listener to
 * restart. Every sentence like that lives here, once per mode, so a page asks for `words().key`
 * and gets the right one. `copy.local` is exactly the text the local app always had.
 *
 * The mode is set once, when `/api/status` says which server this is (`RuntimeApp`), and is local
 * until then, so the local app never shows a Cloud sentence. */

export type Mode = 'local' | 'cloud';

const local = {
  themeMatchSystem: 'Match this computer',
  themeCommand: 'Theme: match this computer',
  glossaryRendered: 'Made into finished audio on this PC, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
  glossaryRender: 'Making a transition into audio. It happens on this PC in the background. Jobs wait their turn in the render line, and the current mix always goes first. Drafts and word links being prepared wait behind it.',
  glossaryStems: 'A song split into four parts: voice, drums, bass and melody (everything else). SelectaDJ separates them on this PC, so a transition can bring parts in and out on their own.',
  glossaryArrange: 'In the Studio, Let SelectaDJ arrange it and Fine tune mine ask for a proposed set of cells. It works this out on this PC from what it measures in the stems and what you’ve rated. Nothing is sent online. It’s only a proposal: it changes your working copy, and lists each cell it changed.',
  glossaryAnalysis: 'SelectaDJ listening to a song on this PC to find its tempo, key, beats, bars, sections and energy, and, from its lyrics where they’re found, where the singing is. It never changes the audio file.',
  glossaryPrivacy: 'Your music, analysis, mixes, ratings and renders stay on this PC. There’s no account and no cloud. To find lyrics, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service. The audio itself never leaves this PC, and nothing else about your music is sent anywhere.',
  glossaryPrivacyNoLyrics: 'Your music, analysis, mixes, ratings and renders stay on this PC. There’s no account and no cloud. The audio itself never leaves this PC, and nothing about your music is sent anywhere.',
  exportsNeedRestart: 'This running copy of SelectaDJ doesn’t keep track of exports. Restart SelectaDJ to get them.',
  exportNeedsRestart: 'This running copy of SelectaDJ can’t do this yet. Restart SelectaDJ, then try again.',
  restorePrepared: 'Restore prepared, not yet applied. Restart SelectaDJ to activate it. Your current data is unchanged until then; the previous database is kept as a rollback copy.',
  lucyRunsOutside: 'which runs outside this computer.',
  lucyBuiltinStays: 'The built-in planner runs on this computer. No data leaves it.',
  lucyUsingBuiltin: 'Using the built-in planner on this computer. No data leaves it.',
  lucyMemoryNothingSent: 'Nothing. With the built-in planner, nothing leaves this computer.',
  lucyBuiltinLabel: 'Built-in (on this computer, no AI service)',
  lucyBuiltinAbout: 'Plans with SelectaDJ’s own rules. Nothing leaves this computer.',
  lucyKeySavedHere: 'Saved on this computer and never shown here again.',
  mixesRestartToRefresh: 'Restart SelectaDJ to refresh this status.',
  setupAnalysis: 'Measures each song’s tempo, key, beats and sections, on this PC.',
  startAudioStays: 'Your audio stays on this PC.',
  startFolderHelp: 'In File Explorer, open your music folder, copy its address, and paste it here. Subfolders are included. Your original files are never moved or changed.',
  workshopEstimates: 'Times are estimates, from how long this PC has been taking. They’re never a promise.',
  learningStaysHere: 'Rate transitions after you hear them. Your feedback stays on this PC.',
  jobsNeedRestart: 'This running copy of SelectaDJ can’t report background jobs. Restart SelectaDJ to update it.',
  sourcesHelp: 'Copy a folder address from File Explorer. Your audio stays on this PC. For lyric lookup, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB. That request does not upload the audio file. SelectaDJ also communicates with its local server.',
  diagnosticsStaysHere: 'No paths or song names, and nothing is sent anywhere. It only leaves this PC if you copy it somewhere yourself.',
};

export type CopyKey = keyof typeof local;

const cloud: Record<CopyKey, string> = {
  themeMatchSystem: 'Match this device',
  themeCommand: 'Theme: match this device',
  glossaryRendered: 'Made into finished audio by SelectaDJ Cloud, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
  glossaryRender: 'Making a transition into audio. SelectaDJ Cloud does it in the background. Your jobs wait their turn within your account, and the current mix always goes first. Drafts and word links being prepared wait behind it.',
  glossaryStems: 'A song split into four parts: voice, drums, bass and melody (everything else). SelectaDJ Cloud separates them, so a transition can bring parts in and out on their own.',
  glossaryArrange: 'In the Studio, Let SelectaDJ arrange it and Fine tune mine ask for a proposed set of cells. SelectaDJ Cloud works this out from what it measures in the stems and what you’ve rated. It’s only a proposal: it changes your working copy, and lists each cell it changed.',
  glossaryAnalysis: 'SelectaDJ Cloud listening to a song to find its tempo, key, beats, bars, sections and energy, and, from its lyrics where they’re found, where the singing is. It never changes your original file.',
  glossaryPrivacy: 'Your music, analysis, mixes, ratings and renders are kept in your private SelectaDJ Cloud workspace. Only you can reach them. To find lyrics, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service. Your audio is never shared, and you can download all of it at any time.',
  glossaryPrivacyNoLyrics: 'Your music, analysis, mixes, ratings and renders are kept in your private SelectaDJ Cloud workspace. Only you can reach them. Your audio is never shared, and you can download all of it at any time.',
  exportsNeedRestart: 'Exports aren’t available right now. Try again in a few minutes.',
  exportNeedsRestart: 'SelectaDJ Cloud can’t do this right now. Try again in a few minutes.',
  restorePrepared: 'Restoring a backup isn’t part of SelectaDJ Cloud. Download my data keeps a copy of everything instead.',
  lucyRunsOutside: 'which runs outside SelectaDJ.',
  lucyBuiltinStays: 'The built-in planner runs inside SelectaDJ. No data goes to an AI provider.',
  lucyUsingBuiltin: 'Using the built-in planner inside SelectaDJ. No data goes to an AI provider.',
  lucyMemoryNothingSent: 'Nothing. With the built-in planner, nothing goes to an AI provider.',
  lucyBuiltinLabel: 'Built-in (inside SelectaDJ, no AI service)',
  lucyBuiltinAbout: 'Plans with SelectaDJ’s own rules. Nothing goes to an AI provider.',
  lucyKeySavedHere: 'Kept by SelectaDJ and never shown here again.',
  mixesRestartToRefresh: 'This status will refresh shortly.',
  setupAnalysis: 'Measures each song’s tempo, key, beats and sections, in SelectaDJ Cloud.',
  startAudioStays: 'Your audio stays private to your workspace.',
  startFolderHelp: 'Choose your music files or a folder to upload. Your original files on this device are never moved or changed.',
  workshopEstimates: 'Times are estimates, from how long your recent jobs have taken. They’re never a promise.',
  learningStaysHere: 'Rate transitions after you hear them. Your feedback stays private to your workspace.',
  jobsNeedRestart: 'Background jobs can’t be shown right now. Try again in a few minutes.',
  sourcesHelp: 'Add music by uploading files. Your audio stays private to your workspace. For lyric lookup, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB. That request does not upload the audio file.',
  diagnosticsStaysHere: 'No paths or song names, and nothing is sent anywhere. It only leaves this device if you copy it somewhere yourself.',
};

export const copy: Record<Mode, Record<CopyKey, string>> = { local, cloud };

let mode: Mode = 'local';

/** Called once the server has said which mode it runs in. */
export function setCopyMode(next: Mode) {
  mode = next;
}

export function copyMode(): Mode {
  return mode;
}

/** This mode's words. */
export function words(): Record<CopyKey, string> {
  return copy[mode];
}

/* ------------------------------------------------------------------------------------------------
 * Playback status, one vocabulary (ADR-0463 BF-0463-03; states from ADR-0457, ADR-0460, ADR-0461).
 *
 * Every surface that says whether music is playing, local or remote, takes its words from here, so
 * the same state reads the same everywhere. 'playing' always carries the time a person last
 * confirmed they heard the sound check: it is a record of when, never a standing promise. Nothing
 * here can say a sound is audible without that confirmation.
 * ---------------------------------------------------------------------------------------------- */

export type PlaybackState = 'playing' | 'output_unverified' | 'interrupted' | 'uncertain' | 'unsupported_here';

export type PlaybackStatus =
  | { state: 'playing'; verifiedAt: number }
  | { state: 'output_unverified' }
  | { state: 'interrupted' }
  | { state: 'uncertain' }
  | { state: 'unsupported_here'; reason: string };

/** The short label and the plain sentence for each state. */
export const PLAYBACK_STATUS: Readonly<Record<PlaybackState, { label: string; detail: string }>> = {
  playing: {
    label: 'Playing',
    detail: 'Sound last confirmed by a person at {time}.',
  },
  output_unverified: {
    label: 'Sound not confirmed',
    detail: 'Nobody has confirmed hearing this device yet. Play the check tone and say whether you heard it.',
  },
  interrupted: {
    label: 'Interrupted',
    detail: 'Something else took the sound, like a call or another app. Press play to carry on.',
  },
  uncertain: {
    label: 'Not sure',
    detail: 'SelectaDJ cannot tell whether sound is reaching the speakers right now. Bring the tab to the front and check the device.',
  },
  unsupported_here: {
    label: 'Cannot play here',
    detail: 'This device cannot play: {reason}',
  },
};

/** "21:04", in the listener's own clock (seconds since epoch in). */
export function clockTime(seconds: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(seconds * 1000));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(seconds * 1000));
  }
}

/** The full sentence a surface shows for a playback status. */
export function playbackStatusText(status: PlaybackStatus, options: { timeZone?: string } = {}): string {
  const words = PLAYBACK_STATUS[status.state];
  if (status.state === 'playing') return `${words.label}. ${words.detail.replace('{time}', clockTime(status.verifiedAt, options.timeZone))}`;
  if (status.state === 'unsupported_here') return `${words.label}. ${words.detail.replace('{reason}', status.reason)}`;
  return `${words.label}. ${words.detail}`;
}

/** Just the label, for a chip or a compact row. */
export function playbackStatusLabel(status: PlaybackStatus): string {
  return PLAYBACK_STATUS[status.state].label;
}

/** Promises SelectaDJ cannot keep in a browser (ADR-0460 explicit non-promises, BF-0460-08). No
 * user-facing string may contain one; copyAudit.test.ts scans for them, together with the DSP
 * honesty list in dsp/honesty.ts. Matched case-insensitively. */
export const BANNED_CLAIMS: readonly string[] = [
  'same as the native engine',
  'works on every phone',
  'works on any phone',
  'works on every device',
  'runs unattended 24/7',
  'unattended 24/7',
  'background playback guaranteed',
  'guaranteed background playback',
  'keeps playing in the background',
  'keeps playing when the screen is locked',
  'keeps playing with the screen locked',
  'resumes automatically after a restart',
  'resumes automatically after a reboot',
  'multiple zones from one tablet',
  'multi-zone from one tablet',
  'plays your spotify',
  'plays music from spotify',
  'plays your apple music',
  'sound is guaranteed',
];
