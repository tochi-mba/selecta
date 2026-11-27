import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStore } from '../media/store';
import { approveMusicMigration, useApprovedMusicMigration } from './approvedMusicMigration';
import { startUpload, uploadSnapshot } from './cloudUploadQueue';

vi.mock('./cloudUploadQueue', () => ({ startUpload: vi.fn(), uploadSnapshot: vi.fn() }));
vi.mock('./UploadChip', () => ({
  useUploadQueue: () => ({ workspaceId: 'mine', phase: 'idle' }),
}));

describe('automatic music migration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(startUpload).mockReset().mockResolvedValue({ ok: true, queued: 1, choose: 0 });
    vi.mocked(uploadSnapshot).mockReturnValue({ workspaceId: 'mine', phase: 'idle' } as ReturnType<typeof uploadSnapshot>);
  });

  it('queues connected audio only for the workspace and revision explicitly approved', async () => {
    const all = vi.fn().mockResolvedValue([{ songId: 72 }]);
    const openStore = async () => ({ all }) as unknown as MediaStore;
    approveMusicMigration('mine', 8);
    const { rerender, unmount } = renderHook(({ revision }) => useApprovedMusicMigration('mine', revision, openStore), {
      initialProps: { revision: 7 },
    });
    expect(all).not.toHaveBeenCalled();
    rerender({ revision: 8 });
    await waitFor(() => expect(startUpload).toHaveBeenCalledWith({ songIds: [72], keepHere: true }));
    unmount();
    renderHook(() => useApprovedMusicMigration('mine', 8, openStore));
    expect(startUpload).toHaveBeenCalledTimes(1);
  });
});
