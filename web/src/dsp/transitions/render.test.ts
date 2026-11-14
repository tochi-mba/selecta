import { describe,it,expect } from 'vitest';
import { renderTransitionWindow } from './render';
import { equalPowerFade, type TransitionScript } from './script';
import { sine } from '../fixtures/synthetic';
import { splitBands,zeroPhaseLowpass } from '../effects/filters';
import { samplePeak } from '../core/dynamics';
const script:TransitionScript={
  style:'bass_swap_blend',duration:1,overlap:[0,1],expectsBeatsAligned:true,
  a:{sourceId:'first',warp:{output:[0,1],source:[0,1]},gain:equalPowerFade(0,1,'out'),low:[[0,1],[0.45,1],[0.55,0]]},
  b:{sourceId:'second',warp:{output:[0,1],source:[0,1]},gain:equalPowerFade(0,1,'in'),low:[[0,0],[0.45,0],[0.55,1]]}
};
describe('Musical transitions',()=>{
  it('preserves exact three-band reconstruction',()=>{
    const pcm=sine(440,0.15,22050,0.35,1),{low,mid,high}=splitBands(pcm);
    let error=0;for(let i=0;i<pcm.channels[0].length;i++)error=Math.max(error,
      Math.abs(low.channels[0][i]+mid.channels[0][i]+high.channels[0][i]-pcm.channels[0][i]));
    expect(error).toBeLessThan(1e-5);
    expect(samplePeak(zeroPhaseLowpass(pcm,250))).toBeLessThan(samplePeak(pcm)*0.2);
  });
  it('renders a bounded two-track musical bass swap with limiter headroom',()=>{
    const a=sine(110,1,22050,0.65,1),b=sine(330,1,22050,0.65,1);
    const artifact=renderTransitionWindow(script,{first:a,second:b},{sampleRate:22050});
    expect(artifact.pcm.channels[0]).toHaveLength(22050);
    expect(artifact.truePeakDb).toBeLessThan(0);
    expect(artifact.kind).toBe('prepared-seam');
    expect(artifact.quality).toBe('approximate');
  });
  it('enforces the phone window limit before allocating',()=>{
    const a=sine(110,1,22050,0.65,1),b=sine(330,1,22050,0.65,1);
    expect(()=>renderTransitionWindow({...script,duration:30,overlap:[0,1]}, {first:a,second:b},
      {sampleRate:44100,duration:30})).toThrow('budget');
  });
});
