/** Words that depend on where SelectaDJ runs and where the music lives (ADR-0392, ADR-0479,
 * docs/glossary.md).
 *
 * On Desktop, SelectaDJ runs on the listener's own computer, so the pages say "this PC", point at
 * File Explorer and suggest restarting SelectaDJ. In Cloud none of that is true, and what is true
 * depends on where the account's music lives: on this device (this browser measures and plays it),
 * in the cloud library (SelectaDJ's workers measure and render it), or both. A member never meets
 * a "mode": a page asks for `words().key` and gets the sentence that is true for them.
 * `copy.desktop` is exactly the text the Desktop app always had.
 *
 * The place is set once, when `/api/status` says which server this is (`RuntimeApp`), and is
 * Desktop until then, so the Desktop app never shows a Cloud sentence. The music home is set when
 * the Cloud account is read (`CloudApp`), and is the cloud library until then, as before. */

/** Where SelectaDJ runs: the app on the person's computer, or the signed-in Cloud. */
import { flagListed } from './flags';

export type Place = 'desktop' | 'cloud';

/** Where a Cloud account's music lives. */
export type MusicHome = 'device' | 'cloud_library' | 'both';

const desktop = {
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
  exportNeedsRestart: 'This running copy of SelectaDJ needs a restart for this. Restart SelectaDJ, then try again.',
  restorePrepared: 'Restore prepared. It is applied when SelectaDJ restarts, so restart SelectaDJ to activate it. Your current data is unchanged until then; the previous database is kept as a rollback copy.',
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
  libraryReadyMeaning: 'Analysed means audio has been measured. Ready for mixes means a song has the cues needed to plan a mix; it does not mean transitions are already rendered.',
};

export type CopyKey = keyof typeof desktop;

/** The Cloud sentences that change with where the music lives. */
type HomeKey = 'glossaryRendered' | 'glossaryRender' | 'glossaryStems' | 'glossaryAnalysis' | 'setupAnalysis'
  | 'startAudioStays' | 'startFolderHelp' | 'sourcesHelp' | 'libraryReadyMeaning';

const LYRICS_LOOKUP = 'For lyric lookup, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB. That request does not upload the audio file.';

/** Every other Cloud sentence: the same wherever the music lives. */
const cloudShared: Record<Exclude<CopyKey, HomeKey>, string> = {
  themeMatchSystem: 'Match this device',
  themeCommand: 'Theme: match this device',
  glossaryArrange: 'In the Studio, Let SelectaDJ arrange it and Fine tune mine ask for a proposed set of cells. SelectaDJ works this out from what it measures in the stems and what you’ve rated. It’s only a proposal: it changes your working copy, and lists each cell it changed.',
  glossaryPrivacy: 'Your library details, mixes, ratings and renders are kept in your private SelectaDJ Cloud workspace. Only you can reach them. Music you upload is stored there too. Music you connect from a device stays on that device, and SelectaDJ keeps only its title, artist and fingerprint. To find lyrics, SelectaDJ sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service. Your audio is never shared, and you can download all of it at any time.',
  glossaryPrivacyNoLyrics: 'Your library details, mixes, ratings and renders are kept in your private SelectaDJ Cloud workspace. Only you can reach them. Music you upload is stored there too. Music you connect from a device stays on that device, and SelectaDJ keeps only its title, artist and fingerprint. Your audio is never shared, and you can download all of it at any time.',
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
  workshopEstimates: 'Times are estimates, from how long your recent jobs have taken. They’re never a promise.',
  learningStaysHere: 'Rate transitions after you hear them. Your feedback stays private to your workspace.',
  jobsNeedRestart: 'Background jobs can’t be shown right now. Try again in a few minutes.',
  diagnosticsStaysHere: 'No paths or song names, and nothing is sent anywhere. It only leaves this device if you copy it somewhere yourself.',
};

/* What this device does with its songs before a mix plays depends on two Cloud switches
 * (docs/engineering/cloud-device-features.md): with cloud.device_analysis it prepares every song
 * in the background, with cloud.device_render it makes the next transitions ahead of time. */
type DeviceWork = 'none' | 'songs' | 'transitions' | 'all';

const PLAYS_HERE = 'Ready for mixes means a song can play on this device.';
const PLAYS_IN_A_MIX = 'Ready for mixes means a song can play in a mix. Songs in your cloud library are prepared ahead of time;';

const DEVICE_WORK: Record<DeviceWork, string> = {
  none: 'SelectaDJ works out each transition in your browser as the mix plays, so nothing is prepared in advance.',
  songs: 'SelectaDJ prepares each song in the background on this device, learning its tempo, key and beats, and works out each transition as the mix plays.',
  transitions: 'While a mix plays, SelectaDJ makes the next transitions on this device ahead of time, so each one is ready before you hear it.',
  all: 'SelectaDJ prepares each song in the background on this device, learning its tempo, key and beats, and while a mix plays it makes the next transitions ahead of time.',
};

