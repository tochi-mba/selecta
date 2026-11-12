import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, status } from '../test/backend';
import { Workshop } from './Workshop';

// Its own file: the jobs store is shared module state, and an earlier answer would hide the failure.
describe('Workspace when the status can’t be reached (S4 finding, 2026-11-12)', () => {
  it('says so first, before the five counts', async () => {
    fakeBackend({ 'GET /jobs': new Reply(500, { detail: 'down' }) });
    const player = new SetPlayer(() => [], () => {});
    render(
      <Workshop tab="overview" status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    const notice = await screen.findByText(/Couldn’t find out what’s running/);
    const counts = document.querySelector('.metrics')!;
    expect(counts).not.toBeNull();
    expect(notice.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/Couldn’t find out what’s running/)).toHaveLength(1);
  });
});
