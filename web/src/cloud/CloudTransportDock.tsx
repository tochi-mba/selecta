// Hosted mode only (ADR-0462): local-first accounts get the shared views and shell player instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayingBar } from '../devices/PlayingBar';
import type { Speaker } from '../devices/usePlaybackDevice';
import { accountFlagOn, type FlagId } from '../flags';
import { Account, Api, Page } from './api';
import { assetCatalogue, catalogueSource } from './cloudCatalogue';
import { claimFocus, clearNotice, releaseFocus, shareLibraryPlayer, useTransport } from './cloudTransport';
import { recoveringSpeaker } from './recoveringSpeaker';
import { useCloudPlayer } from './useCloudPlayer';
import { CoverArt } from '../views/CoverArt';
import { DockTransport, type DockClock } from '../views/DockTransport';
import { useFeelPart } from '../views/feelBits';

// The one Cloud player (ADR-0419, flag `cloud.single_audio_owner`). CloudApp mounts this dock
// above the pages, so the Library's song player and this browser as the session's speaker keep
// playing while the person moves between pages (AV-0419-02). Starting either one pauses the
// other and nothing resumes on its own (AV-0419-03, see cloudTransport.ts). The speaker joins
// the dock the first time Listen is opened in this tab, as the bar did before, and then stays.

export const SINGLE_AUDIO_OWNER: FlagId = 'cloud.single_audio_owner';

export function singleAudioOwner(account: Pick<Account, 'features'> | null) {
  return accountFlagOn(SINGLE_AUDIO_OWNER, account?.features ?? null);
}

