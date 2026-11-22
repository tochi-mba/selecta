import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org } from '../fixtures';
import { COPY_PERSONAL, CopyFromPersonal } from './CopyFromPersonal';

// Copy, never move (ADR-0453 BZ-0453-06): the personal list is read from the person's own
// workspace, the note about personal-use licences is shown, and only the picked songs are sent.

describe('CopyFromPersonal', () => {
  it('copies the picked songs with the personal-use note shown', async () => {
    const api = vi.fn(async () => ({ assets: [{ id: 'a1', name: 'Harbour Lights' }, { id: 'a2', name: 'Slow Tide' }] }));
    const copyFromPersonal = vi.fn(async () => ({ copied: 1, skipped: 0, refused: 0, missing: 0, song_ids: ['n1'] }));
    const ctx = { org: org(), client: { copyFromPersonal }, readOnly: false, offline: false, now: NOW } as unknown as BusinessCtx;
    const onCopied = vi.fn();
    render(<BusinessContext.Provider value={ctx}><CopyFromPersonal api={api as never} personalWorkspaceId="ws-me" onCopied={onCopied} /></BusinessContext.Provider>);
    expect(screen.getByText(COPY_PERSONAL.note)).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Slow Tide/));
    fireEvent.click(screen.getByRole('button', { name: 'Copy 1 song' }));
    await waitFor(() => expect(copyFromPersonal).toHaveBeenCalledWith(['a2']));
    expect(api).toHaveBeenCalledWith('/assets?limit=200', {}, 'ws-me');
    expect(await screen.findByText('Copied 1 song.')).toBeInTheDocument();
    expect(onCopied).toHaveBeenCalled();
  });
});
