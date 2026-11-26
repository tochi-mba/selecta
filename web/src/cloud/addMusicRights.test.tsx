import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures } from '../flags';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { MediaStore, resetLegacyDisposalForTests } from '../media/store';
import { bytesFile, fakeHandle } from '../media/testFixtures';
import { CloudError, type Api } from './api';
import { bindUploadQueue, endUploadQueue, startUpload, uploadSnapshot } from './cloudUploadQueue';
import { fakeUploadServer } from './testUploadServer';
import { agreeToRights, type Request, type UploadRights } from './uploadConsent';
import { uploadConsentFrom } from './uploadQueueWiring';
import { UploadsPanel } from './Uploads';

// The upload rights statement before a workspace's first upload by any path (cloud.move_to_cloud,
// owner decision 2026-11-26): Add music shows it once until it is agreed, a plan the server refused
// with 409 rights_needed shows it, and the device upload queue starts once it is agreed.

const WORDS = 'I own these files or have the right to store copies of them for my own use. I understand SelectaDJ keeps them privately for my account.';
const ASKED: UploadRights = { applies: true, reason: null, accepted: false, version: '2026-11-26', statement: WORDS, wording_sha256: 'a'.repeat(64), accepted_at: null };

/** A Cloud API with the rights routes (agreed or not) and a plan that refuses until agreed. */
function rightsApi(agreed = false) {
  const calls: string[] = [];
  let kept = agreed;
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/uploads/rights' && init?.method === 'POST') { kept = true; return { ...ASKED, accepted: true, accepted_at: 9 }; }
    if (path === '/uploads/rights') return kept ? { ...ASKED, accepted: true, accepted_at: 9 } : ASKED;
    if (path === '/uploads') return { uploads: [] };
    if (path === '/uploads/plan') {
      if (!kept) throw new CloudError('Agree to the upload statement before your first upload.', 409, 'rights_needed', { detail: { code: 'rights_needed', version: ASKED.version, statement: WORDS, wording_sha256: ASKED.wording_sha256 } });
      return { uploads: [] };
    }
    throw new Error(`unexpected ${path}`);
  });
  return { api: api as unknown as Api, calls };
}

const panel = (api: Api) => render(<UploadsPanel api={api} workspaceId="ws" setError={() => {}} setNotice={() => {}} blocked={null} />);
const choose = () => userEvent.upload(screen.getByLabelText(/Choose music files/), new File(['0123456789'], 'song.wav', { type: 'audio/wav' }));

afterEach(() => setAccountFeatures(null));

describe('Add music asks for the statement once', () => {
  it('shows it until agreed, holds the upload back, then never again', async () => {
    setAccountFeatures({ 'cloud.move_to_cloud': true });
    const { api, calls } = rightsApi();
    const first = panel(api);
    const statement = await screen.findByRole('region', { name: 'Before your first upload' });
    expect(statement).toHaveTextContent(WORDS);
    await choose();
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Before your first upload' })).not.toBeInTheDocument());
    expect(calls).toContain('POST /uploads/rights');
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeEnabled();
    first.unmount();

    panel(api);
    await waitFor(() => expect(calls.filter((call) => call === 'GET /uploads/rights')).toHaveLength(2));
    expect(screen.queryByRole('region', { name: 'Before your first upload' })).not.toBeInTheDocument();
  });

  it('shows it when the server refuses a plan for it', async () => {
    // the first read failed, so the page learns of the statement from the refused plan
    setAccountFeatures({ 'cloud.move_to_cloud': true });
    const { api } = rightsApi();
    const reads = api as unknown as ReturnType<typeof vi.fn>;
    const real = reads.getMockImplementation()!;
    reads.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/uploads/rights' && !init?.method) throw new Error('offline');
      return real(path, init);
    });
    panel(api);
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    expect(await screen.findByRole('region', { name: 'Before your first upload' })).toHaveTextContent(WORDS);
    expect(screen.getByText(/Agree to the upload statement above, then start the upload again\./)).toBeInTheDocument();
  });

  it('asks nothing while cloud.move_to_cloud is off', async () => {
    setAccountFeatures({ 'cloud.move_to_cloud': false });
    const { api, calls } = rightsApi(true);
    panel(api);
    await choose();
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeEnabled();
    expect(calls).not.toContain('GET /uploads/rights');
    expect(screen.queryByRole('button', { name: 'I agree' })).not.toBeInTheDocument();
  });
});

describe('the device upload queue and the statement', () => {
  const WS = 'ws-rights';
  beforeEach(() => {
    vi.stubGlobal('indexedDB', fakeIndexedDb());
    resetLegacyDisposalForTests();
  });
  afterEach(async () => { await endUploadQueue(); });

  it('refuses to start before the statement is agreed, and starts after', async () => {
    const server = fakeUploadServer({});
    let agreed = false;
    const api = (async (path: string, init?: RequestInit, workspaceId?: string) => {
      if (path === '/uploads/rights' && init?.method === 'POST') { agreed = true; return { ...ASKED, accepted: true }; }
      if (path === '/uploads/rights') return { ...ASKED, accepted: agreed };
      return server.api(path, init, workspaceId);
    }) as Api;
    const store = await MediaStore.open(WS);
    const file = bytesFile('one', 'song-1.mp3');
    await store.put({ songId: 1, identity: { content_sha256: 'h-one', title: 'Song 1', artist: 'Artist', duration_s: 200 }, ref: { kind: 'handle', handle: fakeHandle(file) }, importedAt: 1 });
    const unbind = bindUploadQueue({
      workspaceId: WS, api, openStore: async () => store, hasUploadConsent: uploadConsentFrom(api), fetchImpl: server.fetchImpl,
      hash: async (blob: Blob) => `h-${await blob.text()}`, retryDelay: () => 0, onAvailabilityChanged: () => {},
      pacing: { locks: () => null, online: () => true, battery: async () => null, connection: () => null, phone: () => false },
    });
    try {
      await vi.waitFor(() => expect(uploadSnapshot().workspaceId).toBe(WS));
      expect(await startUpload({ songIds: [1] })).toEqual({ ok: false, why: 'consent' });
      const request = ((path: string, init?: RequestInit) => api(path.replace(/^\/api(?=\/)/, ''), init, WS)) as Request;
      await agreeToRights(request, ASKED);
      expect(await startUpload({ songIds: [1] })).toMatchObject({ ok: true, queued: 1 });
    } finally {
      unbind();
    }
  });
});
