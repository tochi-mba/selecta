import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { countOf } from '../ui/format';
import { stillAsking } from './playOn';
import type { DeviceHolding } from './controller';
import type { PlayWays } from './RemoteListen';

// ADR-0475 G2 (item 58): move the music while it plays. "Play here instead" when this device has
// songs of the programme, and "Move to {device}" for every other open device with music, each
// saying first what it lacks ("Has 8 of 10 songs. 2 will be skipped."). Moving asks that device
// to take the music over from where it is (a start ask marked `move`).

/** What a device would leave out of the programme, said before the move. */
export function moveWords(held: number | null, total: number): string {
  if (held === null || total <= 0) return 'Has music connected';
  if (held >= total) return `Has all ${countOf(total, 'song')}`;
  if (held === 0) return 'Has none of these songs';
  const left = total - held;
  return `Has ${held} of ${countOf(total, 'song')}. ${left === 1 ? '1 will be skipped' : `${left} will be skipped`}.`;
}

export function RemoteMove({ ways, total }: { ways: PlayWays; total: number }) {
  const [open, setOpen] = useState(false);
  const busy = stillAsking(ways.asking);
  const targets = ways.devices.filter((device) => device.online && device.songs > 0)
    .map((device) => ({ device, mix: ways.ofMix?.(device) }))
    .filter(({ mix }) => !mix || mix.held === null || mix.held > 0)
    .sort((one, other) => (other.mix?.held ?? other.device.songs) - (one.mix?.held ?? one.device.songs));
  if (!targets.length && ways.hereSongs <= 0) return null;
  const move = (device: DeviceHolding) => (ways.onMove ?? ways.onPlayOn)(device);
  return (
    <section className="remote-move" aria-label="Move the music">
      <button type="button" className="remote-move-toggle" aria-expanded={open} onClick={() => setOpen((on) => !on)} data-testid="move-toggle">Move the music</button>
      {open && (
        <ul className="remote-ways-list">
          {ways.hereSongs > 0 && (
            <li>
              <span className="controller-device-words"><b>This device</b><span>{moveWords(ways.hereSongs, total)}</span></span>
              <button type="button" disabled={busy} onClick={ways.onPlayHere} data-testid="move-here"><Icon name="play" /> Play here instead</button>
            </li>
          )}
          {targets.map(({ device, mix }) => (
            <li key={device.device_id}>
              <span className="controller-device-words"><b dir="auto">{device.name}</b><span>{moveWords(mix?.held ?? null, mix?.total ?? total)}</span></span>
              <button type="button" disabled={busy} onClick={() => move(device)} data-testid="move-to"><Icon name="play" /> Move to {device.name}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
