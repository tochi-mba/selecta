import { allocatePCM, type PCM, type ProcessingBudget, DESKTOP_BUDGET } from '../core/types';
/** Deterministic synthetic vectors: useful for numerics, NOT a substitute for native/audio listening masters. */
export function sine(hz:number,seconds:number,rate=44100,amp=0.3,channels=2,budget:ProcessingBudget=DESKTOP_BUDGET):PCM {
  const frames=Math.round(seconds*rate),pcm=allocatePCM(rate,channels,frames,0,budget);
  for(let i=0;i<frames;i++)for(const ch of pcm.channels)ch[i]=amp*Math.sin(2*Math.PI*hz*i/rate);
  return pcm;
}
export function clicks(bpm:number,seconds:number,rate=44100,channels=2,budget:ProcessingBudget=DESKTOP_BUDGET):PCM {
  const pcm=allocatePCM(rate,channels,Math.round(seconds*rate),0,budget);
  const step=60*rate/bpm;
  for(let beat=0;beat*step<pcm.channels[0].length;beat++){
    const start=Math.round(beat*step);
    for(let i=0;i<Math.min(240,pcm.channels[0].length-start);i++)
      for(const ch of pcm.channels)ch[start+i]=0.8*Math.exp(-i/38)*Math.sin(i*0.7);
  }
  return pcm;
}
export function silence(frames:number,rate=44100,budget:ProcessingBudget=DESKTOP_BUDGET):PCM {
  return allocatePCM(rate,2,frames,0,budget);
}
