import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { songs } from './test/backend';

/** The visualizer's read-only left/right taps: made on the player's one context, never reaching the
 * speakers, and made again (old splitter disconnected) when the context is a new one. */

type Node = { kind: string; outs: Node[]; disconnected: boolean; connect(to: Node): void; disconnect(): void };

function node(kind: string, extra: object = {}): Node {
  const made: Node = {
    kind,
    outs: [],
    disconnected: false,
    connect(to: Node) { made.outs.push(to); },
    disconnect() { made.disconnected = true; made.outs = []; },
    ...extra,
  };
  return made;
}

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = node('destination');
  state: AudioContextState = 'suspended';
  constructor() { FakeAudio.now = this; }
  createGain() { return node('gain', { gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {} } }); }
  createAnalyser() { return node('analyser', { fftSize: 0, smoothingTimeConstant: 1, frequencyBinCount: 256 }); }
  splitters: Node[] = [];
  createChannelSplitter() {
    const made = node('splitter');
    this.splitters.push(made);
    return made;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

/** Everything reachable from a node. */
function reach(from: Node, seen = new Set<Node>()): Set<Node> {
  for (const to of from.outs) if (!seen.has(to)) { seen.add(to); reach(to, seen); }
  return seen;
}

const internals = (player: SetPlayer) => player as unknown as { audio(): FakeAudio; context: FakeAudio | null };

beforeEach(() => vi.stubGlobal('AudioContext', FakeAudio));
afterEach(() => vi.unstubAllGlobals());

describe('visualizer side taps', () => {
  it('there are none before the context exists, and they exist once it does', () => {
    const player = new SetPlayer(() => songs(), () => {});
    expect(player.getVisualTaps()).toBeNull();
    internals(player).audio();
    const taps = player.getVisualTaps();
    expect(taps).not.toBeNull();
    expect(taps!.left.fftSize).toBe(1024);
    expect(taps!.right.smoothingTimeConstant).toBe(0);
    expect(player.getVisualTaps()).toBe(taps);
  });

  it('the taps have no path to the speakers', () => {
    const player = new SetPlayer(() => songs(), () => {});
    internals(player).audio();
    const { left, right } = player.getVisualTaps()!;
    expect(reach(left as unknown as Node).has(FakeAudio.now.destination)).toBe(false);
    expect(reach(right as unknown as Node).has(FakeAudio.now.destination)).toBe(false);
    expect((left as unknown as Node).outs).toHaveLength(0);
  });

  it('a new context gets new taps and the old splitter is disconnected', () => {
    const player = new SetPlayer(() => songs(), () => {});
    internals(player).audio();
    const first = FakeAudio.now;
    const before = player.getVisualTaps()!;
    const oldSplitter = first.splitters[0];
    expect(oldSplitter.disconnected).toBe(false);
    internals(player).context = null;
    internals(player).audio();
    expect(FakeAudio.now).not.toBe(first);
    expect(oldSplitter.disconnected).toBe(true);
    const after = player.getVisualTaps()!;
    expect(after).not.toBe(before);
    expect(FakeAudio.now.splitters).toHaveLength(1);
  });
});
