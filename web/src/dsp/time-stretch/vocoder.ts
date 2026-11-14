import { allocatePCM, assertPCM, checkCancelled, DSPUnsupported, type PCM, type ProcessingBudget, MOBILE_BUDGET } from '../core/types';
import { fft, hann } from '../core/fft';
/**
 * Phase-vocoder time stretch, independent of playback rate (pitch approximately preserved).
 * This is NOT the native pedalboard/Rubber Band crisp-transient implementation.
 * Quality is bounded to ratios 0.85..1.15 pending listening and stereo-coherence tests.
 */
export function stretchPCM(input: PCM, speed: number, outputFrames?: number, budget:ProcessingBudget=MOBILE_BUDGET, signal?:AbortSignal):PCM {
  const n=assertPCM(input,budget);
  if(!Number.isFinite(speed)||speed<0.85||speed>1.15)throw new DSPUnsupported('Pitch-preserving stretch outside qualified ratio range');
  const count=outputFrames??Math.max(1,Math.round(n/speed));
  const out=allocatePCM(input.sampleRate,input.channels.length,count,input.originSeconds,budget);
  if(Math.abs(speed-1)<1e-7) {
    for(let c=0;c<input.channels.length;c++)out.channels[c].set(input.channels[c].subarray(0,count));
    return out;
  }
  const size=1024, hop=256, window=hann(size), analysisHop=speed*hop;
  const weight=new Float32Array(count);
  const phaseOutput=Array.from({length:input.channels.length},()=>new Float64Array(size));
  const previous=Array.from({length:input.channels.length},()=>new Float64Array(size));
  const frames=Math.ceil(count/hop)+1;
  for(let frame=0;frame<frames;frame++) {
    if((frame&7)===0)checkCancelled(signal);
    const sourceStart=Math.round(frame*analysisHop)-size/2;
    const destStart=frame*hop-size/2;
    for(let i=0;i<size;i++){
      const dst=destStart+i;
      if(dst>=0&&dst<count)weight[dst]+=window[i]*window[i];
    }
    for(let c=0;c<input.channels.length;c++) {
      const re=new Float64Array(size),im=new Float64Array(size),audio=input.channels[c];
      for(let i=0;i<size;i++){const s=sourceStart+i;re[i]=(s>=0&&s<n?audio[s]:0)*window[i];}
      fft(re,im);
      for(let k=0;k<=size/2;k++) {
        const phase=Math.atan2(im[k],re[k]), magnitude=Math.hypot(re[k],im[k]);
        if(frame===0)phaseOutput[c][k]=phase;
        else {
          const expected=2*Math.PI*k*analysisHop/size;
          let diff=phase-previous[c][k]-expected;
          diff-=2*Math.PI*Math.round(diff/(2*Math.PI));
          phaseOutput[c][k]+=2*Math.PI*k*hop/size+diff*hop/analysisHop;
        }
        previous[c][k]=phase;
        re[k]=magnitude*Math.cos(phaseOutput[c][k]);im[k]=magnitude*Math.sin(phaseOutput[c][k]);
        if(k>0&&k<size/2){re[size-k]=re[k];im[size-k]=-im[k];}
      }
      fft(re,im,true);
      for(let i=0;i<size;i++){const dst=destStart+i;
        if(dst>=0&&dst<count)out.channels[c][dst]+=re[i]*window[i];}
    }
  }
  for(let i=0;i<count;i++) {
    const inverse=1/Math.max(1e-8,weight[i]);
    for(let c=0;c<out.channels.length;c++)out.channels[c][i]*=inverse;
  }
  return out;
}
export type Warp = { output:number[]; source:number[] };
export function validateWarp(warp:Warp):void {
  if(warp.output.length<2||warp.source.length!==warp.output.length||
    warp.output.some(v=>!Number.isFinite(v))||warp.source.some(v=>!Number.isFinite(v)))
    throw new DSPUnsupported('Invalid warp control points');
  for(let i=1;i<warp.output.length;i++)if(warp.output[i]<=warp.output[i-1]||warp.source[i]<=warp.source[i-1])
    throw new DSPUnsupported('Warp time mapping must be strictly monotonic');
}
export function warpAt(warp:Warp, t:number):number {
  validateWarp(warp);
  const x=warp.output,y=warp.source;
  if(t<=x[0])return y[0]+(t-x[0])*(y[1]-y[0])/(x[1]-x[0]);
  if(t>=x[x.length-1])return y[y.length-1]+(t-x[x.length-1])*
    (y[y.length-1]-y[y.length-2])/(x[x.length-1]-x[x.length-2]);
  let lo=0,hi=x.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(x[mid]<=t)lo=mid;else hi=mid;}
  return y[lo]+(t-x[lo])*(y[hi]-y[lo])/(x[hi]-x[lo]);
}
/** Approximate per-beat warp, combining individually stretched intervals at exact output positions. */
export function stretchWarp(source:PCM, warp:Warp, outputStart:number, outputFrames:number,
  budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  validateWarp(warp);assertPCM(source,budget);
  const output=allocatePCM(source.sampleRate,source.channels.length,outputFrames,outputStart,budget);
  const rate=source.sampleRate,end=outputStart+outputFrames/rate;
  const cuts=[outputStart,...warp.output.filter(t=>t>outputStart&&t<end),end];
  for(let segment=0;segment<cuts.length-1;segment++){
    checkCancelled(signal);
    const begin=cuts[segment],finish=cuts[segment+1];
    const from=warpAt(warp,begin),to=warpAt(warp,finish);
    const offset=Math.round((begin-outputStart)*rate);
    const frames=Math.min(outputFrames-offset,Math.max(1,Math.round((finish-begin)*rate)));
    const inBegin=Math.round((from-source.originSeconds)*rate);
    const inFrames=Math.max(1,Math.round((to-from)*rate));
    if(inBegin<0||inBegin+inFrames>source.channels[0].length)
      throw new DSPUnsupported('Required audio not present in this authorised local window');
    const clip:PCM={sampleRate:rate,originSeconds:from,channels:source.channels.map(ch=>ch.slice(inBegin,inBegin+inFrames))};
    const segmentAudio=stretchPCM(clip,inFrames/frames,frames,budget,signal);
    const feather=Math.min(Math.round(rate*0.008),frames>>2,offset);
    for(let c=0;c<output.channels.length;c++)for(let i=0;i<frames;i++){
      const at=offset+i;
      if(at>=outputFrames)break;
      const sample=segmentAudio.channels[c][i];
      if(i<feather) {
        const alpha=i/Math.max(1,feather);
        output.channels[c][at]=output.channels[c][at]*(1-alpha)+sample*alpha;
      }else output.channels[c][at]=sample;
    }
  }
  return output;
}
