import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WORK_WORDS } from '../state/workState';
import { LifecyclePill, type Lifecycle } from '../views/LucyProposal';
import { foldText, GLOSSARY, searchGlossary } from './glossaryTerms';

/** UF-0388-05 (code half): ready, analysed, proposed, queued, saved and playing each have one
 * meaning, one glossary entry that explains it, and the same word wherever the app shows it. The
 * copy audit and task study that confirm people read them that way are a person's. */

/** Ready has two scoped meanings, each its own entry: a song that is mix-ready, and a transition
 * that is rendered. Every other word has exactly one. */
const TERMS: Record<string, string[]> = {
  ready: ['rendered', 'mix-ready'],
  analysed: ['analysis'],
  proposed: ['proposal'],
  queued: ['planned'],
  saved: ['draft'],
  playing: ['current-mix'],
};

const names = (id: string) => {
  const entry = GLOSSARY.find((term) => term.id === id)!;
  return [entry.term, ...(entry.aka ?? [])].map(foldText);
};
const wholeWord = (word: string, text: string) => new RegExp(`(^|[^a-z-])${word}($|[^a-z-])`).test(text);

describe('UF-0388-05 lifecycle words', () => {
  it('each word is named only by the glossary entries that explain it', () => {
    for (const [word, ids] of Object.entries(TERMS)) {
      const owners = GLOSSARY.filter((entry) => names(entry.id).some((name) => wholeWord(word, name)));
      expect(owners.map((entry) => entry.id), word).toEqual(ids);
      expect(ids, `searching ${word}`).toContain(searchGlossary(word, GLOSSARY)[0]?.id);
    }
  });

  it('a proposal and Selecta’s Studio suggestion are different things with different words', () => {
    expect(names('suggestion').some((name) => name.includes('propos'))).toBe(false);
    expect(GLOSSARY.find((entry) => entry.id === 'proposal')!.plain).toMatch(/nothing is built, rendered or played/);
  });

  it('Lucy’s lifecycle pill shows the same word for each stage', () => {
    const expected: Record<Lifecycle, RegExp> = {
      proposed: /^Proposed/, approved: /^Approved/, draft: /Saved draft/, rendering: /^Rendering/, ready: /^Ready/, playing: /^Playing$/,
    };
    for (const [stage, words] of Object.entries(expected) as [Lifecycle, RegExp][]) {
      const { unmount } = render(<LifecyclePill stage={stage} />);
      expect(screen.getByText(words)).toBeInTheDocument();
      unmount();
    }
  });

  it('the shared work words say queued and ready the way the glossary does, and each state differently', () => {
    expect(WORK_WORDS.queued.words.toLowerCase()).toContain('in line');
    expect(names('planned')).toContain('waiting in line');
    expect(WORK_WORDS.ready.words).toBe('Ready');
    const said = Object.values(WORK_WORDS).map((state) => state.words);
    expect(new Set(said).size).toBe(said.length);
  });
});
