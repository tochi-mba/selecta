import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Api } from '../api';
import { BrowserStudio } from './BrowserStudio';
import { registerBrowserStudioPorts, type PortableRecipe } from './browserPorts';
import { resolveRoute } from '../cloudRoutes';

const original: PortableRecipe = {
  schema_version: 2, recipe_id: 'saved_mix', revision_id: 'a'.repeat(64),
  revision_number: 3, parent_revision: 'b'.repeat(64),
  name: 'Weekend set', draft: true,
  occurrences: [
    { occurrence_id: 'first', canonical_track_id: 'track_1', legacy_asset_id: null,
      recording_version: 'master_1', title: 'First track', artist: 'Artist', analysis_valid: false },
    { occurrence_id: 'second', canonical_track_id: 'track_2', legacy_asset_id: null,
      recording_version: 'master_2', title: 'Second track', artist: null, analysis_valid: false },
  ],
  cues: [], transitions: [{
    from_occurrence_id: 'first', to_occurrence_id: 'second', type: 'crossfade',
    duration_seconds: 8, requires_rebuild: true,
  }],
};
const history = [
  { revision: original.revision_id, number: 3, name: original.name, schema_version: 2, parent_revision: original.parent_revision },
  { revision: original.parent_revision!, number: 2, name: 'Earlier set', schema_version: 2, parent_revision: 'c'.repeat(64) },
];
function stubApi(status = 201) {
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const api: Api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined });
    if (path === '/cloud-mixes?schema_version=2') return {
      recipes: [{ recipe_id: original.recipe_id, name: original.name,
        revision: original.revision_id, revision_number: 3, occurrences: 2 }],
    } as T;
    if (path === '/cloud-mixes/saved_mix?schema_version=2') return {
      recipe: original, history, legacy_read_only_view: false,
    } as T;
    if (path === '/cloud-mixes/saved_mix/revisions') {
      if (status === 409) throw Object.assign(new Error('Stale revision'), { status: 409 });
      return { recipe: original } as T;
    }
    throw Error(`Unexpected Cloud route ${path}`);
  };
  return { api, requests };
}
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
  registerBrowserStudioPorts(null);
});

describe('portable browser Studio', () => {
  it('maps browser-first deep links to the original Studio destination', () => {
    expect(resolveRoute('/studio')).toEqual({ kind: 'page', page: 'listen' });
    expect(resolveRoute('/mixes')).toEqual({ kind: 'page', page: 'listen' });
    expect(resolveRoute('/player')).toEqual({ kind: 'page', page: 'listen' });
  });
  it('opens and edits a mix with no media or native engine; saves immutable v2 revision', async () => {
    const { api, requests } = stubApi();
    render(<BrowserStudio api={api} workspaceId="workspace_1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Weekend set/i }));
    expect(await screen.findByText(/Exact recording availability is unknown/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Play Here' }).at(-1)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Second track earlier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await waitFor(() => expect(requests.some((request) => request.path === '/cloud-mixes/saved_mix/revisions')).toBe(true));
    const write = requests.find((request) => request.path === '/cloud-mixes/saved_mix/revisions')!;
    expect(write.body?.schema_version).toBe(2);
    expect(write.body?.base_revision).toBe(original.revision_id);
    expect((write.body?.changes as { occurrences: Array<{ occurrence_id: string }> }).occurrences
      .map((row) => row.occurrence_id)).toEqual(['second', 'first']);
    expect(requests.every(({ path }) => !path.includes('/assets') && !path.includes('/upload'))).toBe(true);
  });
  it('retains an older unsaved draft when Cloud has a new head revision', async () => {
    const { api } = stubApi();
    const key = 'br64-07:draft:workspace_1:saved_mix';
    window.sessionStorage.setItem(key, JSON.stringify({
      base: 'f'.repeat(64), edit: {
        name: 'Offline revision', draft: true, occurrences: [...original.occurrences].reverse(),
        cues: [], transitions: [],
      },
    }));
    window.history.replaceState({}, '', '/studio?mix=saved_mix');
    render(<BrowserStudio api={api} workspaceId="workspace_1" />);
    expect(await screen.findByText('Review recoverable earlier draft (metadata only)')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(key)).toContain('Offline revision');
    expect(screen.getByRole('button', { name: 'Save new version' })).toBeDisabled();
  });
  it('keeps draft and disables file upload/render when local adapters are absent', async () => {
    const { api } = stubApi(409);
    render(<BrowserStudio api={api} workspaceId="workspace_1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Weekend set/i }));
    const input = screen.getByLabelText('Choose music files on this device');
    expect(input).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Second track earlier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(await screen.findByText(/This recipe has a newer revision/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move First track earlier' })).not.toBeDisabled();
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
  });
});
