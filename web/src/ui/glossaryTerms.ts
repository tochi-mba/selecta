import { Gate, gateOpen } from '../flags';

/** Music and Selecta words, in plain language, with what each one changes and how to take it back.
 * Every claim here is about what this app really does. Nothing in it starts sound, changes a mix or
 * talks to the server: it's words only, kept in the page. */

export type GlossaryTerm = {
  id: string;
  term: string;
  /** Other words someone might search for. */
  aka?: string[];
  /** What it is, in a sentence or two. */
  plain: string;
  /** What changing it does, and to which mix. */
  effect?: string;
  /** Whether, and how, it can be taken back. */
  reversible?: string;
  related?: string[];
};

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: 'current-mix',
    term: 'Current mix',
    aka: ['the mix', 'playing mix', 'what’s playing'],
    plain: 'The one mix Selecta plays from. Listen, the player and requests always follow it, and there is only ever one.',
    effect: 'Adding, removing, swapping or reordering songs in it changes what plays next.',
    reversible: 'Most changes can be undone, newest first, from the message that appears or from Activity.',
    related: ['draft', 'undo'],
  },
  {
    id: 'draft',
    term: 'Draft',
    aka: ['saved mix', 'my mixes'],
    plain: 'A mix kept in My Mixes that isn’t playing. You can edit it without touching what’s playing.',
    effect: 'Playing a draft replaces the current mix. If something is playing, Selecta asks first, and what was playing is kept in your drafts.',
    reversible: 'Switching to a draft can be undone. Each draft has its own Undo, separate from the current mix.',
    related: ['current-mix', 'undo'],
  },
  {
    id: 'song',
    term: 'Song',
    aka: ['recording', 'recording ID', 'song ID', 'track'],
    plain: 'One audio file in your library. Each has a number, its recording ID, so two songs with the same title and artist can be told apart. Where titles repeat, Selecta adds the number, like “(song 42)”.',
    effect: 'Selecta never moves, renames or changes your audio files.',
    related: ['analysis'],
  },
  {
    id: 'transition',
    term: 'Transition',
    aka: ['seam', 'hand-off', 'hand-over', 'blend', 'mix point'],
    plain: 'The stretch where one song becomes the next. Selecta calls the join between two songs a seam, and makes each one into a finished piece of audio before it plays.',
    effect: 'While a transition is playing you can’t move around in the song, because it plays as one finished piece.',
    related: ['move', 'render', 'fallback'],
  },
  {
    id: 'move',
    term: 'Move',
    aka: ['transition style', 'technique', 'style', 'echo out', 'filter sweep', 'cut'],
    plain: 'How a transition is done: for example a blend, a cut, an echo out or a hand-off on a shared word. Some moves need something a pair of songs may not have, like a steady beat or a shared word, so they can be greyed out with the reason.',
    effect: 'Choosing a move changes that one transition in that mix, and it is rendered again.',
    reversible: 'Undo in that mix takes it back.',
    related: ['transition', 'requested', 'fallback'],
  },
  {
    id: 'requested',
    term: 'Requested',
    aka: ['asked for', 'chosen', 'you asked for'],
    plain: 'For a transition, what you asked for: the move, length or cues you picked, or Selecta’s choice if you left it. Asking makes no audio. It stays a plan until it is rendered. (A song request is different: see Request.)',
    related: ['planned', 'rendered', 'heard', 'request'],
  },
  {
    id: 'planned',
    term: 'Planned',
    aka: ['not rendered yet', 'in line', 'plan'],
    plain: 'Part of the mix’s order and settings, but not made into audio yet. You’ll see “Not rendered yet” or “In line”. What plays can still change.',
    related: ['requested', 'rendered', 'render'],
  },
  {
    id: 'rendered',
    term: 'Rendered',
    aka: ['ready', 'made'],
    plain: 'Made into finished audio on this PC, and checked for problems a measurement can find. “Ready” means the audio exists. It doesn’t mean it sounds good: only listening can tell you that.',
    related: ['planned', 'heard', 'render'],
  },
  {
    id: 'heard',
    term: 'Heard',
    aka: ['what will play', 'what plays'],
    plain: 'What actually comes out of the speakers. Usually that’s what was rendered. If a transition isn’t ready in time, you hear the fallback instead, and the page says so.',
    related: ['rendered', 'fallback'],
  },
  {
    id: 'fallback',
    term: 'Fallback',
    aka: ['fell back', 'falls back', 'fade in', 'wouldn’t work here'],
    plain: 'What happens when the transition you chose can’t be used. If it isn’t ready when the mix gets there, the song plays on and the next one fades in, so the music doesn’t stop. If a move can’t be made for that pair, Selecta uses its own pick and shows “You asked for … What will play is …”.',
    reversible: 'You can choose another move in Edit.',
    related: ['heard', 'move'],
  },
  {
    id: 'render',
    term: 'Render',
    aka: ['rendering', 'render line', 'in line', 'queue', 'line'],
    plain: 'Making a transition into audio. It happens on this PC in the background. Jobs wait their turn in the render line, and the current mix always goes first. Drafts and word links being prepared wait behind it.',
    effect: 'Rendering never changes your music files. What it makes can be cleared to save space and made again.',
    related: ['planned', 'rendered'],
  },
  {
    id: 'export',
    term: 'Export',
    aka: ['download audio', 'FLAC', 'save as a file', 'download'],
    plain: 'Saving a whole mix as one FLAC audio file. FLAC is lossless, so it keeps full quality.',
    effect: 'An export is made from a frozen copy of the mix at that moment, so later edits don’t change a file already being made. It doesn’t change the mix or your music.',
    reversible: 'A running export can be cancelled.',
    related: ['frozen-revision'],
  },
  {
    id: 'frozen-revision',
    term: 'Frozen revision',
    aka: ['revision', 'revision ID', 'snapshot', 'frozen'],
    plain: 'The exact song order and transitions an export was made from, with a short ID. Two exports of the same mix with different IDs were made from different versions of it.',
    related: ['export'],
  },
  {
    id: 'stems',
    term: 'Stems',
    aka: ['stem', 'parts', 'separation', 'vocals', 'drums', 'bass', 'melody'],
    plain: 'A song split into four parts: voice, drums, bass and melody (everything else). Selecta separates them on this PC, so a transition can bring parts in and out on their own.',
    effect: 'Separating a pair takes a few minutes the first time. The parts are kept in Selecta’s own storage, which can be cleared and made again. Your files aren’t touched.',
    related: ['studio-lane', 'priority'],
  },
  {
    id: 'studio-lane',
    term: 'Studio lane',
    aka: ['lane', 'studio', 'stem studio', 'part'],
    plain: 'One row in the Studio: one part (voice, drums, bass or melody) of one of the two songs. There are eight lanes: four for the song going out and four for the song coming in.',
    related: ['studio-cell', 'solo', 'stems'],
  },
  {
    id: 'studio-cell',
    term: 'Cell',
    aka: ['square', 'studio cell', 'grid square'],
    plain: 'One square in a Studio lane, covering the same few bars of the transition. On means that part plays there. Off means it’s silent there.',
    effect: 'Changing cells changes only your working copy, kept in this browser, until you choose Apply.',
    reversible: 'Start again goes back to what’s applied.',
    related: ['studio-lane', 'applied'],
  },
  {
    id: 'solo',
    term: 'Solo',
    aka: ['hear only', 'soloed', 'hear everything'],
    plain: 'Hearing just one part during a Studio preview, with the other seven silent. It only changes what you hear in the preview, not the transition.',
    reversible: 'Press it again, or Hear everything again.',
    related: ['studio-lane'],
  },
  {
    id: 'suggestion',
    term: 'Selecta’s suggestion',
    aka: ['AI suggestion', 'proposal', 'proposed', 'Let Selecta arrange it', 'Fine tune mine', 'arrange'],
    plain: 'In the Studio, Let Selecta arrange it and Fine tune mine ask Selecta to propose a set of cells. It works this out on this PC from what it measures in the stems and what you’ve rated. Nothing is sent online. It’s only a proposal: it changes your working copy, and lists each cell it changed.',
    effect: 'Nothing reaches the mix until you choose Apply.',
    reversible: 'Put it back restores the working copy you had before.',
    related: ['applied', 'studio-cell'],
  },
  {
    id: 'applied',
    term: 'Applied',
    aka: ['apply', 'apply to this transition'],
    plain: 'Apply to this transition saves your Studio cells to that one transition, in the mix you opened the Studio from, and starts rendering it. It plays in the mix once that render is ready.',
    effect: 'Only that transition changes. If the mix changed meanwhile, nothing is applied and your cells stay in the Studio.',
    reversible: 'Undo in that mix takes it back.',
    related: ['suggestion', 'render'],
  },
  {
    id: 'request',
    term: 'Request',
    aka: ['song request', 'requested song', 'ask for a song'],
    plain: 'A song you ask for while a mix plays. A request is saved, not scheduled: Selecta looks for a spot where it fits and only adds it once its transitions are ready. There’s no promised play time or queue order.',
    effect: 'When a request joins, it changes the current mix.',
    reversible: 'Cancel it any time before it joins. Once it has joined, Undo takes it back.',
    related: ['bridge', 'requested'],
  },
  {
    id: 'bridge',
    term: 'Bridge',
    aka: ['bridge song', 'extra song', 'extra songs', 'route', 'consent'],
    plain: 'Extra songs Selecta proposes to lead from your mix into a request that doesn’t fit directly. Nothing joins until you say yes. Then they all join together once every transition is ready, or none of them do.',
    effect: 'Saying no keeps the request waiting for a spot where it fits directly.',
    reversible: 'Before it joins you can cancel or choose Don’t use a bridge. After it joins, Undo takes it back.',
    related: ['request'],
  },
  {
    id: 'steering',
    term: 'Steering',
    aka: ['Bigger', 'Calmer', 'Something else', 'swap', 'change what plays next'],
    plain: 'The Bigger, Calmer and Something else buttons on Listen. Each swaps the next song for one with more energy, less energy, or just a different one that still fits.',
    effect: 'It changes the current mix: the next song is replaced and its transition is made again.',
    reversible: 'Undo puts the previous song back.',
    related: ['measured-energy', 'current-mix'],
  },
  {
    id: 'energy-arc',
    term: 'Energy arc',
    aka: ['energy shape', 'intended energy', 'arc'],
    plain: 'The shape you’d like a mix’s energy to follow, drawn in Shape the next mix. It’s an intention: Selecta aims for it as closely as your songs allow.',
    effect: 'It shapes mixes built from then on. It doesn’t rearrange a mix that already exists.',
    reversible: 'Use each mix’s arc turns it off.',
    related: ['measured-energy'],
  },
  {
    id: 'measured-energy',
    term: 'Measured energy',
    aka: ['energy', 'song energy'],
    plain: 'How energetic each song measured during analysis. Selecta shows it relative to the other songs in the same mix, on a different scale from the energy arc, so the two are never compared number for number. It isn’t a quality score.',
    related: ['energy-arc', 'steering', 'analysis'],
  },
  {
    id: 'bpm',
    term: 'BPM',
    aka: ['tempo', 'beats per minute', 'speed'],
    plain: 'Beats per minute: how fast a song’s beat is. It measures speed, not energy. Selecta measures it during analysis.',
    reversible: 'If it’s wrong, you can correct it in a song’s details, and clear your correction later.',
    related: ['beat-grid', 'key'],
  },
  {
    id: 'key',
    term: 'Key',
    aka: ['Camelot', 'musical key', 'tonal centre'],
    plain: 'A song’s tonal centre. Selecta shows it in Camelot notation, like 8A, where neighbouring numbers usually sit well together. A matching key is a hint, not proof that two songs sound good together.',
    reversible: 'If it’s wrong, you can correct it in a song’s details, and clear your correction later.',
    related: ['bpm', 'harmonic-match'],
  },
  {
    id: 'bar',
    term: 'Bar',
    aka: ['bars', 'measure', 'phrase'],
    plain: 'A group of beats, usually four. Transitions are measured in bars, like an 8-bar blend.',
    related: ['beat-grid', 'cue'],
  },
  {
    id: 'beat-grid',
    term: 'Beat grid',
    aka: ['grid', 'beats', 'downbeat'],
    plain: 'Where every beat and bar falls in a song, found during analysis. Transitions and the countdown on Listen line up to it. If a song’s beat isn’t steady enough, some moves may be greyed out, and times are shown in minutes and seconds instead.',
    related: ['bar', 'bpm'],
  },
  {
    id: 'cue',
    term: 'Cue',
    aka: ['exit', 'entry', 'exit cue', 'entry cue', 'leave at', 'bring in at'],
    plain: 'A point where a transition can start or end. The exit is where the outgoing song is left; the entry is where the next song comes in. Selecta finds safe ones from the analysed bars and sections. For moves that use them, you can pick exact ones in Edit.',
    effect: 'Choosing a cue changes that transition, and it is rendered again.',
    reversible: 'Wherever’s best goes back to Selecta’s choice, and Undo works too.',
    related: ['bar', 'transition'],
  },
  {
    id: 'word-link',
    term: 'Word link',
    aka: ['word connection', 'shared words', 'word hand-off', 'lyrics link'],
    plain: 'Two songs joined on the same words: one ends a line on them and the next opens a line with them, and the music fits too. They’re found from lyrics.',
    effect: 'Adding a link puts both songs and their transition into the mix you choose.',
    reversible: 'Undo in that mix takes it back.',
    related: ['harmonic-match', 'transition'],
  },
  {
    id: 'harmonic-match',
    term: 'Harmonic match',
    aka: ['harmonic link', 'chords', 'chord match', 'shared chords'],
    plain: 'Two songs that may share a chord pattern. You hear the chords Selecta detected, then each song with them underneath, then both. Your Yes or No only teaches Selecta what you hear. It never adds anything to a mix.',
    reversible: 'You can change an answer later.',
    related: ['key', 'word-link'],
  },
  {
    id: 'analysis',
    term: 'Analysis',
    aka: ['analysed', 'analysing', 'analyse'],
    plain: 'Selecta listening to a song on this PC to find its tempo, key, beats, bars, sections and energy, and, from its lyrics where they’re found, where the singing is. It never changes the audio file.',
    effect: 'Songs are analysed in the background. Priority songs go first.',
    related: ['mix-ready', 'priority'],
  },
  {
    id: 'mix-ready',
    term: 'Mix-ready',
    aka: ['readiness', 'ready for mixes', 'not ready for mixes'],
    plain: 'A song Selecta knows well enough to pick for mixes and start a mix from. A song can be analysed and still not be mix-ready. The Library says why.',
    related: ['analysis'],
  },
  {
    id: 'set-aside',
    term: 'Set aside',
    aka: ['not music', 'this isn’t music'],
    plain: 'Something in your music folder that Selecta decided isn’t music, so it isn’t analysed or mixed. Nothing is moved or deleted.',
    reversible: 'Choose This is music in its details, or Let Selecta decide again.',
    related: ['never-play'],
  },
  {
    id: 'never-play',
    term: 'Never play',
    aka: ['never', 'excluded', 'never plays'],
    plain: 'A song you’ve told Selecta never to pick when it builds a mix. It stays in your library and its file isn’t touched. A request for it waits until you change this.',
    reversible: 'Turn it off in the Library any time.',
    related: ['set-aside', 'priority'],
  },
  {
    id: 'priority',
    term: 'Priority',
    aka: ['prioritize', 'priority list'],
    plain: 'Songs on the priority list are analysed first, and their stems are kept when Selecta clears space.',
    reversible: 'Remove priority any time.',
    related: ['analysis', 'stems'],
  },
  {
    id: 'undo',
    term: 'Undo and Activity',
    aka: ['undo', 'activity', 'history', 'take back'],
    plain: 'Undo takes back the newest change in one mix. The current mix and each draft have their own. Activity lists recent changes in this window and keeps their Undo, so it isn’t lost when a message fades.',
    effect: 'Only the newest change in each mix can be undone, so an older entry says why it has to wait.',
    related: ['current-mix', 'draft'],
  },
  {
    id: 'local-only',
    term: 'Local-only',
    aka: ['privacy', 'LRCLIB', 'lyrics lookup', 'online', 'offline', 'cloud'],
    plain: 'Your music, analysis, mixes, ratings and renders stay on this PC. There’s no account and no cloud. To find lyrics, Selecta sends each song’s artist, title, album and duration to LRCLIB, a public lyrics service. The audio itself never leaves this PC, and nothing else about your music is sent anywhere.',
    related: ['analysis'],
  },
];

const BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));

/** Terms for features a build can leave out. A term whose feature is off isn't explained anywhere,
 * because nothing on screen can use the word. */
const TERM_FLAGS: Record<string, Gate> = {
  draft: { flag: 'drafts' },
  export: { flag: 'export' },
  'frozen-revision': { flag: 'export' },
  stems: { flag: 'stems' },
  'studio-lane': { flag: 'stem_studio' },
  'studio-cell': { flag: 'stem_studio' },
  solo: { flag: 'stem_studio' },
  suggestion: { flag: 'stem_studio.auto_arrange' },
  applied: { flag: 'stem_studio' },
  request: { flag: 'requests' },
  bridge: { flag: 'requests.bridges' },
  steering: { flag: 'listen.steering' },
  'energy-arc': { flag: 'mixes.shaping.energy_arc' },
  'word-link': { flag: 'discover.word_links' },
  'harmonic-match': { flag: 'discover.harmonic' },
  'never-play': { flag: 'library.never_play' },
  priority: { flag: 'library.priority' },
};

const termOn = (entry: GlossaryTerm) => !TERM_FLAGS[entry.id] || gateOpen(TERM_FLAGS[entry.id]);

/** How a term reads in a build without a feature it mentions. The term itself stays, because what
 * it explains is still true, but it says nothing about the feature that's gone. */
