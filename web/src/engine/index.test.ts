import { describe, expect, it } from 'vitest';
import { createEngine } from './index';
import { FakeAudioContext, FakeDocument } from './testAudio';

describe('the engine owner', () => {
  it('closes every context it opened when the runtime is disposed', () => {
    const engine = createEngine();
    const context = new FakeAudioContext();
    const opened = engine.openContext({
      fromUserGesture: true,
      create: () => context as unknown as AudioContext,
      watchDocument: new FakeDocument(),
      watchMediaDevices: null,
    });
    expect('context' in opened).toBe(true);
    expect(context.state).toBe('running');
    engine.dispose();
    expect(context.state).toBe('closed');
  });
});
