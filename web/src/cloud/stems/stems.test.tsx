import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StemPreference } from './StemPreference';
import { readinessWords, StemReadiness, StemsOffer, StemsTabNotice } from './StemReadiness';
import { StemsCard, StemsCardView } from './StemsCard';
import { DOWNLOAD_FAILED, PREFERENCE, READINESS, SPLITTING_PAUSED, STEMS_COPY, TAB_NOTICE } from './stemsCopy';
import { memoryStemsStore, splitterNotice, stemsFlagOn, stemsPending, useSplitterNotices } from './useStems';
import { stemsAbility, type SplitterState, type StemsActions, type StemsSnapshot } from './types';

const ABSENT: SplitterState = { state: 'absent', bytes: 170_000_000, needBytes: 340_000_000 };

function snap(splitter: SplitterState, more: Partial<StemsSnapshot> = {}): StemsSnapshot {
  return { splitter, windows: {}, metered: null, role: 'speaker', ...more };
}

function actions() {
  const spy = () => vi.fn<() => unknown>();
  const made = { download: spy(), pause: spy(), resume: spy(), cancel: spy(), remove: spy(), retryAfterCrash: spy() };
  return made satisfies StemsActions;
}

describe('the stems flag', () => {
  it('is on only with cloud.browser_stems and local mode’s stems both on', () => {
    expect(stemsFlagOn(() => true)).toBe(true);
    expect(stemsFlagOn((id) => id !== 'cloud.browser_stems')).toBe(false);
    expect(stemsFlagOn((id) => id !== 'stems')).toBe(false);
  });

  it('shows nothing at all while the stem model’s licence is under review', () => {
    const held = { state: 'unsupported' as const, reason: 'the stem model’s licence is still under review', code: 'licence' as const };
    const { container } = render(<StemsCardView enabled snapshot={snap(held)} actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
    expect(stemsAbility(held)).toBeNull();
  });
});

describe('StemsCard (More > This device)', () => {
  it('renders nothing with the flag off or no snapshot, so the page reflows', () => {
    const { container, rerender } = render(<StemsCardView enabled={false} snapshot={snap(ABSENT)} actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemsCardView enabled snapshot={null} actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemsCard enabled={false} store={memoryStemsStore(snap(ABSENT))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says why a device can’t split, and lists no download', () => {
    render(<StemsCardView enabled snapshot={snap({ state: 'unsupported', reason: 'it has no WebGPU and the fallback is too slow here' })} actions={actions()} />);
    expect(screen.getByRole('region', { name: 'Stems' })).toBeInTheDocument();
    expect(screen.getByText(STEMS_COPY.unsupportedTitle('it has no WebGPU and the fallback is too slow here'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STEMS_COPY.download })).toBeNull();
    expect(screen.queryByRole('button', { name: STEMS_COPY.crashRetry })).toBeNull();
  });

  it('offers a retry after the crash guard tripped', async () => {
    const act$ = actions();
    render(<StemsCardView enabled snapshot={snap({ state: 'unsupported', reason: 'splitting stopped this tab last time', code: 'crash_guard' })} actions={act$} />);
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.crashRetry }));
    expect(act$.retryAfterCrash).toHaveBeenCalledOnce();
  });

  it('offers the download with its size, the storage it needs and a metered note', async () => {
    const act$ = actions();
    const { rerender } = render(<StemsCardView enabled snapshot={snap(ABSENT, { metered: true })} actions={act$} />);
    expect(screen.getByText(STEMS_COPY.pitch)).toBeInTheDocument();
    expect(screen.getByText('The splitter is a 170 MB download and needs 340 MB of storage on this device.')).toBeInTheDocument();
    expect(screen.getByText(STEMS_COPY.metered)).toBeInTheDocument();
    rerender(<StemsCardView enabled snapshot={snap(ABSENT, { metered: false })} actions={act$} />);
    expect(screen.queryByText(STEMS_COPY.metered)).toBeNull();
    expect(screen.queryByText(STEMS_COPY.meteredUnknown)).toBeNull();
    rerender(<StemsCardView enabled snapshot={snap(ABSENT, { metered: null })} actions={act$} />);
    expect(screen.getByText(STEMS_COPY.meteredUnknown)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.download }));
    expect(act$.download).toHaveBeenCalledOnce();
  });

  it('Not now folds the offer to one line that can still download', async () => {
    const act$ = actions();
    render(<StemsCardView enabled snapshot={snap(ABSENT)} actions={act$} />);
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.notNow }));
    expect(screen.getByText(STEMS_COPY.notNowShort)).toBeInTheDocument();
    expect(screen.queryByText(STEMS_COPY.pitch)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.download }));
    expect(act$.download).toHaveBeenCalledOnce();
  });

  it('shows download progress with pause, resume and cancel', async () => {
    const act$ = actions();
    const { rerender } = render(<StemsCardView enabled snapshot={snap({ state: 'downloading', received: 68_000_000, total: 170_000_000, paused: false })} actions={act$} />);
    const bar = screen.getByRole('progressbar', { name: STEMS_COPY.progressLabel });
    expect(bar).toHaveAttribute('aria-valuetext', '68 MB of 170 MB');
    expect(screen.getByRole('status')).toHaveTextContent(STEMS_COPY.downloadingLine);
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.pause }));
    expect(act$.pause).toHaveBeenCalledOnce();
    rerender(<StemsCardView enabled snapshot={snap({ state: 'downloading', received: 68_000_000, total: 170_000_000, paused: true })} actions={act$} />);
    expect(screen.getByRole('status')).toHaveTextContent(STEMS_COPY.downloadPausedLine);
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.resume }));
    expect(act$.resume).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.cancel }));
    expect(act$.cancel).toHaveBeenCalledOnce();
  });

  it.each(['network', 'checksum', 'other'] as const)('a %s failure says why and can try again', async (why) => {
    const act$ = actions();
    render(<StemsCardView enabled snapshot={snap({ state: 'failed', why })} actions={act$} />);
    expect(screen.getByRole('alert')).toHaveTextContent(DOWNLOAD_FAILED[why]());
    expect(screen.queryByRole('button', { name: STEMS_COPY.freeSpace })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.tryAgain }));
    expect(act$.download).toHaveBeenCalledOnce();
  });

  it('storage full points at clearing cached audio and moves focus there', async () => {
    render(
      <>
        <h2 id="this-device-storage">Browser storage</h2>
        <StemsCardView enabled snapshot={snap({ state: 'failed', why: 'storage_full' })} actions={actions()} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Clearing cached audio in This device');
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.freeSpace }));
    expect(screen.getByRole('heading', { name: 'Browser storage' })).toHaveFocus();
  });

  it.each(['battery', 'thermal', 'hidden'] as const)('says splitting is paused for %s', (why) => {
    render(<StemsCardView enabled snapshot={snap({ state: 'paused', why })} actions={actions()} />);
    expect(screen.getByText(SPLITTING_PAUSED[why], { exact: false })).toBeInTheDocument();
  });

  it('when ready, says so and removes only after a second press', async () => {
    const act$ = actions();
    render(<StemsCardView enabled snapshot={snap({ state: 'ready', bytes: 170_000_000, implementation: 'WebGPU' })} actions={act$} />);
    expect(screen.getByText(STEMS_COPY.readyLine(170_000_000))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${STEMS_COPY.remove}…` }));
    expect(act$.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: STEMS_COPY.keep })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.keep }));
    expect(screen.getByRole('button', { name: `${STEMS_COPY.remove}…` })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: `${STEMS_COPY.remove}…` }));
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.remove }));
    expect(act$.remove).toHaveBeenCalledOnce();
  });

  it('after removal, says what was freed and returns to the download offer', () => {
    render(<StemsCardView enabled snapshot={snap({ ...ABSENT, removed: true, freedBytes: 340_000_000 } as SplitterState)} actions={actions()} />);
    expect(screen.getByText('Removed. That freed 340 MB.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STEMS_COPY.download })).toBeInTheDocument();
  });

  it('says a new splitter version prepares stems again', () => {
    const { rerender } = render(<StemsCardView enabled snapshot={snap({ ...ABSENT, updated: true } as SplitterState)} actions={actions()} />);
    expect(screen.getByRole('note')).toHaveTextContent(STEMS_COPY.updated);
    rerender(<StemsCardView enabled snapshot={snap({ state: 'ready', bytes: 1, implementation: 'WASM', updated: true })} actions={actions()} />);
    expect(screen.getByRole('note')).toHaveTextContent('Stems will be prepared again with the new splitter.');
  });

  it('a controller never offers the download', () => {
    render(<StemsCardView enabled snapshot={snap(ABSENT, { role: 'controller' })} actions={actions()} />);
    expect(screen.getByText(STEMS_COPY.controller)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps focus in the card when the pressed button goes away', async () => {
    const store = memoryStemsStore(snap(ABSENT));
    render(<StemsCard enabled store={store} />);
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.download }));
    act(() => store.set({ splitter: { state: 'downloading', received: 0, total: 1, paused: false } }));
    expect(screen.getByRole('heading', { name: 'Stems' })).toHaveFocus();
  });

  it('reads a live store', () => {
    const store = memoryStemsStore(snap(ABSENT));
    render(<StemsCard enabled store={store} />);
    expect(screen.getByText(STEMS_COPY.pitch)).toBeInTheDocument();
    act(() => store.set({ splitter: { state: 'ready', bytes: 5_000_000, implementation: 'WebGPU' } }));
    expect(screen.getByText(STEMS_COPY.readyLine(5_000_000))).toBeInTheDocument();
  });

  it('fits a 320 px screen: actions sit in the wrapping action row', () => {
    render(<StemsCardView enabled snapshot={snap(ABSENT)} actions={actions()} />);
    for (const button of screen.getAllByRole('button')) expect(button.closest('.cloud-actions')).not.toBeNull();
  });
});

describe('StemReadiness (seam row and Up next)', () => {
  it('says nothing with the flag off, on a controller, or with no window', () => {
    const { container, rerender } = render(<StemReadiness enabled={false} status={{ state: 'running', progress: 0.4 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemReadiness enabled status={{ state: 'running', progress: 0.4 }} role="controller" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemReadiness enabled status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says progress in a status region, in steps of ten percent', () => {
    const { rerender } = render(<StemReadiness enabled status={{ state: 'running', progress: 0.43 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Getting stems ready for this transition (40%)');
    rerender(<StemReadiness enabled status={{ state: 'running', progress: 0.49 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('(40%)');
    rerender(<StemReadiness enabled status={{ state: 'running', progress: 1 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('(100%)');
  });

  it('has no animation of its own, so reduced motion has nothing to stop', () => {
    render(<StemReadiness enabled status={{ state: 'running', progress: 0.4 }} />);
    const line = screen.getByRole('status');
    expect(line.querySelector('[data-motion], svg, progress')).toBeNull();
  });

  it('words every window state', () => {
    expect(readinessWords({ state: 'queued' })).toBe(READINESS.queued);
    expect(readinessWords({ state: 'ready' })).toBe(READINESS.ready);
    expect(readinessWords({ state: 'failed', why: 'The worker stopped.' })).toBe('Splitting failed for this transition: the worker stopped. It will use a move that doesn’t need stems.');
    expect(readinessWords({ state: 'skipped', why: 'Too close to the end' })).toBe('No stems for this transition: too close to the end.');
    expect(readinessWords({ state: 'running', progress: 0.2 }, { state: 'paused', why: 'battery' })).toBe(READINESS.paused);
    expect(readinessWords(undefined)).toBeNull();
  });

  it('marks a failed window as a warning', () => {
    render(<StemReadiness enabled status={{ state: 'failed', why: 'out of memory' }} />);
    expect(screen.getByRole('status')).toHaveClass('warn');
  });
});

describe('StemsTabNotice (Listen)', () => {
  it('says stems need the tab open while work is pending, and nothing otherwise', () => {
    const { container, rerender } = render(<StemsTabNotice enabled snapshot={snap(ABSENT)} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemsTabNotice enabled snapshot={snap({ state: 'ready', bytes: 1, implementation: 'WebGPU' }, { windows: { '1>2': { state: 'running', progress: 0.1 } } })} />);
    expect(screen.getByRole('note')).toHaveTextContent(TAB_NOTICE);
    rerender(<StemsTabNotice enabled snapshot={snap({ state: 'paused', why: 'hidden' })} />);
    expect(screen.getByRole('note')).toHaveTextContent(SPLITTING_PAUSED.hidden);
    rerender(<StemsTabNotice enabled={false} snapshot={snap({ state: 'paused', why: 'hidden' })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemsTabNotice enabled snapshot={snap({ state: 'paused', why: 'hidden' }, { role: 'controller' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StemsOffer (first stem move chosen)', () => {
  it('offers the download in place, with Not now', async () => {
    const act$ = actions();
    const notNow = vi.fn();
    render(<StemsOffer enabled snapshot={snap(ABSENT)} actions={act$} onNotNow={notNow} />);
    expect(screen.getByRole('group', { name: 'Stems' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.notNow }));
    expect(notNow).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: STEMS_COPY.download }));
    expect(act$.download).toHaveBeenCalledOnce();
  });

  it('shows progress while downloading and nothing once ready or on a controller', () => {
    const { container, rerender } = render(<StemsOffer enabled snapshot={snap({ state: 'downloading', received: 1, total: 2, paused: false })} actions={actions()} onNotNow={() => {}} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    rerender(<StemsOffer enabled snapshot={snap({ state: 'ready', bytes: 1, implementation: 'WebGPU' })} actions={actions()} onNotNow={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StemsOffer enabled snapshot={snap(ABSENT, { role: 'controller' })} actions={actions()} onNotNow={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StemPreference (Make a Mix shaping)', () => {
  it('offers Never, Sometimes and Often and reports the choice', async () => {
    const change = vi.fn();
    render(<StemPreference enabled value="sometimes" onChange={change} />);
    const select = screen.getByRole('combobox', { name: PREFERENCE.label });
    expect(select).toHaveValue('sometimes');
    expect(select).toHaveAccessibleDescription(PREFERENCE.hint);
    expect([...(select as HTMLSelectElement).options].map((option) => option.text)).toEqual(['Never', 'Sometimes', 'Often']);
    await userEvent.selectOptions(select, 'often');
    expect(change).toHaveBeenCalledWith('often');
  });

  it('says when it takes effect, and renders nothing with the flag off', () => {
    const { container, rerender } = render(<StemPreference enabled value="never" onChange={() => {}} ready={false} />);
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(`${PREFERENCE.hint} ${PREFERENCE.notReady}`);
    rerender(<StemPreference enabled={false} value="never" onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('store helpers', () => {
  it('toasts only when a download finishes', () => {
    expect(splitterNotice({ state: 'downloading', received: 1, total: 1, paused: false }, { state: 'ready', bytes: 1, implementation: 'WebGPU' })).toBe(STEMS_COPY.downloadedToast);
    expect(splitterNotice(ABSENT, { state: 'ready', bytes: 1, implementation: 'WebGPU' })).toBeNull();
    expect(splitterNotice(null, ABSENT)).toBeNull();
  });

  it('useSplitterNotices calls notify once the download finishes', () => {
    const store = memoryStemsStore(snap({ state: 'downloading', received: 1, total: 2, paused: false }));
    const notify = vi.fn();
    function Shell() {
      useSplitterNotices(store, notify);
      return null;
    }
    render(<Shell />);
    expect(notify).not.toHaveBeenCalled();
    act(() => store.set({ splitter: { state: 'ready', bytes: 1, implementation: 'WebGPU' } }));
    expect(notify).toHaveBeenCalledWith(STEMS_COPY.downloadedToast);
  });

  it('knows when stems are still pending', () => {
    expect(stemsPending(null)).toBe(false);
    expect(stemsPending(snap(ABSENT, { windows: { a: { state: 'ready' } } }))).toBe(false);
    expect(stemsPending(snap(ABSENT, { windows: { a: { state: 'queued' } } }))).toBe(true);
  });

  it('turns a splitter into what the Move picker needs', () => {
    expect(stemsAbility(null)).toBeNull();
    expect(stemsAbility({ state: 'unsupported', reason: 'no WebGPU' })).toEqual({ state: 'unavailable', reason: 'no WebGPU' });
    expect(stemsAbility(ABSENT)).toEqual({ state: 'download_needed' });
    expect(stemsAbility({ state: 'failed', why: 'network' })).toEqual({ state: 'download_needed' });
    expect(stemsAbility({ state: 'ready', bytes: 1, implementation: 'WebGPU' })).toEqual({ state: 'ready' });
    expect(stemsAbility({ state: 'ready', bytes: 1, implementation: 'WebGPU' }, 'controller')?.state).toBe('unavailable');
  });
});