const TERM_WITHOUT: Record<string, { gate: Gate; reads: Partial<GlossaryTerm> }[]> = {
  'local-only': [{
    gate: { flag: 'lyrics.lookup' },
    reads: {
      aka: ['privacy', 'online', 'offline', 'cloud'],
      plain: 'Your music, analysis, mixes, ratings and renders stay on this PC. There’s no account and no cloud. The audio itself never leaves this PC, and nothing about your music is sent anywhere.',
    },
  }],
};

const asBuilt = (entry: GlossaryTerm): GlossaryTerm =>
  (TERM_WITHOUT[entry.id] ?? []).reduce((term, { gate, reads }) => (gateOpen(gate) ? term : { ...term, ...reads }), entry);

/** The terms this build has, as this build says them. */
export function glossaryOn(): GlossaryTerm[] {
  return GLOSSARY.filter(termOn).map(asBuilt);
}

export function glossaryTerm(id: string): GlossaryTerm | undefined {
  const entry = BY_ID.get(id);
  return entry && termOn(entry) ? asBuilt(entry) : undefined;
}

/** Case and accents don't matter, so “cafe” finds “café” and curly quotes match straight ones. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}

/** Every word has to appear in the term, another name for it, or what it says. Name matches first. */
export function searchGlossary(query: string, terms: GlossaryTerm[] = glossaryOn()): GlossaryTerm[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return terms;
  return terms
    .map((entry, index) => {
      const name = foldText([entry.term, ...(entry.aka ?? [])].join(' '));
      const text = `${name} ${foldText([entry.plain, entry.effect ?? '', entry.reversible ?? ''].join(' '))}`;
      if (!words.every((word) => text.includes(word))) return null;
      const rank = foldText(entry.term).startsWith(words[0]) ? 0 : words.every((word) => name.includes(word)) ? 1 : 2;
      return { entry, rank, index };
    })
    .filter((row): row is { entry: GlossaryTerm; rank: number; index: number } => row !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}
