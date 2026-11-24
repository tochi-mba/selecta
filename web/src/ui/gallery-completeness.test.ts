import { describe, expect, it } from 'vitest';
import { readSource, SOURCE_FILES } from '../test/sheets';
import { GALLERY_KINDS, GALLERY_SKELETONS } from './gallery/specimens';

/**
 * BF overhaul W6: the galleries are complete. Every export of a ui/ module appears in the local
 * gallery (ui/ControlGallery.tsx and ui/gallery/*, Workspace > Diagnostics in a DEV or
 * VITE_SELECTA_GALLERY=1 build) or the cloud harness gallery (harness/CloudGallery.tsx,
 * `/harness?page=gallery`), or is named below with the reason it is not a specimen. A component
 * has to be drawn (`<Name`), not just imported. A new ui/ export fails here until it is shown or
 * explained, so the gallery cannot quietly fall behind the components (the gap ADR-0462 BF-0462-07
 * used to claim was closed).
 */
const GALLERIES = [
  'ui/ControlGallery.tsx',
  ...SOURCE_FILES.filter((file) => file.startsWith('ui/gallery/') && file.endsWith('.tsx') && !file.includes('.test.')),
  'harness/CloudGallery.tsx',
];
const shown = GALLERIES.map(readSource).join('\n');

const MODULES = SOURCE_FILES.filter((file) => /^ui\/[^/]+\.tsx?$/.test(file) && !file.includes('.test.') && file !== 'ui/ControlGallery.tsx');

/** Exports that are not specimens, and why. Hooks, data helpers and app-level switches are used by
 * the components shown; they have no look of their own. */
const NOT_SHOWN: Record<string, string> = {
  // ui/AudioPreview.tsx
  AudioPreview: 'plays a real song preview; the gallery holds no audio, so it is inspected on Links and Requests',
  // ui/ConfirmDialog.tsx
  CONFIRM_COPY: 'the default words; every ConfirmDialog specimen without its own labels shows them',
  // ui/controls.tsx
  // ui/exitMotion.ts
  motionMs: 'reads a motion token; drives every exit shown here', playExit: 'drives the toast exit shown here', exitGhost: 'drives the overlay exits shown here', usePresence: 'drives the menu, popover and tooltip exits shown here',
  // ui/focusReturn.ts
  hadNoRealFocus: 'focus bookkeeping behind every overlay shown here', pageStart: 'route focus, outside any one component', returnFocus: 'focus bookkeeping behind every overlay shown here',
  // ui/format.ts
  ELLIPSIS: 'the character ellipsize and Truncate use', userLocale: 'the locale relativeTime and countOf use',
  // ui/Glossary.tsx
  GlossaryHost: 'mounted once by the app frame; a second host would open the glossary twice. TermHint and GlossaryDialog are shown',
  // ui/glossaryTerms.ts
  GLOSSARY: 'the glossary words, shown through GlossaryDialog', glossaryOn: 'a flag check', glossaryTerm: 'a lookup', foldText: 'search folding', searchGlossary: 'search behind GlossaryDialog',
  // ui/Icon.tsx
  ICON_NAMES: 'the glyph list; docs/engineering/icon-inventory.md and icon-geometry.test.ts own it', ICON_SLOTS: 'the slot sizes, checked by icon-geometry.test.ts', ICON_STROKES: 'the slot strokes, checked by icon-geometry.test.ts',
  // ui/lowPower.ts
  SLOW_FRAME_MS: 'low-power tuning', WINDOW_FRAMES: 'low-power tuning', SLOW_SHARE: 'low-power tuning', REST_MS: 'low-power tuning', struggling: 'low-power detection',
  lowPowerActive: 'low-power state', useLowPower: 'low-power hook', keepFullMotion: 'low-power preference', watchLowPower: 'low-power watcher started by the app', resetLowPower: 'test reset',
  // ui/Meter.tsx
  meterTone: 'the threshold rule behind the warning and danger meters shown here',
  // ui/MusicObjects.tsx
  seamFamily: 'classifies a move for SeamDiagram', HORIZON_STOPS: 'the five horizon stop names EnergyHorizon draws', measuredHorizon: 'data for MixHorizon', measuredEnergy: 'data for the energy objects', energySummary: 'the words the energy objects carry',
  // ui/paletteSongs.ts
  usePaletteSongs: 'the palette\'s song search, off in the specimen (no server reads)',
  // ui/primitives.tsx
  moveInGrid: 'arrow-key arithmetic for grids', VISUALLY_HIDDEN: 'the class name VisuallyHidden applies',
  // ui/seam.ts
  seamLayers: 'seam data for the inspector', seamFacts: 'seam data for the inspector',
  // ui/Skeleton.tsx
  REVEAL_AFTER_MS: 'the quiet delay every skeleton shown here waits', useRevealed: 'the hook behind that delay',
  // ui/ThemeChoice.tsx
  THEMES: 'the options ThemeMenu and ThemeChoices show',
  // ui/toasts.tsx
  setToastsQuiet: 'an app-level switch (quiet while Stage is up)', clearToasts: 'an app-level reset',
  // ui/useMediaQuery.ts, useReducedMotion.ts, useStickyClearance.ts, useVisiblePoll.ts
  useMediaQuery: 'a hook', useReducedMotion: 'a hook', scrollParent: 'layout helper', useStickyClearance: 'a hook', useVisiblePoll: 'the polling hook (state/pollingPolicy.ts)',
  // ui/format.ts
  dateWords: 'a date formatter, used by the billing notices',
  // ui/staleBuild.tsx: a deploy under an open tab, tested in staleBuild.test.tsx
  UPDATED_WORDS: 'the words of the updated panel', isChunkLoadError: 'error classification', markStale: 'sets the stale state', isStale: 'reads the stale state', reloadedBefore: 'reload-loop guard', reloadForUpdate: 'reloads the tab', lazyPage: 'React.lazy with a retry', listenForStaleBuilds: 'started once by main.tsx', useStale: 'a stale-state hook', StaleBuildPanel: 'shown only when a page file is gone after a deploy', VERSION_CHECK_MS: 'polling interval', useNewVersion: 'a new-build hook', UpdateLine: 'mounted once by main.tsx, shown only when a newer build is live',
};

