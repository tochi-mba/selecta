import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadToCloudSheet } from './UploadToCloudSheet';
import { hasUploadConsent, previewUploads, PREVIEW_BATCH, type Request, type UploadCandidate, type UploadRights } from './uploadConsent';
import { uploadActionsFor } from './uploadEntry';

// "Upload to your cloud library" (cloud.move_to_cloud, plan 6c): the dry run's answer drawn
// plainly, the rights statement with I agree only while the current wording is unconfirmed, the
// two choices, and the queue started with keepHere; nothing starts before the statement.

const WORDS = 'I own these files or have the right to store copies of them for my own use. I understand SelectaDJ keeps them privately for my account.';
const UNANSWERED: UploadRights = { applies: true, reason: null, accepted: false, version: '2026-11-26', statement: WORDS, wording_sha256: 'a'.repeat(64), accepted_at: null };
const ANSWERED: UploadRights = { ...UNANSWERED, accepted: true, accepted_at: 5 };

const song = (songId: number, size: number | null = 4_000_000, duration: number | null = 200): UploadCandidate => ({ songId, sha: String(songId).padStart(64, '0'), title: `Song ${songId}`, fileName: `song-${songId}.mp3`, size, duration });

type File = { index: number; status: string; reason?: string | null; notes?: string[] };

/** A fake server: the rights routes and a dry run that answers each file as `answer` says. */
function server({ rights = UNANSWERED, answer = (index: number): File => ({ index, status: 'ok' }), left = 1_000_000_000, days = null as number | null } = {}) {
  let kept = rights;
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (path === '/api/uploads/rights' && !init?.method) return kept;
    if (path === '/api/uploads/rights' && init?.method === 'POST') { kept = { ...kept, accepted: true, accepted_at: 9 }; return kept; }
    if (path === '/api/uploads/preview') {
      const files = (JSON.parse(String(init?.body)) as { files: unknown[] }).files;
      return { files: files.map((_file, index) => ({ name: 'x', song_id: index, reason: null, notes: [], ...answer(index) })), totals: { bytes_left: left, measure_days: days } };
    }
    throw new Error(`unexpected ${path}`);
  }) as unknown as Request;
  return { request, calls, bodies };
}

function sheet(given: ReturnType<typeof server>, songs: UploadCandidate[], start = vi.fn()) {
  const onClose = vi.fn();
  render(<UploadToCloudSheet request={given.request} songs={songs} start={start} onClose={onClose} />);
  return { start, onClose };
}

const uploadButton = () => screen.getByRole('button', { name: /^Upload/ });

