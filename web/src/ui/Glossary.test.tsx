import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPrefs } from '../state/prefs';
import { closeGlossary } from '../state/glossaryRequests';
import { GlossaryHost, TermHint } from './Glossary';
import { GLOSSARY, glossaryTerm, searchGlossary } from './glossaryTerms';

/** GP-0256: contextual music terms. Words only: reading them never plays, changes or saves. */

const SRC = join(__dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

afterEach(() => {
  act(() => { closeGlossary(); setPrefs({ termHints: true }); });
  vi.unstubAllGlobals();
});

describe('GP-0256 contextual music help', () => {
  it('GP-0256-01 every ? hint on every route names a term the glossary explains', () => {
    const used = new Set(sources(SRC).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/TermHint term="([a-z-]+)"/g)].map((match) => match[1])));
    expect(used.size).toBeGreaterThanOrEqual(10);
    for (const id of used) expect(GLOSSARY.some((entry) => entry.id === id), id).toBe(true);
    expect(new Set(GLOSSARY.map((entry) => entry.id)).size).toBe(GLOSSARY.length);
  });

  it('GP-0256-02 every term that describes an action says what it changes and whether it can be taken back', () => {
    const actions = GLOSSARY.filter((entry) => entry.effect);
    expect(actions.length).toBeGreaterThanOrEqual(10);
    // Undo is the taking-back itself, so it explains its own limits instead
    const missing = actions.filter((entry) => entry.id !== 'undo' && !entry.reversible && !/never|can’t|cannot|isn’t|not/i.test(entry.effect!)).map((entry) => entry.id);
    expect(missing).toEqual([]);
  });

  it('GP-0256-05 requested, planned, rendered and heard are four separate explanations that point at each other', () => {
    const four = ['requested', 'planned', 'rendered', 'heard'].map((id) => glossaryTerm(id)!);
    expect(four.every(Boolean)).toBe(true);
    expect(new Set(four.map((entry) => entry.plain)).size).toBe(4);
    for (const entry of four) expect((entry.related ?? []).some((other) => ['requested', 'planned', 'rendered', 'heard'].includes(other))).toBe(true);
    expect(searchGlossary('what plays')[0].id).toBe('heard');
  });

  it('GP-0256-03/04 a ? opens a short answer by keyboard or tap, and leads to the searchable glossary at that term', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<><TermHint term="planned" /><GlossaryHost /></>);
    const hint = screen.getByRole('button', { name: 'What is planned?' });
    expect(hint).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(hint);
    expect(hint).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(hint.getAttribute('aria-controls')!)).toHaveTextContent('not made into audio yet');
    // Escape closes the innermost thing and gives focus back to the ?
    fireEvent.keyDown(hint, { key: 'Escape' });
    expect(hint).toHaveAttribute('aria-expanded', 'false');
    expect(hint).toHaveFocus();
    fireEvent.click(hint);
    fireEvent.click(screen.getByRole('button', { name: 'All music terms' }));
    const dialog = await screen.findByRole('dialog', { name: 'Music terms' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search music terms' });
    fireEvent.change(search, { target: { value: 'ÉNERGY' } });
    expect(within(dialog).getByRole('status')).toHaveTextContent(/terms? match/);
    expect(within(dialog).getByRole('heading', { name: 'Measured energy' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(within(dialog).getByRole('status')).toHaveTextContent('No terms match “zzzz”.');
    // GP-0256-06: reading and searching asked the server nothing
    expect(fetch).not.toHaveBeenCalled();
  });

  it('GP-0256-07 experts can hide the ? hints, and the glossary and every warning stay', () => {
    act(() => setPrefs({ termHints: false }));
    render(<><p role="alert">This transition could not be made.</p><TermHint term="transition" /><GlossaryHost /></>);
    expect(screen.queryByRole('button', { name: 'What is transition?' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be made');
    act(() => { void import('../state/glossaryRequests').then(({ openGlossary }) => openGlossary('transition')); });
    return screen.findByRole('dialog', { name: 'Music terms' }).then((dialog) => {
      expect(within(dialog).getByText(/Warnings, problems, anything that needs your OK, and every status always show/)).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: 'Show ? hints next to music terms' })).not.toBeChecked();
    });
  });
});
