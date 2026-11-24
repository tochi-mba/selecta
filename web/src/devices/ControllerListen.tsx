import { Icon } from '../ui/Icon';
import { PageLink } from '../shell/PageLink';
import { countOf } from '../ui/format';
import { bestForMix, mixHeld, preflightWords, type DeviceHolding } from './controller';
import { askWords, stillAsking, type AskState } from './playOn';
import { PlayNoticeLine } from './PlayNoticeLine';
import type { PlayNotice } from './useWhereToPlay';
import './devices.css';

// Listen on a device that holds none of the music, while nothing is playing (ADR-0475 R1, R2).
// It never shows a Play button that cannot work. When another of the person's devices with music
// is open, the one thing to do is "Play on {device}"; when none is, it says so, lists the devices
// that hold music with when each was last seen, and offers to connect music here.

const ago = (seconds: number): string => {
  if (seconds < 90) return 'a moment ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 86_400 * 1.5) return `${Math.max(1, Math.round(seconds / 3600))} hours ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
};

/** What a device can do, in a few words (R1's picker line). With the mix known and the device's
 * songs known: how many of the mix it holds ("All 12 songs", "3 of 12 songs"). */
export function holdingWords(device: DeviceHolding, now: number, mix?: { held: number | null; total: number }): string {
  if (!device.songs) return device.online ? 'No music connected' : `No music connected. Last open ${ago(now - device.last_seen_at)}`;
  const ofMix = mix && mix.held !== null && mix.total > 0
    ? (mix.held >= mix.total ? `All ${countOf(mix.total, 'song')}` : mix.held === 0 ? 'None of these songs' : `${mix.held} of ${countOf(mix.total, 'song')}`)
    : null;
  const has = ofMix ?? countOf(device.songs, 'song');
  return device.online ? has : `${has}. Not open right now, last open ${ago(now - device.last_seen_at)}`;
}

export function ControllerListen({ mixName, mixSongs, mixIds = [], ids, devices, thisDeviceId, now, asking, onPlayOn, notice, onDismissNotice }: {
  /** The current mix on this device's account view; empty when there is none. */
  mixName: string;
  mixSongs: number;
  /** The mix's songs, when known: each device is then judged by how many of them it holds (R1, R3). */
  mixIds?: readonly number[];
  /** Each reporting device's song ids. */
  ids?: ReadonlyMap<string, ReadonlySet<number>>;
  devices: readonly DeviceHolding[];
  thisDeviceId: string | null;
  /** The server's time, for "last open". */
  now: number;
  asking: AskState;
  onPlayOn: (device: DeviceHolding) => void;
  /** The one message about where the music is going; replaces the asking line. */
  notice?: PlayNotice | null;
  onDismissNotice?: () => void;
}) {
  const others = devices.filter((device) => device.device_id !== thisDeviceId);
  const known = ids ?? new Map<string, ReadonlySet<number>>();
  const best = bestForMix(others, known, mixIds);
  const ofMix = (device: DeviceHolding) => (mixIds.length ? { held: mixHeld(known, device.device_id, mixIds), total: mixIds.length } : undefined);
  const bestHeld = best ? ofMix(best)?.held ?? null : null;
  const preflight = best ? preflightWords(best.name, bestHeld, mixIds.length) : null;
  // R3: another open device holds the whole mix while the suggested one does not
  const whole = preflight ? others.find((device) => device.online && device !== best && mixHeld(known, device.device_id, mixIds) === mixIds.length) ?? null : null;
  const able = others.filter((device) => device.online && device.songs > 0);
  const away = others.filter((device) => device.songs > 0 && !device.online);
  const busy = stillAsking(asking);
  return (
    <main className="page remote-listen controller-listen" id="main" data-holder={best ? 'online' : 'none'}>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="display small">Listen</h1>
        </div>
      </header>
      <div className="remote-layout">
        <section className="remote-card" aria-label="Play on another device">
          <p className="remote-where" data-testid="controller-where"><Icon name="music" size="compact" />Nothing is playing</p>
          <div className="remote-song">
            <h2 dir="auto">{mixSongs ? mixName : 'No mix yet'}</h2>
            <p>{mixSongs ? countOf(mixSongs, 'song') : 'Make a mix and it plays on the device that has your music.'}</p>
          </div>
          {best ? (
            <>
              <button type="button" className="primary big controller-play" disabled={busy} aria-busy={busy || undefined} data-testid="play-on" onClick={() => onPlayOn(best)}>
                <Icon name="play" /> Play on {best.name}
              </button>
              {preflight && <p className="remote-state" data-testid="preflight">{preflight}</p>}
              {whole && <button type="button" disabled={busy} data-testid="play-on-whole" onClick={() => onPlayOn(whole)}>Play on {whole.name}, which has all {mixIds.length}</button>}
              <p className="remote-sound">This device has no music on it, so {best.name} makes the sound and this one is its remote.</p>
            </>
          ) : (
            <p className="remote-state" role="status" data-testid="controller-none">
              {away.length ? 'None of your devices with music is open right now. Open SelectaDJ on one of them.' : 'None of your devices has music connected yet.'}
            </p>
          )}
          {notice ? <PlayNoticeLine notice={notice} onDismiss={() => onDismissNotice?.()} /> : asking && <p className="controller-asking" role="status" data-testid="play-on-status" data-phase={asking.phase}>{askWords(asking.phase, asking.device)}</p>}
        </section>
        <div className="remote-side">
          {(able.length > 1 || away.length > 0) && (
            <section className="controller-devices" aria-label="Your devices with music">
              <h2>Your devices</h2>
              <ul>
                {[...able, ...away].map((device) => (
                  <li key={device.device_id} data-online={device.online || undefined}>
                    <span className="controller-device-words"><b dir="auto">{device.name}</b><span>{holdingWords(device, now, ofMix(device))}</span></span>
                    {device.online && <button type="button" disabled={busy} onClick={() => onPlayOn(device)} aria-label={`Play on ${device.name}: ${holdingWords(device, now, ofMix(device))}`}>Play on it</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="remote-device">
            Want this device to make the sound? <PageLink to="/library">Connect music here</PageLink>
          </p>
        </div>
      </div>
    </main>
  );
}
