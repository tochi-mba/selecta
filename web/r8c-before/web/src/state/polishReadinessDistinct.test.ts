import { describe, expect, it } from 'vitest';
import { trackReadiness } from './readiness';

/** P0102 (ADR-0043): analysed is not mix-ready, Never play is not Set aside, and priority never
 * changes readiness. */
describe('P0102 library states stay distinct', () => {
  it('an analysed song that is not mix-ready can be added by hand but cannot start a mix', () => {
    const analysed = trackReadiness({ bpm: 120, readiness: { status: 'analysed_incomplete', reason: 'No clean ending yet' } });
    const ready = trackReadiness({ bpm: 120, readiness: { status: 'mix_ready', reason: '' } });
    expect(analysed.words).not.toBe(ready.words);
    expect(analysed).toMatchObject({ canAdd: true, canStartMix: false });
    expect(ready).toMatchObject({ canAdd: true, canStartMix: true });
  });

  it('Never play and Set aside read differently, and only Set aside means not music', () => {
    const never = trackReadiness({ bpm: 120, readiness: { status: 'excluded', reason: 'Never plays' } });
    const aside = trackReadiness({ bpm: 120, readiness: { status: 'set_aside', reason: 'Not music' } });
    expect(never.words).toBe('Never plays');
    expect(aside.words).toBe('Set aside');
    expect(never.setAside).toBe(false);
    expect(aside.setAside).toBe(true);
    for (const facts of [never, aside]) expect(facts).toMatchObject({ canAdd: false, canStartMix: false, canAnalyse: false });
  });

  it('priority leaves readiness exactly as it was', () => {
    for (const status of ['queued', 'mix_ready', 'analysed_incomplete', 'needs_attention'] as const) {
      const base = { bpm: status === 'queued' ? null : 120, readiness: { status, reason: '' } };
      expect(trackReadiness({ ...base, priority: true } as never)).toEqual(trackReadiness({ ...base, priority: false } as never));
    }
  });
});