describe('what a batch would do', () => {
  it('says the songs, their size, the room left, what is refused and why, long songs and measuring days', async () => {
    const answers: Record<number, File> = {
      0: { index: 0, status: 'ok', notes: ['long_for_server_mixes'] },
      1: { index: 1, status: 'in_cloud_library' },
      2: { index: 2, status: 'refused', reason: 'format' },
      3: { index: 3, status: 'refused', reason: 'too_large' },
    };
    const given = server({ rights: ANSWERED, answer: (index) => answers[index] ?? { index, status: 'ok' }, days: 3 });
    sheet(given, [song(1, 4_000_000, 2400), song(2), song(3), song(4), song(5, 2_000_000)]);
    expect(await screen.findByText('2 songs to upload, 6.0 MB. You have 1.0 GB left in your cloud library.')).toBeInTheDocument();
    expect(screen.getByText(/1 song is already in your cloud library/)).toBeInTheDocument();
    expect(screen.getByText(/can’t upload: A kind of file uploads don’t take, such as WMA/)).toBeInTheDocument();
    expect(screen.getByText(/can’t upload: Bigger than your plan takes for one song/)).toBeInTheDocument();
    expect(screen.getByText(/1 song is over 30 minutes\. They upload and play, but mixes made in your cloud library leave them out\./)).toBeInTheDocument();
    expect(screen.getByText(/measuring these takes 3 days/)).toBeInTheDocument();
    // the dry run sent names, sizes, hashes, song ids and lengths: never a path
    expect(JSON.stringify(given.bodies)).not.toMatch(/[\\/]/);
  });

  it('counts the room over the whole batch: the first song that will not fit stops the rest', async () => {
    const given = server({ rights: ANSWERED, left: 5_000_000 });
    sheet(given, [song(1, 3_000_000), song(2, 3_000_000), song(3, 1_000_000)]);
    expect(await screen.findByText(/^1 song to upload, 3\.0 MB\./)).toBeInTheDocument();
    expect(screen.getByText(/2 songs won’t fit in the space left/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage storage' })).toBeInTheDocument();
  });

  it('asks in batches of 500 and says measuring takes at least the longest batch', async () => {
    const given = server({ rights: ANSWERED, days: 2 });
    const songs = Array.from({ length: PREVIEW_BATCH + 3 }, (_, index) => song(index + 1, 1_000));
    const preview = await previewUploads(given.request, songs);
    expect(given.calls.filter((call) => call === 'POST /api/uploads/preview')).toHaveLength(2);
    expect(preview.upload).toHaveLength(PREVIEW_BATCH + 3);
    expect(preview.measureAtLeast).toBe(true);
    expect(preview.measureDays).toBe(2);
  });

  it('lists a song whose size the browser cannot read without asking, and sends it to the queue', async () => {
    const given = server({ rights: ANSWERED });
    const { start } = sheet(given, [song(1), song(2, null)]);
    expect(await screen.findByText(/1 song needs this browser’s permission again/)).toBeInTheDocument();
    fireEvent.click(uploadButton());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect((start.mock.calls[0][0] as UploadCandidate[]).map((one) => one.songId)).toEqual([1, 2]);
  });
});

describe('the rights statement and the choice', () => {
  it('shows the statement until I agree, and nothing starts before it', async () => {
    const given = server();
    const { start } = sheet(given, [song(1)]);
    const statement = await screen.findByRole('region', { name: 'Before your first upload' });
    expect(within(statement).getByText(WORDS)).toBeInTheDocument();
    await screen.findByText(/^1 song to upload/);
    expect(uploadButton()).toBeDisabled();
    fireEvent.click(uploadButton());
    expect(start).not.toHaveBeenCalled();

    fireEvent.click(within(statement).getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Before your first upload' })).not.toBeInTheDocument());
    expect(given.calls).toContain('POST /api/uploads/rights');
    expect(given.bodies).toContainEqual({ version: '2026-11-26', wording_sha256: 'a'.repeat(64) });
    expect(uploadButton()).toBeEnabled();
  });

  it('asks nothing when the current wording is already confirmed', async () => {
    sheet(server({ rights: ANSWERED }), [song(1)]);
    await screen.findByText(/^1 song to upload/);
    expect(screen.queryByRole('button', { name: 'I agree' })).not.toBeInTheDocument();
    expect(uploadButton()).toBeEnabled();
  });

  it('plays them from the cloud library only by default, and starts with keepHere false', async () => {
    const { start, onClose } = sheet(server({ rights: ANSWERED }), [song(1), song(2)]);
    await screen.findByText(/^2 songs to upload/);
    expect(screen.getByRole('radio', { name: /Play these from your cloud library only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Keep playing them from this device too/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 songs' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.any(Array), { keepHere: false }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('asks only the statement and the dry run: the queue sends the files', async () => {
    const given = server();
    sheet(given, [song(1)]);
    await screen.findByText(/^1 song to upload/);
    fireEvent.click(screen.getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(given.calls).toContain('POST /api/uploads/rights'));
    expect(new Set(given.calls)).toEqual(new Set(['GET /api/uploads/rights', 'POST /api/uploads/preview', 'POST /api/uploads/rights']));
  });

  it('starts with keepHere true when the member keeps playing them from this device', async () => {
    const { start } = sheet(server({ rights: ANSWERED }), [song(1)]);
    await screen.findByText(/^1 song to upload/);
    fireEvent.click(screen.getByRole('radio', { name: /Keep playing them from this device too/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 song' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.any(Array), { keepHere: true }));
  });

  it('a business workspace is not asked', async () => {
    const business: UploadRights = { applies: false, reason: 'business_statement', accepted: false, version: null, statement: null, wording_sha256: null, accepted_at: null };
    sheet(server({ rights: business }), [song(1)]);
    await screen.findByText(/^1 song to upload/);
    expect(screen.queryByRole('button', { name: 'I agree' })).not.toBeInTheDocument();
    expect(uploadButton()).toBeEnabled();
  });
});

describe('the queue’s consent check', () => {
  it('is yes only for a confirmed wording or a workspace the statement does not apply to', async () => {
    expect(await hasUploadConsent(server({ rights: ANSWERED }).request)).toBe(true);
    expect(await hasUploadConsent(server().request)).toBe(false);
    expect(await hasUploadConsent(server({ rights: { ...UNANSWERED, applies: false } }).request)).toBe(true);
    const down = (async () => { throw new Error('offline'); }) as unknown as Request;
    expect(await hasUploadConsent(down)).toBe(false);
  });
});

describe('where uploading is offered', () => {
  const onDevice = (id: number) => id !== 3;
  const inCloud = (id: number) => id === 2;
  it('offers the selection, the list shown on this device and one song, only for songs here with no cloud copy', () => {
    expect(uploadActionsFor({ selected: [1, 2, 3], onDevice, inCloud })).toEqual([{ id: 'upload_selected', label: 'Upload to your cloud library', songIds: [1] }]);
    expect(uploadActionsFor({ shown: [1, 4, 2], showHere: true, onDevice, inCloud })).toEqual([{ id: 'upload_shown', label: 'Upload all 2 shown', songIds: [1, 4] }]);
    expect(uploadActionsFor({ shown: [1, 4], showHere: false, onDevice })).toEqual([]);
    expect(uploadActionsFor({ song: 3, onDevice })).toEqual([]);
    expect(uploadActionsFor({ song: 2, onDevice, inCloud })).toEqual([]);
    expect(uploadActionsFor({ song: 1, onDevice })).toEqual([{ id: 'upload_song', label: 'Upload to your cloud library', songIds: [1] }]);
  });
});
