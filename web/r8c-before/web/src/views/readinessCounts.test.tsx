import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';
import { Mixes } from './Mixes';
import { ViewProps } from './shared';
import { Workshop } from './Workshop';

/** UF-0377-04: Library, Make a Mix and Workspace read one canonical readiness count from /status, so
 * the number of songs ready for mixes is the same wherever it is shown. */

const counts = { total: 120, music: 91, set_aside: 29, analysed: 52, ready: 37, lyrics: 30 };

function props(): ViewProps {
  const player = new SetPlayer(() => [], () => {});
  return {
    status: status({ counts }), mix: [], mixName: '', canUndo: false, refreshMix: () => {}, setMixData: () => {},
    refreshStatus: () => {}, player, now: player.state, setView: () => {}, notify: () => {}, stage: false, toggleStage: () => {},
  } as ViewProps;
}

afterEach(cleanup);

const readyCounts = (root: ParentNode) => {
  const text = (root.textContent ?? '').replace(/\s+/g, ' ');
  return [...text.matchAll(/(\d[\d,]*) ?(?:songs )?(?:are )?ready for mixes/g)].map((match) => Number(match[1].replace(/,/g, '')));
};

const views = {
  Library: () => <Library {...props()} />,
  'Make a Mix': () => <Mixes {...props()} />,
  Workspace: () => <Workshop {...props()} tab="overview" />,
};

describe('one readiness count across routes', () => {
  for (const [name, View] of Object.entries(views)) {
    it(`${name} shows the same ready-for-mixes count as /status`, async () => {
      fakeBackend({ 'GET /library': { songs: [], total: 0, next: null }, 'GET /vibes': [] });
      const { container } = render(<View />);
      await vi.waitFor(() => expect(readyCounts(container).length).toBeGreaterThan(0), { timeout: 4000 });
      expect(new Set(readyCounts(container))).toEqual(new Set([counts.ready]));
      expect(screen.queryByText(/NaN|undefined/)).toBeNull();
    });
  }
});