export function CloudTransportDock({ api, account, page, reload = 0 }: { api: Api; account: Account; page: Page; reload?: number }) {
  const workspaceId = account.workspace.id;
  const audioRef = useRef<HTMLAudioElement>(null);
  const deviceBox = useRef<HTMLDivElement>(null);
  const deviceSpeaker = useRef<Speaker | null>(null);
  const [error, setError] = useState('');
  const [deviceProblem, setDeviceProblem] = useState('');
  const [armed, setArmed] = useState(page === 'listen');
  const player = useCloudPlayer({ api, workspaceId, audio: audioRef, setError, skipOnFailure: true });
  const transport = useTransport();

  useEffect(() => { if (page === 'listen') setArmed(true); }, [page]);
  // The Library page plays through this dock's player rather than its own element.
  useEffect(() => { shareLibraryPlayer(workspaceId, player); });
  useEffect(() => () => {
    deviceSpeaker.current = null;
    shareLibraryPlayer(null, null);
    releaseFocus('library');
    releaseFocus('device');
  }, [workspaceId]);

  // Stored media off (ADR-0456 reads grant): nothing to play from, and no read of /assets.
  const storedMedia = accountFlagOn('cloud.stored_media', account.features);
  const library = useMemo(() => catalogueSource(api, workspaceId, assetCatalogue(api, workspaceId, storedMedia)), [api, workspaceId, storedMedia]);
  useEffect(() => { if (reload) library.catalogue.refresh(); }, [library, reload]);
  const speakerFor = useCallback((audio: HTMLAudioElement, source: (index: number) => Promise<string | null>): Speaker => {
    const made = recoveringSpeaker(audio, source, { onProblem: setDeviceProblem, songName: library.name });
    deviceSpeaker.current = made;
    return made;
  }, [library]);

  // The speaker's element lives inside PlayingBar; media events don't bubble, but they do pass
  // through ancestors while capturing, so the dock hears the speaker start without reaching in.
  useEffect(() => {
    const box = deviceBox.current;
    if (!box) return;
    const started = (event: Event) => {
      const element = event.target as HTMLMediaElement;
      // Recovery may play the next song immediately after reporting a failed one.
      // Do not erase that explanation on its automatic `play` event.
      claimFocus({ id: 'device', pause: () => {
        // Pausing for Library focus must reach the recovery wrapper too, otherwise
        // a pending failed-track skip can restart the speaker after the Library wins.
        deviceSpeaker.current?.pause();
        element.pause();
      } });
    };
    // Paused or faded out (the lease moved): it no longer holds the sound.
    const stopped = () => releaseFocus('device');
    box.addEventListener('play', started, true);
    box.addEventListener('pause', stopped, true);
    return () => { box.removeEventListener('play', started, true); box.removeEventListener('pause', stopped, true); };
  }, [armed]);

  const libraryStarted = () => {
    player.heard();
    void player.prefetchNext();
    claimFocus({ id: 'library', pause: () => audioRef.current?.pause() });
  };
  const libraryPaused = () => {
    player.heard();
    releaseFocus('library');
  };
  const libraryEnded = () => {
    if (!player.upNext) releaseFocus('library');
    player.advance();
  };

  // ADR-0477: with depth on, the browser's own audio widget gives way to SelectaDJ's small transport,
  // which drives this same element. The element's own events are the clock, so nothing is guessed.
  // No beat effects here: this audio cannot be measured safely (ADR-0477, honest limits).
  const custom = useFeelPart('depth');
  const [clockState, setClockState] = useState<DockClock>({ time: 0, duration: 0, playing: false });
  const follow = (element: HTMLAudioElement) => {
    if (!custom) return;
    const next = { time: element.currentTime || 0, duration: Number.isFinite(element.duration) ? element.duration : 0, playing: !element.paused && !element.ended };
    setClockState((was) => (Math.abs(was.time - next.time) < 0.25 && was.duration === next.duration && was.playing === next.playing ? was : next));
  };

  const track = player.track;
  const devices = accountFlagOn('devices', account.features);
  const showDevice = devices && armed;
  if (!track && !showDevice && !error) return null;
  return (
    <section className="cloud-transport" aria-label="SelectaDJ player" data-focus={transport.focus ?? 'none'}>
      {showDevice && (
        <div ref={deviceBox}>
          <PlayingBar api={api} workspaceId={workspaceId} source={library.source} songName={library.name}
            remoteControl={accountFlagOn('devices.remote_control', account.features)} speakerFor={speakerFor} />
          {deviceProblem && <p className="cloud-feedback error" role="alert">{deviceProblem} <button type="button" onClick={() => setDeviceProblem('')}>Dismiss</button></p>}
        </div>
      )}
      {track && (
        <section className="cloud-card cloud-library-player" aria-label="Player">
          {/* the playing file's own picture kept on this device where it has one (its content hash
              is the key), the same tile as its Library row otherwise */}
          {custom && <CoverArt seed={track.id} songKey={player.queue[player.index]?.id === track.id ? player.queue[player.index]?.sha256 ?? undefined : undefined} size="small" />}
          <div>
            <p className="cloud-eyebrow">Now playing from your library</p>
            <strong data-testid="now-playing">{track.name}</strong>
            {player.upNext && <p className="cloud-up-next" data-testid="up-next">Up next: {player.upNext.name}{player.bufferedId === player.upNext.id ? ' · loaded' : ''}</p>}
          </div>
          {custom && <DockTransport audio={audioRef} clock={clockState} />}
          <audio ref={audioRef} controls={!custom} autoPlay={player.autoplay} src={track.url} data-track={track.id} data-testid="library-audio"
            onLoadedMetadata={(event) => { player.loaded(); follow(event.currentTarget); }}
            onTimeUpdate={(event) => { player.heard(); follow(event.currentTarget); }}
            onDurationChange={(event) => follow(event.currentTarget)}
            onPause={(event) => { libraryPaused(); follow(event.currentTarget); }}
            onPlaying={(event) => { libraryStarted(); follow(event.currentTarget); }}
            onPlay={(event) => { libraryStarted(); follow(event.currentTarget); }}
            onEnded={(event) => { libraryEnded(); follow(event.currentTarget); }} onError={() => void player.refreshUrl()} />
        </section>
      )}
      {error && <p className="cloud-feedback error" role="alert" data-testid="library-player-error">{error}</p>}
      {transport.notice && <p className="cloud-feedback" role="status">{transport.notice} <button type="button" onClick={clearNotice}>Dismiss</button></p>}
    </section>
  );
}
