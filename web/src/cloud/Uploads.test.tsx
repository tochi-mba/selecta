import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import { fileSha256, resumableFor, sendParts, UploadSession } from './uploadParts';
import { UploadsPanel } from './Uploads';

const PART = 4;
const session = (over: Partial<UploadSession> = {}): UploadSession => ({ id: 'up-1', name: 'song.wav', size: 10, sha256: 'abc', part_size: PART, part_count: 3, status: 'uploading', ...over });

/** A fake API holding one session with `done` parts already in storage. */
function fakeApi({ sessions = [] as UploadSession[], done = [] as number[] } = {}) {
  const calls: string[] = [];
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/uploads') return { uploads: sessions };
    if (/^\/uploads\/[^/]+$/.test(path) && !init?.method) return { upload: { id: 'up-1', name: 'song.wav', size: 10, status: 'uploading', error: null }, uploaded_parts: done.map((number) => ({ number, etag: `e${number}`, size: PART })) };
    if (path.endsWith('/parts')) {
      const [number] = (JSON.parse(String(init?.body)) as { part_numbers: number[] }).part_numbers;
      return { part_urls: { [String(number)]: `https://r2.test/part/${number}` } };
    }
    if (path.endsWith('/complete')) return { status: 'accepted' };
    if (path === '/uploads/plan') return { uploads: [] };
    throw new Error(`unexpected ${path}`);
  });
  return { api: api as unknown as Api, calls };
}

describe('resuming an upload', () => {
  it('finds an unfinished session by size and SHA-256', () => {
    const sessions = [session({ id: 'other', sha256: 'zzz' }), session()];
    expect(resumableFor(sessions, { size: 10, sha256: 'abc' })?.id).toBe('up-1');
    expect(resumableFor(sessions, { size: 11, sha256: 'abc' })).toBeNull();
  });

  it('sends only the parts the server does not have', async () => {
    const { api, calls } = fakeApi({ done: [1] });
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    const progress: [number, number, number][] = [];
    const result = await sendParts(api, 'ws', new Blob(['0123456789']), session(), (...args) => progress.push(args), put as unknown as typeof fetch);
    expect(result.status).toBe('accepted');
    expect(put.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['https://r2.test/part/2', 'https://r2.test/part/3']);
    const bodies = await Promise.all(put.mock.calls.map((call) => ((call as unknown[])[1] as RequestInit).body as Blob).map((blob) => blob.text()));
    expect(bodies).toEqual(['4567', '89']);
    expect(progress).toEqual([[1, 3, 1], [2, 3, 1], [3, 3, 1]]);
    expect(calls.at(-1)).toBe('POST /uploads/up-1/complete');
  });

  it('stops with a plain message when a part fails, leaving what landed for next time', async () => {
    const { api, calls } = fakeApi();
    const put = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(sendParts(api, 'ws', new Blob(['0123456789']), session(), () => {}, put as unknown as typeof fetch)).rejects.toThrow('Choose the file again to carry on');
    expect(calls).not.toContain('POST /uploads/up-1/complete');
  });

  it('hashes a file in chunks to the same SHA-256 the server checks', async () => {
    expect(await fileSha256(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('the Add music panel', () => {
  it('lists unfinished uploads from the server, so a refreshed page knows about them', async () => {
    const { api } = fakeApi({ sessions: [session(), session({ id: 'done', status: 'accepted', name: 'finished.wav' })] });
    render(<UploadsPanel api={api} workspaceId="ws" setError={() => {}} setNotice={() => {}} blocked={null} />);
    const list = await screen.findByRole('region', { name: 'Unfinished uploads' });
    expect(list).toHaveTextContent('song.wav');
    expect(list).not.toHaveTextContent('finished.wav');
  });

  it('carries on a chosen file from its unfinished session without planning it again', async () => {
    const content = '0123456789';
    const digest = await fileSha256(new Blob([content]));
    const { api, calls } = fakeApi({ sessions: [session({ sha256: digest })], done: [1, 2] });
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    const onAccepted = vi.fn();
    render(<UploadsPanel api={api} workspaceId="ws" setError={() => {}} setNotice={() => {}} blocked={null} onAccepted={onAccepted} />);
    await userEvent.upload(screen.getByLabelText(/Choose music files/), new File([content], 'song.wav', { type: 'audio/wav' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(calls).not.toContain('POST /uploads/plan');
    expect(put).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Upload accepted')).toBeInTheDocument();
  });

  it('pauses uploading while over quota, and says why', () => {
    const { api } = fakeApi();
    render(<UploadsPanel api={api} workspaceId="ws" setError={() => {}} setNotice={() => {}} blocked="You’re 2.0 GB over your plan’s storage." />);
    expect(screen.getByText('You’re 2.0 GB over your plan’s storage.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose music files/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeDisabled();
  });
});
