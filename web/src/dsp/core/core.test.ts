import { describe,it,expect } from 'vitest';
import { fft } from './fft';
import { resample } from './resample';
import { limitPCM, truePeak, samplePeak } from './dynamics';
import { allocatePCM, DSPUnsupported, MOBILE_BUDGET } from './types';
import { sine } from '../fixtures/synthetic';
describe('DSP core numerics',()=>{
  it('inverts FFT within floating-point tolerance',()=>{
    const x=Float64Array.from({length:64},(_,i)=>Math.sin(i*0.6)),re=x.slice(),im=new Float64Array(64);
    fft(re,im);fft(re,im,true);
    expect(Math.max(...Array.from(x,(_,i)=>Math.abs(re[i]-x[i])))).toBeLessThan(1e-9);
  });
  it('resamples 48k to 44.1k while preserving duration and amplitude',()=>{
    const input=sine(440,0.5,48000),output=resample(input,44100);
    expect(output.channels[0].length).toBe(22050);
    expect(Math.abs(samplePeak(output)-0.3)).toBeLessThan(0.005);
  });
  it('preserves safe samples exactly and attenuates >ceiling peaks',()=>{
    const quiet=sine(440,0.25,44100,0.3);
    expect(limitPCM(quiet)).toBe(quiet);
    const hot=sine(440,0.25,44100,1.4);
    const limited=limitPCM(hot);
    expect(samplePeak(limited)).toBeLessThanOrEqual(10**(-1.1/20)+0.001);
    expect(truePeak(limited)).toBeLessThan(0.92);
  });
  it('refuses unbounded phone windows and invalid PCM',()=>{
    expect(()=>allocatePCM(44100,2,MOBILE_BUDGET.maxFrames+1,0,MOBILE_BUDGET)).toThrow(DSPUnsupported);
    expect(()=>allocatePCM(44100,2,-1)).toThrow(DSPUnsupported);
  });
});
