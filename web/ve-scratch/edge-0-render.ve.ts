import { test } from '@playwright/test';
import { allRendered, resetStress, save } from './lib';

test('render the stress mix once, so every capture shows ready transitions', async ({ request }) => {
  const started = Date.now();
  await resetStress(request);
  await allRendered(request);
  const { mix } = await (await request.get('/api/mix')).json();
  save('render.json', { seconds: (Date.now() - started) / 1000, mix: mix.map((item: { song_id: number; title: string; artist: string; seam: { state: { status: string } } | null }) => ({ id: item.song_id, title: item.title, artist: item.artist, seam: item.seam?.state.status ?? null })) });
});
