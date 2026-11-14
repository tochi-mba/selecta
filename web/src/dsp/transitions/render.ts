import { allocatePCM, assertPCM, checkCancelled, DSP_VERSION, DSPUnsupported, type PCM, type PreparedAudio, type ProcessingBudget, MOBILE_BUDGET } from '../core/types';
import { resample, sincAt } from '../core/resample';
import { limitPCM, peakReport } from '../core/dynamics';
import { integratedLoudness } from '../core/loudness';
import { splitBands, sweepFilter } from '../effects/filters';
import { echoTail,reverbTail } from '../effects/tails';
import { stretchWarp,warpAt } from '../time-stretch/vocoder';
import { curveIs,sampleCurve,validateScript,type TransitionScript,type TransitionPart } from './script';
export type SourceWindows = Record<string,PCM>;
export type RenderOptions={ sampleRate?:number; windowStart?:number; duration?:number; budget?:ProcessingBudget; signal?:AbortSignal; limiterCeilingDb?:number };
/** Prepares one bounded playback window. Consumers overlap adjacent window halos before playback/export. */
export function renderTransitionWindow(script:TransitionScript,sources:SourceWindows,opts:RenderOptions={}):PreparedAudio {
  validateScript(script);
  if(script.meta?.needsBeatPinnedWarp)throw new DSPUnsupported('Tempo-ramp requires a validated piecewise beat-pinned warp; unavailable in this DSP build');
  const sampleRate=opts.sampleRate??44100,budget=opts.budget??MOBILE_BUDGET,signal=opts.signal;
  const start=opts.windowStart??0,duration=opts.duration??script.duration,end=start+duration;
  if(!Number.isFinite(start)||!Number.isFinite(duration)||start<0||duration<=0||end>script.duration+1e-8)
    throw new DSPUnsupported('Invalid bounded transition window');
  const frames=Math.round(duration*sampleRate);
  if(frames<1||frames>budget.maxFrames)throw new DSPUnsupported('Requested transition window exceeds device budget');
  const channelCount=Math.max(1,Math.min(2,...Object.values(sources).map(p=>p.channels.length)));
  // Conservative working-set admission: decoder copies, filter bank, stretch, tails, limiter
  // and worker clones may coexist. Caller must split advanced mobile seams into shorter chunks.
  const parts=[script.a,script.b,...(script.extras??[])];
  const complex=parts.some(p=>p.low||p.mid||p.high||p.lowpass||p.highpass);
  const tails=parts.some(p=>p.echo||p.wash);
  const buffers=8+(complex?8:0)+(tails?4:0);
  if(frames*channelCount*4*buffers>budget.maxBytes)
    throw new DSPUnsupported('Estimated DSP scratch memory exceeds device budget; prepare a smaller window');
  const mixed=allocatePCM(sampleRate,channelCount,frames,start,budget);
  const dry:PCM[]=[];const notes:string[]=[];
  for(const part of [script.a,script.b,...(script.extras??[])]) {
    checkCancelled(signal);
    const input=sources[part.sourceId];
    if(!input)throw new DSPUnsupported('Local PCM source is missing: '+part.sourceId);
    const n=assertPCM(input,budget);
    if(input.channels.length<channelCount)throw new DSPUnsupported('Insufficient source channels for selected output');
    const source=input.sampleRate===sampleRate?input:resample(input,sampleRate,budget,signal);
    if(input.sampleRate!==sampleRate)notes.push('Sinc resampled '+part.sourceId+' from '+input.sampleRate);
    const placed=allocatePCM(sampleRate,channelCount,frames,start,budget);
    const partStart=Math.max(start,part.warp.output[0],part.renderFrom??0);
    const partEnd=Math.min(end,part.warp.output[part.warp.output.length-1],part.renderUntil??script.duration);
    if(partEnd>partStart) {
      const first=Math.round((partStart-start)*sampleRate);
      const count=Math.min(frames-first,Math.round((partEnd-partStart)*sampleRate));
      const lengths=part.warp.output.slice(1).map((v,i)=>(part.warp.source[i+1]-part.warp.source[i])/(v-part.warp.output[i]));
      const identity=lengths.every(v=>Math.abs(v-1)<2e-4);
      if(identity) {
        for(let i=0;i<count;i++) {
          if((i&4095)===0)checkCancelled(signal);
          const absolute=start+(first+i)/sampleRate,position=(warpAt(part.warp,absolute)-source.originSeconds)*sampleRate;
          if(position < -1 || position > source.channels[0].length)
            throw new DSPUnsupported('Source time outside supplied local PCM window');
          for(let c=0;c<channelCount;c++)
            placed.channels[c][first+i]=sincAt(source.channels[c],position);
        }
      } else {
        const stretched=stretchWarp(source,part.warp,partStart,count,budget,signal);
        for(let c=0;c<channelCount;c++)placed.channels[c].set(stretched.channels[c],first);
      }
    }
    const bandsNeeded= !curveIs(part.low,1)||!curveIs(part.mid,1)||!curveIs(part.high,1);
    let audio=placed;
    if(bandsNeeded) {
      const {low,mid,high}=splitBands(audio,budget,signal);
      audio=allocatePCM(sampleRate,channelCount,frames,start,budget);
      for(let i=0;i<frames;i++) {
        const t=start+i/sampleRate;
        const a=sampleCurve(part.low,t),b=sampleCurve(part.mid,t),c=sampleCurve(part.high,t);
        for(let ch=0;ch<channelCount;ch++)audio.channels[ch][i]=low.channels[ch][i]*a+mid.channels[ch][i]*b+high.channels[ch][i]*c;
      }
    }
    if(part.highpass||part.lowpass) {
      for(const [curve,highpass] of [[part.highpass,true],[part.lowpass,false]] as const) {
        if(!curve)continue;
        const hz=Float32Array.from({length:frames},(_,i)=>sampleCurve(curve,start+i/sampleRate));
        audio=sweepFilter(audio,hz,highpass,budget,signal);
      }
    }
    const tails=allocatePCM(sampleRate,channelCount,frames,start,budget);
    if(part.echo&&part.echoSend){
      const send=withCurve(audio,part.echoSend,start,1);
      const delayed=echoTail(send,part.echo,budget,signal);
      mixInto(tails,delayed);
    }
    if(part.wash&&part.washSend) {
      const send=withCurve(audio,part.washSend,start,1);
      mixInto(tails,reverbTail(send,part.wash,budget,signal));
      notes.push('Reverb uses browser Schroeder return, not Python convolution');
    }
    const gain=10**((part.sourceGainDb??0)/20);
    const gained=withCurve(audio,part.gain,start,gain);
    mixInto(mixed,gained);mixInto(mixed,tails);
    dry.push(gained);
  }
  const limited=limitPCM(mixed,opts.limiterCeilingDb??-1.1,80,budget,signal),peaks=peakReport(limited);
  const lufs=frames>=Math.round(sampleRate*.4)?integratedLoudness(limited,signal).integratedLufs:null;
  return {version:DSP_VERSION,kind:'prepared-seam',source:'local-pcm',quality:'approximate',sampleRate,
    channels:channelCount,startSeconds:start,durationSeconds:frames/sampleRate,notes:
    ['Offline prepared PCM only; never render synchronously in AudioWorklet','Native time-stretch/transient/reverb/limiter parity pending',...notes],
    pcm:limited,integratedLufs:lufs,...peaks};
}
function withCurve(pcm:PCM,curve:TransitionPart['gain'],start:number,gain:number):PCM {
  const n=pcm.channels[0].length, out=allocatePCM(pcm.sampleRate,pcm.channels.length,n,pcm.originSeconds,
    {maxFrames:n,maxBytes:Math.max(1024,n*pcm.channels.length*4),maxChannels:pcm.channels.length,fftSize:1024,hop:256});
  for(let i=0;i<n;i++){const value=gain*sampleCurve(curve,start+i/pcm.sampleRate);
    for(let c=0;c<out.channels.length;c++)out.channels[c][i]=pcm.channels[c][i]*value;}
  return out;
}
function mixInto(target:PCM,source:PCM):void {
  for(let c=0;c<target.channels.length;c++)for(let i=0;i<target.channels[c].length;i++)
    target.channels[c][i]+=source.channels[c][i];
}
