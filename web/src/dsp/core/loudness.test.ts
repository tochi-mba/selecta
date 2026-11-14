import {describe,it,expect} from 'vitest';
import { integratedLoudness,loudnessGainDb } from './loudness';
import { sine,silence } from '../fixtures/synthetic';
describe('Local gated K-weighted loudness',()=>{
  it('measures finite mono and stereo LUFS from synthetic tones',()=>{
    const mono=integratedLoudness(sine(1000,1.5,44100,0.1,1));
    const stereo=integratedLoudness(sine(1000,1.5,44100,0.1,2));
    expect(mono.integratedLufs).toBeGreaterThan(-29);
    expect(mono.integratedLufs).toBeLessThan(-16);
    expect(stereo.integratedLufs!-mono.integratedLufs!).toBeCloseTo(3.0103,0);
  });
  it('distinguishes silence from a measured -infinity loudness',()=>{
    expect(integratedLoudness(silence(44100)).integratedLufs).toBeNull();
    expect(loudnessGainDb(-20,-14,3)).toBe(3);
  });
});
