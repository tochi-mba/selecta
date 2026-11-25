// SCRATCH, never committed: the hosted card in every state against a fake server, for screenshots.
import '../styles/tokens.css'; import '../styles/boot.css'; import '../style.css'; import '../styles/shell.css'; import '../styles/polish.css'; import '../styles/foundation.css'; import '../styles/cloud-ui.css'; import '../styles/cloud-shell.css'; import '../styles/listening.css'; import '../styles/creation.css'; import '../styles/operations.css'; import '../styles/music-objects.css'; import '../styles/glossary.css'; import '../styles/palette.css'; import '../styles/icons.css'; import '../styles/depth.css'; import '../styles/feel.css'; import '../styles/feel-scene.css'; import '../styles/feel-music.css'; import '../styles/feel-parts.css'; import '../styles/feel-components.css'; import '../styles/feel-shell.css'; import '../styles/feel-entry.css'; import '../styles/feel-listen.css'; import '../styles/feel-library.css'; import '../styles/feel-rooms.css'; import '../styles/feel-account.css'; import '../styles/feel-local.css'; import '../styles/typography.css';
import '../cloud/cloud.css';
import '../cloud/cloudMusic.css';
import { createRoot } from 'react-dom/client';
import { HostedMakeAMix } from '../cloud/hosted/HostedMakeAMix';
import type { Api } from '../cloud/api';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'ready';
document.documentElement.dataset.cloud = 'on';
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme')!;

const names = ['001. Morgan Wallen - Last Night.mp3', 'Miley Cyrus - Flowers.mp3', 'SZA - Kill Bill.mp3', 'Rema & Selena Gomez - Calm Down.mp3', 'David Guetta & Bebe Rexha - I\'m Good (Blue).mp3', 'Beyonce - CUFF IT.mp3'];
const song = (i: number, s: string, extra = {}) => ({ asset_id: `s${i}`, name: names[i], analysis: { state: s === 'done' ? 'ready' : s }, status: { state: s, can_retry: s === 'failed', reason: s === 'failed' ? 'This file is not audio SelectaDJ can read.' : null }, ...extra });
const songsFor = (st: string) => {
  if (st === 'empty') return [];
  if (st === 'analysing') return names.map((_, i) => song(i, i < 2 ? 'done' : i === 2 ? 'running' : 'waiting'));
  if (st === 'failed') return names.map((_, i) => song(i, i === 4 ? 'failed' : 'done'));
  if (st === 'copies') return names.map((_, i) => song(i, 'done', i === 1 ? { same_recording_as: ['s5'] } : i === 5 ? { same_recording_as: ['s1'] } : {}));
  return names.map((_, i) => song(i, 'done'));
};
const songs = songsFor(state);
const totals = { waiting: songs.filter((s) => s.status.state === 'waiting').length, running: songs.filter((s) => s.status.state === 'running').length, done: songs.filter((s) => s.status.state === 'done').length, failed: songs.filter((s) => s.status.state === 'failed').length, total: songs.length };
const songsAnswer = { songs, totals, moving: state === 'analysing', estimate_s: state === 'analysing' ? 260 : null, counts: { ready: 0, running: 0, queued: 0, failed: 0, not_started: 0 }, seconds_each: 60, total: songs.length };
const order = [0, 1, 2, 3, 4].map((i) => ({ asset_id: `s${i}`, move: i ? 'bass_swap_blend' : null }));
const rendering = state === 'rendering';
const parts = order.flatMap((o, i) => [
  { kind: 'song', from_s: i % 2 ? 95 : 5, seconds: 50, url: state === 'error' && i === 0 ? '/shots-audio/not-audio.flac' : `/shots-audio/${i % 2 ? 'song2' : 'song'}.flac?sig=${i}`, asset_id: o.asset_id, gain_db: -1 },
  ...(i < 4 ? [{ kind: 'seam', from_s: 0, seconds: 10, url: state === 'error' && i === 0 ? '/shots-audio/missing.flac' : '/shots-audio/seam.flac?s=1', move: i === 2 ? 'filter_sweep' : 'bass_swap_blend' }] : []),
]);
const seams = [0, 1, 2, 3].map((i) => ({ index: i, state: rendering ? (i < 2 ? 'ready' : i === 2 ? 'running' : 'queued') : (state === 'straight' && i === 3 ? 'failed' : 'ready'), planned_move: i === 2 ? 'filter_sweep' : 'bass_swap_blend', move: i === 2 ? 'filter_sweep' : 'bass_swap_blend', passed: true, why: 'the two songs are too far apart in key' }));
const mix = { parts, seams, complete: !rendering, estimate_s: rendering ? 140 : null, estimate_why: null, worker_seen: true, work: { queued: 1, running: 1, slots: 2 }, counts: { seams_ready: rendering ? 2 : state === 'straight' ? 3 : 4, seams_failed: state === 'straight' ? 1 : 0, seams: 4, songs_analysed: 5, songs: 5, files_ready: 5 } };
let polls = 0;
const exportAnswer = () => {
  if (state === 'exportfail') return { state: 'failed', why: 'The worker stopped before the file was written' };
  if (state === 'exportready') return { state: 'ready', url: '/shots-audio/song.flac', size_bytes: 107e6, seconds: 547 };
  polls += 1;
  return { state: 'running', parts_done: 3, parts_total: 10, progress: [3, 10], estimate_s: 95, worker_seen: true };
};
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const api = (async (path: string) => {
  if (path.startsWith('/hosted/songs')) return songsAnswer;
  if (path.startsWith('/hosted/mixes/plan')) { if (state === 'planning') await wait(1e9); return { songs: order }; }
  if (path.startsWith('/hosted/mixes/render')) return mix;
  if (path.startsWith('/hosted/mixes/export')) return state.startsWith('export') && state !== 'exporting' ? exportAnswer() : { state: 'queued', job_id: 'j', parts_done: 0, parts_total: 10, progress: [0, 10] };
  if (path.startsWith('/hosted/exports/')) return exportAnswer();
  throw new Error(path);
}) as Api;
void polls;

createRoot(document.getElementById('root')!).render(
  <div className="shell" data-mode="cloud">
    <nav className="nav" aria-label="Main"><ul><li><a href="#" aria-current="page"><span className="nav-label">Make a Mix</span></a></li><li><a href="#"><span className="nav-label">Listen</span></a></li><li><a href="#"><span className="nav-label">Library</span></a></li><li><a href="#"><span className="nav-label">Account</span></a></li></ul></nav>
    <div className="content" id="content">
      <HostedMakeAMix api={api} workspaceId="ws" browserMixer={null} othersPlaying={false} stopOthers={() => undefined} />
    </div>
  </div>,
);
