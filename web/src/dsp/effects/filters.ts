import { allocatePCM, assertPCM, checkCancelled, DSPUnsupported, type PCM, type ProcessingBudget, MOBILE_BUDGET } from '../core/types';
export type BandSplit={low:PCM;mid:PCM;high:PCM};
/** Second-order Butterworth, forward/backward; zero phase except boundary padding differences vs scipy. */
export function zeroPhaseLowpass(pcm:PCM,cutoff:number,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  const n=assertPCM(pcm,budget),sr=pcm.sampleRate;
  if(!Number.isFinite(cutoff)||cutoff<10||cutoff>=sr*.49)throw new DSPUnsupported('Filter cutoff outside valid range');
  const k=Math.tan(Math.PI*cutoff/sr),norm=1/(1+Math.SQRT2*k+k*k),b0=k*k*norm;
  const b1=2*b0,b2=b0,a1=2*(k*k-1)*norm,a2=(1-Math.SQRT2*k+k*k)*norm;
  const out=allocatePCM(sr,pcm.channels.length,n,pcm.originSeconds,budget);
  for(let c=0;c<pcm.channels.length;c++) {
    const inCh=pcm.channels[c],ch=out.channels[c];
    for(const reverse of [false,true]) {
      let x1=reverse?ch[n-1]:inCh[0],x2=x1,y1=x1,y2=x1;
      for(let i=0;i<n;i++) {
        if((i&8191)===0)checkCancelled(signal);
        const at=reverse?n-i-1:i, x=reverse?ch[at]:inCh[at];
        const y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;
        ch[at]=y;x2=x1;x1=x;y2=y1;y1=y;
      }
    }
  }
  return out;
}
export function zeroPhaseHighpass(pcm:PCM,cutoff:number,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  const low=zeroPhaseLowpass(pcm,cutoff,budget,signal);
  for(let c=0;c<low.channels.length;c++)for(let i=0;i<low.channels[c].length;i++)
    low.channels[c][i]=pcm.channels[c][i]-low.channels[c][i];
  return low;
}
/** Exact split reconstruction even with finite precision: mid = original - low - high. */
export function splitBands(pcm:PCM,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):BandSplit {
  const low=zeroPhaseLowpass(pcm,200,budget,signal),high=zeroPhaseHighpass(pcm,2500,budget,signal);
  const mid=allocatePCM(pcm.sampleRate,pcm.channels.length,pcm.channels[0].length,pcm.originSeconds,budget);
  for(let c=0;c<pcm.channels.length;c++)for(let i=0;i<mid.channels[c].length;i++)
    mid.channels[c][i]=pcm.channels[c][i]-low.channels[c][i]-high.channels[c][i];
  return {low,mid,high};
}
/** Logarithmic zero-phase filter bank, crossfaded between fixed cutoffs (native strategy). */
export function sweepFilter(pcm:PCM,cutoffs:Float32Array,highpass:boolean,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  const n=assertPCM(pcm,budget);
  if(cutoffs.length!==n)throw new DSPUnsupported('Sweep curve must match frame count');
  let min=Infinity,max=0;
  for(let i=0;i<n;i++){min=Math.min(min,cutoffs[i]);max=Math.max(max,cutoffs[i]);}
  min=Math.max(10,min);max=Math.min(pcm.sampleRate*.45,max);
  if(min>max)throw new DSPUnsupported('Invalid filter sweep range');
  const count=Math.min(7,Math.max(2,Math.ceil(Math.log2(Math.max(1.01,max/min))*3)+1));
  // Avoid simultaneously retaining an unbounded bank on small devices.
  const bank=Array.from({length:count},(_,i)=> {
    const hz=min*(max/min)**(i/(count-1));
    return highpass?zeroPhaseHighpass(pcm,hz,budget,signal):zeroPhaseLowpass(pcm,hz,budget,signal);
  });
  const out=allocatePCM(pcm.sampleRate,pcm.channels.length,n,pcm.originSeconds,budget);
  for(let i=0;i<n;i++){
    if((i&8191)===0)checkCancelled(signal);
    const where=(Math.log(Math.max(min,Math.min(max,cutoffs[i]))/min)/Math.max(1e-9,Math.log(max/min)))*(count-1);
    const a=Math.min(count-2,Math.max(0,Math.floor(where))),mix=Math.max(0,Math.min(1,where-a));
    for(let c=0;c<out.channels.length;c++)
      out.channels[c][i]=bank[a].channels[c][i]*(1-mix)+bank[a+1].channels[c][i]*mix;
  }
  return out;
}
