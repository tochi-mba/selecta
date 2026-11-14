import { allocatePCM, assertPCM, checkCancelled, db, type PCM, type ProcessingBudget, DESKTOP_BUDGET } from './types';
import { sincAt } from './resample';
export function samplePeak(pcm: PCM): number {
  assertPCM(pcm);
  let max=0;
  for (const channel of pcm.channels) for (let i=0;i<channel.length;i++) max=Math.max(max,Math.abs(channel[i]));
  return max;
}
/** Four-times interpolated peak approximation. Not identical to native soxr HQ. */
export function truePeak(pcm: PCM, signal?: AbortSignal): number {
  const n=assertPCM(pcm); let peak=0;
  for (const channel of pcm.channels) for (let i=0;i<n;i++) {
    if ((i&8191)===0) checkCancelled(signal);
    peak=Math.max(peak,Math.abs(channel[i]));
    if (i+1>=n) continue;
    for (let p=1;p<4;p++) peak=Math.max(peak,Math.abs(sincAt(channel,i+p/4)));
  }
  return peak;
}
/** Look-ahead envelope; no attenuation at all when every sample/intersample is safe. */
export function limitPCM(pcm: PCM, ceilingDb=-1.1, releaseMs=80, budget: ProcessingBudget=DESKTOP_BUDGET, signal?: AbortSignal): PCM {
  const n=assertPCM(pcm,budget), ceiling=10**(ceilingDb/20);
  if (ceilingDb>0||ceilingDb< -30||releaseMs<1||releaseMs>1000) throw new RangeError('Invalid limiter settings');
  // The interpolation and release implementations differ from Python's min+uniform-filter limiter.
  const peak = new Float32Array(n), required = new Float32Array(n);
  let any=false;
  for (let i=0;i<n;i++) {
    if ((i&4095)===0) checkCancelled(signal);
    let p=0;
    for (const channel of pcm.channels) {
      p=Math.max(p,Math.abs(channel[i]));
      if (i+1<n) for(let k=1;k<4;k++) p=Math.max(p,Math.abs(sincAt(channel,i+k/4)));
    }
    peak[i]=p;
    required[i]=Math.min(1,ceiling/Math.max(1e-12,p));
    any ||= required[i]<1;
  }
  if (!any) return pcm;
  const look=Math.min(Math.round(pcm.sampleRate*0.004),n-1);
  const held=new Float32Array(n);
  // Monotonic deque computes look-ahead minimum in O(N).
  const deque=new Int32Array(n);let front=0,back=0;
  for(let i=0;i<n+look;i++) {
    if (i<n) {while(back>front&&required[deque[back-1]]>=required[i])back--;deque[back++]=i;}
    const at=i-look;
    if (at<0)continue;
    while(front<back&&deque[front]<at)front++;
    held[at]=required[deque[front]];
  }
  const out=allocatePCM(pcm.sampleRate,pcm.channels.length,n,pcm.originSeconds,budget);
  const release=Math.exp(-1/(releaseMs/1000*pcm.sampleRate));
  let gain=1;
  for(let i=0;i<n;i++) {
    gain=held[i]<gain?held[i]:release*gain+(1-release)*held[i];
    gain=Math.min(gain,required[i]);
    for(let c=0;c<pcm.channels.length;c++)out.channels[c][i]=pcm.channels[c][i]*gain;
  }
  return out;
}
export function peakReport(pcm: PCM): { peakDb: number; truePeakDb: number } {
  return {peakDb:db(samplePeak(pcm)),truePeakDb:db(truePeak(pcm))};
}
/** K-weighting/gating intentionally NOT claimed here: unweighted RMS is not LUFS. */
export function rmsDb(pcm: PCM): number {
  const n=assertPCM(pcm); let total=0;
  for(const ch of pcm.channels)for(let i=0;i<n;i++)total+=ch[i]**2;
  return db(Math.sqrt(total/(n*pcm.channels.length)));
}