const BOTH_WORK: Record<DeviceWork, string> = {
  none: 'for songs on this device, SelectaDJ works out each transition in your browser as the mix plays.',
  songs: 'songs on this device are prepared in the background right here, and each transition is worked out as the mix plays.',
  transitions: 'for songs on this device, SelectaDJ makes the next transitions here ahead of time while the mix plays.',
  all: 'songs on this device are prepared in the background right here, and the next transitions are made ahead of time while the mix plays.',
};

/** The readiness sentence for music on this device, for what this device does ahead. */
export function readyMeaning(where: 'device' | 'both', work: DeviceWork): string {
  return where === 'device' ? `${PLAYS_HERE} ${DEVICE_WORK[work]}` : `${PLAYS_IN_A_MIX} ${BOTH_WORK[work]}`;
}

function deviceWork(): DeviceWork {
  const songs = flagListed('cloud.device_analysis');
  const transitions = flagListed('cloud.device_render');
  if (songs && transitions) return 'all';
  if (songs) return 'songs';
  return transitions ? 'transitions' : 'none';
}

/** The sentences that differ: songs in the cloud library are measured and rendered by SelectaDJ's
 * workers; songs on this device are worked on by this browser and never uploaded. */
const cloudByHome: Record<MusicHome, Record<HomeKey, string>> = {
  cloud_library: {
    glossaryRendered: 'Made into finished audio by SelectaDJ Cloud, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
    glossaryRender: 'Making a transition into audio. SelectaDJ Cloud does it in the background. Your jobs wait their turn within your account, and the current mix always goes first. Drafts and word links being prepared wait behind it.',
    glossaryStems: 'A song split into four parts: voice, drums, bass and melody (everything else). SelectaDJ Cloud separates them, so a transition can bring parts in and out on their own.',
    glossaryAnalysis: 'SelectaDJ Cloud listening to a song to find its tempo, key, beats, bars, sections and energy, and, from its lyrics where they’re found, where the singing is. It never changes your original file.',
    setupAnalysis: 'Measures each song’s tempo, key, beats and sections, in SelectaDJ Cloud.',
    startAudioStays: 'Your audio stays private to your workspace.',
    startFolderHelp: 'Choose your music files or a folder to upload. Your original files on this device are never moved or changed.',
    sourcesHelp: `Add music by uploading files. Your audio stays private to your workspace. ${LYRICS_LOOKUP}`,
    libraryReadyMeaning: 'Analysed means audio has been measured. Ready for mixes means a song has the cues needed to plan a mix; it does not mean transitions are already rendered.',
  },
  device: {
    glossaryRendered: 'Made into finished audio in this browser, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
    glossaryRender: 'Making a transition into audio. For songs on this device, this browser does it, and the audio never leaves the device.',
    glossaryStems: 'A song split into four parts: voice, drums, bass and melody (everything else). For songs on this device, this browser separates them where the device can, so a transition can bring parts in and out on their own.',
    glossaryAnalysis: 'SelectaDJ measuring a song in this browser to find its tempo, key, beats, bars, sections and energy. The audio stays on this device, and the file is never changed.',
    setupAnalysis: 'Measures each song’s tempo, key, beats and sections, in this browser.',
    startAudioStays: 'Your audio stays on this device.',
    startFolderHelp: 'Choose a music folder on this device. Your files stay where they are: they are never uploaded, moved or changed.',
    sourcesHelp: `Add music by choosing a folder on this device. Your audio stays on this device. ${LYRICS_LOOKUP}`,
    libraryReadyMeaning: readyMeaning('device', 'none'),
  },
  both: {
    glossaryRendered: 'Made into finished audio, by SelectaDJ Cloud for songs in your cloud library and by this browser for songs on this device, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
    glossaryRender: 'Making a transition into audio. For songs in your cloud library, SelectaDJ Cloud does it in the background: your jobs wait their turn within your account, and the current mix always goes first. For songs on this device, this browser does it.',
    glossaryStems: 'A song split into four parts: voice, drums, bass and melody (everything else). SelectaDJ Cloud separates songs in your cloud library, and this browser separates songs on this device where the device can, so a transition can bring parts in and out on their own.',
    glossaryAnalysis: 'SelectaDJ listening to a song to find its tempo, key, beats, bars, sections and energy: SelectaDJ Cloud for songs in your cloud library, this browser for songs on this device. It never changes your original file.',
    setupAnalysis: 'Measures each song’s tempo, key, beats and sections, in SelectaDJ Cloud, or in this browser for songs on this device.',
    startAudioStays: 'Songs you upload stay private to your workspace, and songs on this device stay on it.',
    startFolderHelp: 'Choose music files or a folder to upload, or a folder that stays on this device. Your original files on this device are never moved or changed.',
    sourcesHelp: `Add music by uploading files, or by choosing a folder on this device. Uploaded audio stays private to your workspace, and audio on this device stays on it. ${LYRICS_LOOKUP}`,
    libraryReadyMeaning: readyMeaning('both', 'none'),
  },
};

