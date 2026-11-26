import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData } from '../api';
import { setFlags } from '../flags';
import type { Recipe, RecipeSong, RecipeStore, RecipeSummary } from './recipeStore';
import { SavedBrowserMixes } from './SavedBrowserMixes';

function store(names: string[]) {
  let current: string | null = 'mix-1';
  let list: RecipeSummary[] = names.map((name, index) => ({ mix_id: `mix-${index + 1}`, name, revision: `r${index}`, number: 1, songs: 3, updated_at: Date.now() / 1000 - 600 }));
  const recipe = (mixId: string): Recipe => ({ mix_id: mixId, name: list.find((item) => item.mix_id === mixId)!.name, number: 1, parent: null, revision: 'r', songs: [], seams: [] });
  const made: RecipeStore = {
    current: () => current,
    setCurrent: (mixId) => { current = mixId; },
    steering: () => ({ mix_language: 'any', stems: 'auto', energy_arc: null, target: null }),
    setSteering: () => undefined,
    create: vi.fn(),
    read: async (mixId) => recipe(mixId),
    list: async () => list,
    edit: vi.fn(async (mixId: string, _revision: string, change: { name?: string }) => {
      list = list.map((item) => (item.mix_id === mixId ? { ...item, name: change.name ?? item.name } : item));
      return recipe(mixId);
    }),
    duplicate: vi.fn(async (mixId: string) => {
      const copy = { ...list.find((item) => item.mix_id === mixId)!, mix_id: `mix-${list.length + 1}` };
      copy.name = `${copy.name} copy`;
      list = [...list, copy];
      return recipe(copy.mix_id);
    }),
    remove: vi.fn(async (mixId: string) => { list = list.filter((item) => item.mix_id !== mixId); }),
  };
  return made;
}

function shown(recipes: RecipeStore) {
  const notify = vi.fn();
  const setMixData = vi.fn();
  const request = vi.fn(async () => ({ mix: [], name: 'Current mix', can_undo: false } as MixData));
  render(
    <SavedBrowserMixes workspaceId="ws" recipes={recipes} request={request as never} setMixData={setMixData} refreshStatus={() => undefined}
      player={{ playFrom: vi.fn() } as never} notify={notify} />,
  );
  return { notify, setMixData };
}

describe('saved browser mixes, laid out like local drafts', () => {
  it('renames a saved mix from its menu', async () => {
    const recipes = store(['Friday', 'Sunday']);
    shown(recipes);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Sunday' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename Sunday' }));
    const field = screen.getByRole('textbox', { name: 'New name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Sunday warmup{Enter}');
    expect(await screen.findByText('Sunday warmup')).toBeVisible();
    expect(recipes.edit).toHaveBeenCalledWith('mix-2', 'r', { name: 'Sunday warmup' });
  });

  it('copies one, and deletes one after saying it can not be undone', async () => {
    const recipes = store(['Friday', 'Sunday']);
    const { notify } = shown(recipes);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Sunday' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy Sunday' }));
    expect(await screen.findByText('Sunday copy')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Friday' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Friday' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Friday?' });
    expect(within(dialog).getByText(/can’t be undone/)).toBeVisible();
    expect(within(dialog).getByText(/It is your current mix/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete mix' }));
    expect(recipes.remove).toHaveBeenCalledWith('mix-1');
    expect(recipes.current()).toBeNull();
    // under motion the row folds away first, then the list is read again and it says so (ADR-0477)
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Deleted Friday.'));
  });
});

describe('making a saved mix current shows and plays that mix', () => {
  afterEach(() => { cleanup(); setFlags(null); });

  const song = (song_id: number, in_library = true): RecipeSong => ({ song_id, id: `s${song_id}`, title: `Song ${song_id}`, artist: null, duration: 200, sha256: null, in_library, available_on: 1 });
  /** Sunday is a recipe of songs 4, 5 and a song since gone; the account's own current mix is 1, 2. */
  function world() {
    let current: string | null = 'mix-1';
    let account = { mix: [1, 2], name: 'Account mix' };
    const sunday: Recipe = { mix_id: 'mix-2', name: 'Sunday', number: 1, parent: null, revision: 'r', songs: [song(4), song(5), song(9, false)], seams: [] };
    const recipes = {
      current: () => current,
      setCurrent: vi.fn((next: string | null) => { current = next; }),
      read: async () => sunday,
      list: async () => [{ mix_id: 'mix-1', name: 'Friday', revision: 'r', number: 1, songs: 2, updated_at: Date.now() / 1000 }, { mix_id: 'mix-2', name: 'Sunday', revision: 'r', number: 1, songs: 3, updated_at: Date.now() / 1000 }],
    } as unknown as RecipeStore;
    const asked: string[] = [];
    // the shell's request: with account mixes the account answers GET /mix with its own mix
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${path}`);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { song_ids: number[]; name: string };
        account = { mix: body.song_ids, name: body.name };
      }
      return { mix: account.mix.map((song_id, position) => ({ position, song_id })), name: account.name, can_undo: false } as unknown as MixData;
    });
    const setMixData = vi.fn();
    const playFrom = vi.fn();
    render(<SavedBrowserMixes workspaceId="ws" recipes={recipes} request={request as never} setMixData={setMixData} refreshStatus={() => undefined}
      player={{ playFrom } as never} notify={vi.fn()} />);
    return { recipes, asked, setMixData, playFrom };
  }

  it('with account mixes, the saved mix becomes the account’s current mix before it is read back', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true });
    const { recipes, asked, setMixData, playFrom } = world();
    await userEvent.click(await screen.findByRole('button', { name: 'Play Sunday' }));
    await waitFor(() => expect(playFrom).toHaveBeenCalledWith(0));
    // each song once, those still in the library, under the saved mix's own name
    expect(asked).toEqual(['PUT /mix/order', 'GET /mix']);
    expect(setMixData).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sunday', mix: [{ position: 0, song_id: 4 }, { position: 1, song_id: 5 }] }));
    expect(recipes.current()).toBe('mix-2');
  });

  it('without them, the recipe pointer is what the mix is read from, as before', async () => {
    const { recipes, asked, playFrom } = world();
    await userEvent.click(await screen.findByRole('button', { name: 'Play Sunday' }));
    await waitFor(() => expect(playFrom).toHaveBeenCalledWith(0));
    expect(asked).toEqual(['GET /mix']);
    expect(recipes.current()).toBe('mix-2');
  });
});
