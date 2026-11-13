import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeApp } from './RuntimeApp';
import { SetPlayer } from './player';
import { fakeBackend, Reply, status } from './test/backend';
import { Library } from './views/Library';

/** GP-0263-03: a server that can't be reached, or that fails, is never shown as a genuinely empty
 * Library. Only a server that answers with zero songs gets the "empty" words and the Add music step. */

vi.mock('./App', () => ({ App: () => <p>The local app</p> }));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const EMPTY_WORDS = /library is empty|Where’s your music|Add music|no songs|0 songs/i;

function library(state = status()) {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library status={state} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={vi.fn()}
      stage={false} toggleStage={() => {}} />,
  );
}

describe('GP-0263-03 offline is never an empty Library', () => {
  it.each([
    ['the server is not running', async () => { throw new TypeError('Failed to fetch'); }],
    ['the server answers with an error', async () => new Response('{}', { status: 500 })],
  ])('when %s, the start says it can’t reach SelectaDJ, not that there is no music', async (_why, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    render(<RuntimeApp />);
    expect(await screen.findByRole('heading', { name: 'Can’t reach SelectaDJ.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(EMPTY_WORDS);
  });

  it('a Library list that fails to load says the songs are fine, and offers a retry, not Add music', async () => {
    window.history.pushState({}, '', '/library');
    fakeBackend({ 'GET /library': new Reply(503, { detail: 'Service unavailable' }) });
    library();
    expect(await screen.findByText('Couldn’t load your library. Your songs are fine.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your library is empty' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add music' })).toBeNull();
  });

  it('only a server that really reports zero songs shows the empty Library and its next step', async () => {
    window.history.pushState({}, '', '/library');
    fakeBackend({ 'GET /library': { songs: [], total: 0, next: null } });
    library(status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, ready: 0, lyrics: 0 } }));
    expect(await screen.findByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add music' })).toBeEnabled();
  });
});