const cloudWords = (home: MusicHome): Record<CopyKey, string> => ({ ...cloudShared, ...cloudByHome[home] });

export const copy: { desktop: Record<CopyKey, string>; cloud: Record<MusicHome, Record<CopyKey, string>> } = {
  desktop,
  cloud: { cloud_library: cloudWords('cloud_library'), device: cloudWords('device'), both: cloudWords('both') },
};

/** `cloud.move_to_cloud` (ADR-0489): the 'both' sentences for an account that can upload songs
 * from this device to its cloud library. Every other account keeps the words above, word for
 * word. The file on the device is never moved or changed, so that promise stays. */
export const UPLOADING_FROM_DEVICE: Readonly<Partial<Record<HomeKey, string>>> = {
  startAudioStays: 'Songs you upload to your cloud library are copied there and stay private to your workspace; the file on this device stays as it is.',
  startFolderHelp: 'Choose music files or a folder to upload, or a folder that stays on this device. Songs you upload to your cloud library are copied there. Your original files on this device are never moved or changed.',
  sourcesHelp: `Add music by uploading files, or by choosing a folder on this device. Songs you upload to your cloud library are copied there and stay private to your workspace; the file on this device stays as it is. ${LYRICS_LOOKUP}`,
};

/** MUSIC_HOME_START.both.privacy for the same accounts. */
export const UPLOADING_FROM_DEVICE_PRIVACY = 'Music you connect from this device stays on this device. Songs you upload to your cloud library are copied there, and the file on this device stays as it is. Your cloud library stays available in SelectaDJ.';

let place: Place = 'desktop';
let home: MusicHome = 'cloud_library';
let uploadsFromDevice = false;

/** Called once the Cloud account says whether it can upload from this device (the account's
 * `cloud.move_to_cloud`, which needs the cloud library grant). */
export function setUploadsFromDevice(on: boolean) {
  uploadsFromDevice = on;
}

/** Called once the server has said which place this is. */
export function setCopyPlace(next: Place) {
  place = next;
}

export function copyPlace(): Place {
  return place;
}

/** Called once the Cloud account says where its music lives. */
export function setMusicHome(next: MusicHome) {
  home = next;
}

export function musicHome(): MusicHome {
  return home;
}

/** Where an account's music lives, from what it holds: songs on its devices, a cloud library. */
export function musicHomeOf(onDevice: boolean, inCloudLibrary: boolean): MusicHome | 'none' {
  if (onDevice && inCloudLibrary) return 'both';
  if (onDevice) return 'device';
  return inCloudLibrary ? 'cloud_library' : 'none';
}

/** The words that are true here. */
export function words(): Record<CopyKey, string> {
  if (place === 'desktop') return copy.desktop;
  if (home === 'cloud_library') return copy.cloud[home];
  // what this device prepares ahead follows its two switches, so the sentence does too
  const uploading = home === 'both' && uploadsFromDevice ? UPLOADING_FROM_DEVICE : {};
  return { ...copy.cloud[home], ...uploading, libraryReadyMeaning: readyMeaning(home, deviceWork()) };
}

/** The Cloud start card: how to begin, and what happens to the music, for where it lives. */
export const MUSIC_HOME_START: Readonly<Record<MusicHome | 'none', { heading: string; privacy: string }>> = {
  both: {
    heading: 'Use music on this device or in your cloud library',
    privacy: 'Music you connect from this device stays on this device. Your cloud library stays available in SelectaDJ.',
  },
  device: {
    heading: 'Use music on this device',
    privacy: 'Your music stays on this device. SelectaDJ Cloud keeps only the details needed for your library and mixes.',
  },
  cloud_library: {
    heading: 'Use your cloud library',
    privacy: 'Your cloud library stays available in SelectaDJ.',
  },
  none: {
    heading: 'Connect music to begin',
    privacy: 'SelectaDJ has not been given access to music for this account.',
  },
};

/** The start card's words; `uploading` is the account's `cloud.move_to_cloud`. */
export function musicHomeStart(source: MusicHome | 'none', uploading: boolean): { heading: string; privacy: string } {
  const found = MUSIC_HOME_START[source];
  return source === 'both' && uploading ? { ...found, privacy: UPLOADING_FROM_DEVICE_PRIVACY } : found;
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

/** A transition the account's planner chose (cloud/accountSeams.ts), as the editor says why it
 * played: the same words whatever the move, because the move's own name is said beside them. */
export const PLANNED_TRANSITION_WHY = 'Planned from how both songs are built: their beats, bars, key and energy.';
