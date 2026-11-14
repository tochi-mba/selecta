import { assertPCM, allocatePCM, checkCancelled, type PCM, type ProcessingBudget, DESKTOP_BUDGET } from './types';

/** Symmetric bandlimited windowed-sinc interpolation; position is in source samples. */
export function sincAt(signal: Float32Array, position: number, bandwidth=1, taps=16): number {
  const base = Math.floor(position), f = position-base, cutoff=Math.min(1,Math.max(0.01,bandwidth));
  let sum=0, weight=0;
  for (let i=-taps+1;i<=taps;i++) {
    const pos=base+i, d=i-f;
    if (pos<0||pos>=signal.length) continue;
    const x=Math.PI*d*cutoff;
    const kernel=(Math.abs(x)<1e-10?1:Math.sin(x)/x)*
      (0.5+0.5*Math.cos(Math.PI*d/taps))*cutoff;
    sum+=signal[pos]*kernel;weight+=kernel;
  }
  return weight>1e-8?sum/weight:0;
}
/** Resample decoded PCM to the chosen output rate without playback-rate pitch shifting. */
export function resample(pcm: PCM, rate: number, budget: ProcessingBudget=DESKTOP_BUDGET, signal?: AbortSignal): PCM {
  const n=assertPCM(pcm);
  if (!Number.isFinite(rate)||rate<8000||rate>192000) throw new RangeError('Unsupported resampling rate');
  if (rate===pcm.sampleRate) return pcm;
  const frames=Math.max(1,Math.round(n*rate/pcm.sampleRate));
  const out=allocatePCM(rate,pcm.channels.length,frames,pcm.originSeconds,budget);
  const ratio=pcm.sampleRate/rate,cutoff=Math.min(1,rate/pcm.sampleRate);
  for (let ch=0;ch<pcm.channels.length;ch++)
    for (let i=0;i<frames;i++) {
      if ((i&4095)===0) checkCancelled(signal);
      out.channels[ch][i]=sincAt(pcm.channels[ch],i*ratio,cutoff);
    }
  return out;
}
