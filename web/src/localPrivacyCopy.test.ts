import { afterEach, describe, expect, it } from 'vitest';
import { copy, CopyKey, setCopyMode, words } from './copy';
import { FLAG_IDS, setFlags } from './flags';
import { glossaryOn } from './ui/glossaryTerms';

// SC-0391-03: local-mode privacy wording is unchanged by Selecta Cloud work. Every sentence below
// is copied verbatim from web/src at a22571d, the last commit on main before the Cloud programme
// started (29fe620 accepted ADR-0391 to ADR-0416). Change one only by deciding, on purpose, that
// the local app's privacy promise changes; a Cloud change must never need to touch this file.

const PRE_CLOUD: Partial<Record<CopyKey, string>> = {
  glossaryPrivacy: 'Your music, analysis, mixes, ratings and renders stay on this PC. There’s no account and no cloud. To find lyrics, Selecta sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service. The audio itself never leaves this PC, and nothing else about your music is sent anywhere.',
  glossaryArrange: 'In the Studio, Let Selecta arrange it and Fine tune mine ask Selecta to propose a set of cells. It works this out on this PC from what it measures in the stems and what you’ve rated. Nothing is sent online. It’s only a proposal: it changes your working copy, and lists each cell it changed.',
  glossaryAnalysis: 'Selecta listening to a song on this PC to find its tempo, key, beats, bars, sections and energy, and, from its lyrics where they’re found, where the singing is. It never changes the audio file.',
  lucyRunsOutside: 'which runs outside this computer.',
  lucyBuiltinStays: 'The built-in planner runs on this computer. No data leaves it.',
  lucyUsingBuiltin: 'Using the built-in planner on this computer. No data leaves it.',
  lucyMemoryNothingSent: 'Nothing. With the built-in planner, nothing leaves this computer.',
  lucyBuiltinLabel: 'Built-in (on this computer, no AI service)',
  lucyBuiltinAbout: 'Plans with Selecta’s own rules. Nothing leaves this computer.',
  lucyKeySavedHere: 'Saved on this computer and never shown here again.',
  startAudioStays: 'Your audio stays on this PC.',
  startFolderHelp: 'In File Explorer, open your music folder, copy its address, and paste it here. Subfolders are included. Your original files are never moved or changed.',
  learningStaysHere: 'Rate transitions after you hear them. Your feedback stays on this PC.',
  sourcesHelp: 'Copy a folder address from File Explorer. Your audio stays on this PC. For lyric lookup, Selecta sends each song’s artist, title, album and duration to LRCLIB. That request does not upload the audio file. Selecta also communicates with its local server.',
  diagnosticsStaysHere: 'No paths or song names, and nothing is sent anywhere. It only leaves this PC if you copy it somewhere yourself.',
};

// Privacy sentences that never moved into copy.ts: they are still written in the pages themselves.
const PRE_CLOUD_IN_PAGES: Record<string, string[]> = {
  './views/LucyGate.tsx': [
    'Lucy needs your OK before it sends anything to ${status.provider.label}.',
    'Nothing is sent until you agree to exactly what would be sent.',
  ],
  './views/Mixes.tsx': ['Optional. Nothing is sent, saved or played until you choose to do it. Quick Play does not use Lucy.'],
  './views/Setup.tsx': ['Artist, title, album and duration are sent to LRCLIB to find timed lyrics. Your audio stays here.'],
  './views/Start.tsx': ['Adding a folder starts lyric lookup: artist, title, album and duration are sent to LRCLIB to find lyrics.'],
};

const pageSources = import.meta.glob('./views/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const allOn = Object.fromEntries(FLAG_IDS.map((id) => [id, true]));

afterEach(() => {
  setCopyMode('local');
  setFlags(allOn);
});

describe('local privacy wording (SC-0391-03)', () => {
  it('is word for word what the local app said before the Cloud programme', () => {
    for (const [key, text] of Object.entries(PRE_CLOUD)) expect([key, copy.local[key as CopyKey]]).toEqual([key, text]);
  });

  it('is what a local page gets, and switching to Cloud and back leaves it alone', () => {
    setCopyMode('cloud');
    setCopyMode('local');
    for (const [key, text] of Object.entries(PRE_CLOUD)) expect([key, words()[key as CopyKey]]).toEqual([key, text]);
  });

  it('still reads the same in the pages that write it themselves', () => {
    for (const [file, sentences] of Object.entries(PRE_CLOUD_IN_PAGES)) {
      expect(pageSources[file], file).toBeTypeOf('string');
      for (const sentence of sentences) expect([file, pageSources[file].includes(sentence)]).toEqual([file, true]);
    }
  });

  it('reaches the glossary privacy term unchanged in a local build with every feature on', () => {
    setFlags(allOn);
    expect(glossaryOn().find((term) => term.id === 'local-only')?.plain).toBe(PRE_CLOUD.glossaryPrivacy);
  });

  it('only drops the LRCLIB sentence when lyric lookup is turned off', () => {
    // The one local privacy sentence added since a22571d: the same promise without the lyric
    // lookup it no longer makes (feature-flag sweep, lyrics.lookup off).
    const withoutLookup = PRE_CLOUD.glossaryPrivacy!
      .replace(' To find lyrics, Selecta sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service.', '')
      .replace('nothing else about', 'nothing about');
    expect(copy.local.glossaryPrivacyNoLyrics).toBe(withoutLookup);
    setFlags({ ...allOn, 'lyrics.lookup': false });
    expect(glossaryOn().find((term) => term.id === 'local-only')?.plain).toBe(withoutLookup);
  });
});
