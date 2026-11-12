/* FP-0267 (ADR-0267): the Library's selection rail is contextual. At zero selected only a named way in
 * is shown; the full action rail appears for a real selection, says exactly how many loaded songs it
 * covers, clears safely with focus kept, and is dropped whenever the result it belongs to changes.
 * The browser twin (focus return and screenshots in both layouts) is web/e2e/fp-selection-rail.e2e.ts. */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

const row = (id: number, title: string) => ({
  id, artist: 'Someone', title, genre: null, duration: 200, bpm: null, camelot: null, lyric_status: null,
  never: false, priority: false, detected_bpm: null, detected_camelot: null, override_bpm: null,
  override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});
const ACTIONS = ['Prioritize selected', 'Remove priority', 'Never play selected', 'Allow selected', 'Clear selection'];

beforeEach(() => window.history.pushState({}, '', '/library'));
afterEach(() => setPrefs({ libraryLayout: 'list', density: 'comfortable' }));

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />,
  );
}

/** the same IDs come back for every search, so a stale selection would visibly re-attach to them */
const sameIds = () => fakeBackend({ 'GET /library': () => ({ songs: [row(1, 'First'), row(2, 'Second'), row(3, 'Third')], total: 3, next: null }) });
const rail = () => document.querySelector('.library-batch-actions');
const box = (title: string) => screen.getByRole('checkbox', { name: new RegExp(`Select recording ${title} by`) });

describe('FP-0267-02 at zero selected, a named way in and nothing disabled', () => {
  it('shows the entry button and row checkboxes, and no batch buttons, disabled or not', async () => {
    sameIds();
    show();
    await screen.findByText('First');
    const tools = screen.getByRole('region', { name: 'Select Library recordings' });
    expect(within(tools).getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeEnabled();
    expect(within(tools).getByText(/use the checkboxes beside recordings/)).toBeVisible();
    expect(screen.getAllByRole('checkbox', { name: /^Select recording/ })).toHaveLength(3);
    for (const name of ACTIONS) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(tools.querySelectorAll('button:disabled')).toHaveLength(0);
    expect(rail()).toBeNull();
  });

  it('the keyboard alone enters selection, from a row checkbox or from the entry button', async () => {
    sameIds();
    show();
    await screen.findByText('First');
    box('Second').focus();
    await userEvent.keyboard(' ');
    expect(box('Second')).toBeChecked();
    expect(screen.getByText(/^1 of 3 loaded recordings selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    const entry = screen.getByRole('button', { name: 'Select up to 200 loaded songs' });
    expect(entry).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText(/^3 of 3 loaded recordings selected/)).toBeInTheDocument();
  });
});

describe('FP-0267-03, FP-0267-05 the rail is there only for a real selection, and clearing is safe', () => {
  it('appears at one, goes back to compact on Clear, keeps focus, and sends nothing', async () => {
    const calls = sameIds();
    show();
    await screen.findByText('First');
    await userEvent.click(box('First'));
    expect(rail()).not.toBeNull();
    for (const name of ACTIONS) expect(screen.getByRole('button', { name })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(rail()).toBeNull();
    for (const name of ACTIONS) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select up to 200 loaded songs' })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(box('First')).not.toBeChecked();
  });

  it('unticking the last checkbox also returns to compact', async () => {
    sameIds();
    show();
    await screen.findByText('First');
    await userEvent.click(box('Third'));
    expect(rail()).not.toBeNull();
    await userEvent.click(box('Third'));
    expect(rail()).toBeNull();
    expect(box('Third')).toHaveFocus();
  });
});

describe('FP-0267-06 a changed result drops the selection and never re-attaches old IDs', () => {
  it('a filter change, a sort change and Back each clear it, though the same IDs come back', async () => {
    sameIds();
    show();
    await screen.findByText('First');
    await userEvent.click(box('First'));
    await userEvent.click(box('Second'));
    expect(screen.getByText(/^2 of 3 loaded recordings selected/)).toBeInTheDocument();

    // filter
    await userEvent.click(screen.getByRole('button', { name: 'Priority list' }));
    await waitFor(() => expect(window.location.search).toContain('show='));
    await screen.findByText('First');
    expect(rail()).toBeNull();
    expect(box('First')).not.toBeChecked();
    expect(box('Second')).not.toBeChecked();

    // the old URL again (Back): the earlier selection is not brought back
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
    await screen.findByText('First');
    expect(rail()).toBeNull();
    expect(box('First')).not.toBeChecked();

    // sort
    await userEvent.click(box('Third'));
    expect(rail()).not.toBeNull();
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    const other = [...(sort as HTMLSelectElement).options].find((option) => !option.selected)!;
    await userEvent.selectOptions(sort, other.value);
    await waitFor(() => expect(window.location.search).toContain('sort='));
    await screen.findByText('Third');
    expect(rail()).toBeNull();
    expect(box('Third')).not.toBeChecked();
  });
});
