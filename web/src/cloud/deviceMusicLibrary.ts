import { ApiError, type LibrarySong } from '../api';
import { isFirst, measureFirst, measureInTurn, measuringPaused, setMeasuringPaused, waitingSongs } from './measuringControl';

/** The Desktop's Library routes the shared views still ask, answered from what this device and
 * the account hold (T-20261126-ed4c). The adapter (deviceMusicRequest.ts) asks here first.
 *
 * - `GET /songs`: the Desktop's song search, from the Library rows the adapter already makes.
 * - `POST /songs/{id}/analyse`, `/songs/{id}/priority` and the priority batches: this device
 *   measures that song before the others still waiting (measuringControl.ts). A priority belongs
 *   to the device that measures, so it is kept here, not with the account: once one device has
 *   measured a song the account has its measurements for every device.
 * - `POST /analysis/start` and `/analysis/stop`: carry on, or pause, measuring on this device.
 * - `GET /library/interrupted`: nothing to offer again; measuring picks up by itself.
 *
 * Not answered here, on purpose: a song's audio and cover come from the device's own files
 * (deviceMusicPlayer.ts, the art index), its waveform from the device (Now's `waveformOf`), and
 * folders, relinking and checking them are the Workspace's Music folders (folderWatch.ts). */

export type LibrarySources = {
  /** Every song as a Library row, unfiltered. */
  rows: () => Promise<LibrarySong[]>;
  /** Whether this device measures songs (the profiler runs here). */
  measuring: () => boolean;
};

/** The Desktop's `/songs` filter states this answer knows. */
const STATES = new Set(['all', 'ready', 'not_yet', 'priority', 'set_aside']);
/** The Desktop's largest `/songs` answer. */
const MOST = 500;

const json = (init?: RequestInit): Record<string, unknown> => {
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

/** A row in the Desktop's `/songs` shape. */
function songShape(row: LibrarySong) {
  const setAside = row.readiness.status === 'set_aside';
  return {
    id: row.id, artist: row.artist, title: row.title, genre: row.genre, duration: row.duration,
    is_music: setAside ? 0 : 1, bpm: row.bpm, camelot: row.camelot, energy: row.energy,
    grid_confidence: null, lyric_status: null, processing_priority: row.priority ? 100 : 0,
    never: row.never, priority: row.priority,
  };
}

/** The `/songs` answer, as the Desktop filters and orders it. */
export function songsAnswer(rows: readonly LibrarySong[], search: URLSearchParams) {
  const query = (search.get('q') ?? '').trim().toLowerCase();
  const state = STATES.has(search.get('state') ?? 'all') ? search.get('state') ?? 'all' : 'all';
  const limit = Math.min(MOST, Math.max(1, Number(search.get('limit') ?? 100) || 100));
  const playsHere = (row: LibrarySong) => row.availability === undefined || row.availability === 'here' || row.availability === 'hosted';
  const matching = rows
    .filter((row) => !query || `${row.title ?? ''} ${row.artist ?? ''}`.toLowerCase().includes(query))
    .filter((row) => {
      const setAside = row.readiness.status === 'set_aside';
      if (state === 'set_aside') return setAside;
      if (setAside) return false;
      // ready: plays on this device; not yet: the account has no measurements of it
      if (state === 'ready') return playsHere(row);
      if (state === 'not_yet') return row.detected_bpm === null;
      if (state === 'priority') return row.priority;
      return true;
    });
  const ordered = search.get('order') === 'recent'
    ? [...matching].sort((one, other) => other.id - one.id)
    : [...matching].sort((one, other) => (one.artist ?? '').localeCompare(other.artist ?? '') || (one.title ?? '').localeCompare(other.title ?? ''));
  return ordered.slice(0, limit).map(songShape);
}

export function libraryFamily(sources: LibrarySources) {
  const songIn = async (id: number) => {
    const row = (await sources.rows()).find((one) => one.id === id);
    if (!row) throw new ApiError('That song is not in your library.', 404, 'not_found');
    return row;
  };
  const measuringHere = () => {
    if (!sources.measuring()) throw new ApiError('That works in the SelectaDJ app on a computer, not in a browser.', 404, 'flag_off');
  };
  const ahead = (id: number) => {
    const line = waitingSongs();
    const at = line.indexOf(id);
    return at < 0 ? 0 : 1;
  };
  return {
    answer(method: string, route: string, search: URLSearchParams, init?: RequestInit): Promise<unknown> | undefined {
      if (method === 'GET' && route === '/songs') return sources.rows().then((rows) => songsAnswer(rows, search));
      const analyse = method === 'POST' ? /^\/songs\/(\d+)\/analyse$/.exec(route) : null;
      if (analyse) {
        return (async () => {
          measuringHere();
          const id = Number(analyse[1]);
          const row = await songIn(id);
          if (row.detected_bpm !== null) return { song_id: id, ahead: 0, analysing: [] };
          measureFirst(id);
          return { song_id: id, ahead: ahead(id), analysing: [id] };
        })();
      }
      const priority = method === 'POST' ? /^\/songs\/(\d+)\/priority$/.exec(route) : null;
      if (priority) {
        return (async () => {
          measuringHere();
          const wanted = Number(search.get('priority') ?? 100);
          if (wanted !== 0 && wanted !== 100) throw new ApiError('priority must be 0 or 100', 400, 'invalid');
          const id = Number(priority[1]);
          await songIn(id);
          if (wanted === 100) measureFirst(id);
          else measureInTurn(id);
          return { song_id: id, priority: wanted };
        })();
      }
      if (method === 'POST' && route === '/library/batch') {
        const body = json(init);
        const action = body.action;
        if (action !== 'prioritize' && action !== 'deprioritize' && action !== 'restore_priority') return undefined;
        return (async () => {
          measuringHere();
          const entries = Array.isArray(body.entries) ? body.entries as { id?: unknown; expected?: unknown; priority?: unknown }[] : [];
          const ids = entries.map((entry) => Number(entry.id));
          if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
            throw new ApiError('Select distinct valid song IDs.', 400, 'invalid');
          }
          const previous = ids.map((id) => ({ id, priority: isFirst(id) ? 100 : 0 }));
          entries.forEach((entry, at) => {
            const up = action === 'prioritize' || (action === 'restore_priority' && Number(entry.priority) === 100);
            if (up) measureFirst(ids[at]);
            else measureInTurn(ids[at]);
          });
          return { updated: ids.length, action, ids, previous };
        })();
      }
      if (method === 'POST' && (route === '/analysis/start' || route === '/analysis/stop')) {
        return (async () => {
          measuringHere();
          setMeasuringPaused(route === '/analysis/stop');
          return { running: !measuringPaused() };
        })();
      }
      if (method === 'GET' && route === '/library/interrupted') {
        // measuring on this device carries on by itself after a reload, so nothing is offered again
        return Promise.resolve({ lyrics: false, scan: null, carrying_on: { lyrics: false, exports: 0 } });
      }
      return undefined;
    },
  };
}
