import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountData, downloadExport, EXPORT_FILE } from './AccountData';

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }));
});

describe('Download my data', () => {
  it('fetches the export with the signed-in token and saves it as a ZIP', async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicked.push(`${this.download} ${this.href}`); });
    const fetchSpy = vi.fn(async () => new Response(new TextEncoder().encode('PK zip'), { status: 200, headers: { 'content-type': 'application/zip' } }));
    const size = await downloadExport('tok', 'ws-1', fetchSpy as unknown as typeof fetch);
    expect(size).toBeGreaterThan(0);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/export');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(new Headers(init.headers).get('X-Workspace-ID')).toBe('ws-1');
    expect(clicked).toEqual([`${EXPORT_FILE} blob:export`]);
  });

  it('says what the archive holds once it has downloaded', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('zip'), { status: 200 })));
    render(<AccountData token={async () => 'tok'} workspaceId="ws-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('original files, settings.json and mixes.json'));
  });

  it('shows the server’s reason when the export fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { code: 'asset_export_unavailable' } }), { status: 503 })));
    render(<AccountData token={async () => 'tok'} workspaceId="ws-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('asset export unavailable');
  });
});
