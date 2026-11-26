// The local-first runtime harness (BF-0462-06, BF-0459-04, BF-0465-03), built only with the cloud
// browser tests (SELECTA_CLOUD_E2E=1). It mounts the shell's own player hook, useLocalFirstPlayer,
// over the real ADR-0457 engine and the real playback session, with a two-song programme:
// song 1 is on "this device" (bytes from the test server's /test/wav), song 2 exists only in the
// account's hosted library (a seeded asset, reached through the cloud.stored_media playback-url
// route). So one set exercises device-first resolution, the hosted fallback, and a mixed-source
// seam scheduled by the seam provider. The page prints what the runtime scheduled; it never
// claims anything about sound (the tests run muted).

import { useEffect, useMemo, useState } from 'react';
import type { MixItem } from '../api';
import { hostedResolver } from '../cloud/hostedMedia';
import { useLocalFirstPlayer } from '../cloud/deviceMusicPlayer';
import { QueueSources } from '../cloud/QueueSources';
import type { Api } from '../devices/usePlaybackDevice';
import { makeCoexistingResolver, makeSourceBook, type MediaResolver } from '../media';
import type { NowState } from '../player';

const SECONDS = 40;

export const RUNTIME_MIX: MixItem[] = [
  { position: 0, song_id: 1, artist: '', title: 'Device song', duration: SECONDS, bpm: null, key: null, locked: false, seam: null },
  {
    position: 1, song_id: 2, artist: '', title: 'Song 1', duration: SECONDS, bpm: null, key: null, locked: false,
    seam: { settings: { move: 'bass_swap_blend', bars: 8 }, state: { status: 'none', key: 'runtime-1' } },
  },
];

export function RuntimeHarness({ api, workspaceId }: { api: Api; workspaceId: string }) {
  const book = useMemo(() => makeSourceBook(), []);
  const resolver = useMemo(() => {
    const device: MediaResolver = async (songId) => (songId === 1
      ? { id: 1, data: async () => (await fetch(`/test/wav?seconds=${SECONDS}`)).arrayBuffer() }
      : null);
    const made = makeCoexistingResolver({ device, hosted: hostedResolver(api, workspaceId, { songs: () => RUNTIME_MIX }), book });
    return async () => made;
  }, [api, workspaceId, book]);
  const { player, seams } = useLocalFirstPlayer({ api, workspaceId, mix: RUNTIME_MIX, remoteControl: false, resolver });
  const [now, setNow] = useState<NowState>(player.state);
  useEffect(() => {
    player.onChange = setNow;
    setNow(player.state);
    return () => { player.onChange = () => {}; };
  }, [player]);
  const report = {
    phase: now.phase,
    position: now.position,
    nextReady: now.nextReady,
    seamAt: now.seamAt,
    notice: now.notice,
    seams: seams.map((record) => ({
      fromIndex: record.fromIndex,
      toIndex: record.toIndex,
      sources: record.sources,
      kind: record.schedule.kind,
      style: record.schedule.style ?? null,
      reason: record.schedule.reason ?? null,
      degraded: record.schedule.degraded ?? [],
      startSeconds: record.schedule.startSeconds,
      windowSeconds: record.schedule.windowSeconds,
      implementation: record.schedule.implementation,
      events: record.schedule.events.map((event) => `${event.deck}:${event.kind}`),
    })),
  };
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h1>Runtime harness</h1>
      <button onClick={() => void player.playFrom(0)}>Play the runtime set</button>
      <button onClick={() => void player.togglePause()}>Pause or resume</button>
      <QueueSources mix={RUNTIME_MIX} book={book} />
      <pre data-testid="runtime-state">{JSON.stringify(report)}</pre>
    </section>
  );
}
