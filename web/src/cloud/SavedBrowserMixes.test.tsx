import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MixData } from '../api';
import type { Recipe, RecipeStore, RecipeSummary } from './recipeStore';
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
    expect(notify).toHaveBeenCalledWith('Deleted Friday.');
  });
});