/** Every value export of a module: functions, constants, classes and re-exported names. Types are not specimens. */
function exportsOf(file: string): string[] {
  const text = readSource(file);
  const direct = [...text.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]);
  const listed = [...text.matchAll(/^export \{([^}]+)\}/gm)].flatMap((match) => match[1].split(',').map((name) => name.trim().split(/\s+as\s+/).pop()!).filter((name) => name && !name.startsWith('type ')));
  return [...direct, ...listed];
}

const exported = MODULES.flatMap((file) => exportsOf(file).map((name) => ({ file, name })));
const isComponent = (name: string) => /^[A-Z][a-z]/.test(name);
const drawn = (name: string) => new RegExp(`<${name}[\\s/>]`).test(shown);
const mentioned = (name: string) => new RegExp(`\\b${name}\\b`).test(shown);

describe('gallery completeness', () => {
  it('reads the real ui folder and both galleries', () => {
    expect(MODULES.length).toBeGreaterThan(20);
    expect(exported.length).toBeGreaterThan(100);
    expect(GALLERIES).toContain('ui/gallery/GalleryFeedback.tsx');
  });

  it('every ui export is drawn (components) or used (helpers) in a gallery, or says why not', () => {
    const missing = exported.filter(({ name }) => !(NOT_SHOWN[name])).filter(({ name }) => (isComponent(name) ? !drawn(name) : !mentioned(name)));
    expect(missing.map(({ file, name }) => `${file}: ${name}`)).toEqual([]);
  });

  it('every reason names a real export that is not also shown, so the list cannot go stale', () => {
    const names = new Set(exported.map(({ name }) => name));
    for (const [name, why] of Object.entries(NOT_SHOWN)) {
      if (!why) continue;
      expect(names.has(name), `${name} is no longer a ui export`).toBe(true);
      expect(why.length, `${name} says why`).toBeGreaterThan(5);
      if (isComponent(name)) expect(drawn(name), `${name} is drawn, so it needs no reason`).toBe(false);
    }
  });

  it('the W2 primitives are all there: ConfirmDialog, Meter, BrandMark, VisuallyHidden, Truncate', () => {
    for (const name of ['ConfirmDialog', 'Meter', 'BrandMark', 'VisuallyHidden', 'Truncate', 'CommandPalette', 'Section', 'Toaster', 'LiveRegion']) expect(drawn(name), name).toBe(true);
    for (const helper of ['showToast', 'showProblem', 'dismissToast', 'announce']) expect(mentioned(helper), helper).toBe(true);
  });

  it('shows every status kind and every skeleton variant the types allow', () => {
    const union = (file: string, type: string) => readSource(file).match(new RegExp(`export type ${type} ?=([^;]+);`))![1].match(/'([\w-]+)'/g)!.map((item) => item.slice(1, -1)).sort();
    expect([...GALLERY_KINDS].sort()).toEqual(union('ui/controls.tsx', 'StatusKind'));
    expect(GALLERY_KINDS).toHaveLength(11);
    expect([...GALLERY_SKELETONS].sort()).toEqual(union('ui/Skeleton.tsx', 'SkeletonVariant'));
    expect(GALLERY_SKELETONS).toHaveLength(10);
  });

  it('shows compact density, every overlay kind and exits, and mounts both galleries', () => {
    expect(shown).toMatch(/className="[^"]*\bdensity\b[^"]*" data-density="compact"/);
    for (const overlay of ['Dialog', 'Drawer', 'Sheet', 'Workspace', 'Menu', 'Tooltip', 'Popover']) expect(drawn(overlay), overlay).toBe(true);
    const gallery = readSource('ui/ControlGallery.tsx');
    for (const part of ['GalleryFeedback', 'GalleryParts', 'GalleryMusic']) expect(gallery, part).toContain(`<${part} />`);
    expect(readSource('harness/main.tsx')).toMatch(/params\.get\('page'\) === 'gallery' \? <CloudGallery \/>/);
  });
});
