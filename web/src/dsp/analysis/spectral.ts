import { assertPCM, checkCancelled, clamp, mono, type PCM, type ProcessingBudget, MOBILE_BUDGET, DSP_VERSION } from '../core/types';
import { hann, spectrum } from '../core/fft';
import { resample } from '../core/resample';

export type SpectralFrame = { time: number; rmsDb: number; centroidHz: number; lowShare: number; flux: number; chroma: number[]; mfcc: number[] };
export type Section = {startBar:number; endBar:number; label:'intro'|'verse'|'chorus'|'break'|'outro'; energy:number; group:number; chorusProb:number};
export type MusicalFeatures = {
  version: typeof DSP_VERSION; algorithm:'stft-mel-chroma-mfcc-v1'; sampleRate:22050; hopSeconds:number;
  frames:SpectralFrame[]; onsetEnvelope:number[]; chromaProfile:number[];
  bars:{start:number;end:number;rmsDb:number;lowShare:number;onsetDensity:number;energy:number;chroma:number[];mfcc:number[]}[];
  sections:Section[]; waveform:Uint8Array;
};
const N_FFT=2048, HOP=256, RATE=22050;
const hzToMel=(hz:number)=>2595*Math.log10(1+hz/700);
const melToHz=(m:number)=>700*(10**(m/2595)-1);
const N_MEL=40;
function melFilters(): Float32Array[] {
  const edges=Array.from({length:N_MEL+2},(_,i)=>Math.floor(melToHz(hzToMel(8000)*i/(N_MEL+1))*N_FFT/RATE));
  return Array.from({length:N_MEL},(_,b)=>{
    const result=new Float32Array(N_FFT/2+1);
    const [l,c,r]=edges.slice(b,b+3);
    for(let k=Math.max(0,l);k<=Math.min(N_FFT/2,r);k++)result[k]=k<=c?(k-l)/Math.max(1,c-l):(r-k)/Math.max(1,r-c);
    return result;
  });
}
const MEL=melFilters();
export function extractSpectral(pcm: PCM, barTimes: number[]=[], budget:ProcessingBudget=MOBILE_BUDGET, signal?:AbortSignal): MusicalFeatures {
  assertPCM(pcm,budget);
  // Limit work to the window supplied by caller; never implicitly decode a complete library here.
  const source=mono(pcm);
  const mono22=pcm.sampleRate===RATE?source:mono(resample({sampleRate:pcm.sampleRate,channels:[source],originSeconds:pcm.originSeconds},RATE,{
    ...budget,maxFrames:Math.max(budget.maxFrames,Math.ceil(source.length*RATE/pcm.sampleRate))
  },signal));
  const frames:SpectralFrame[]=[], env:number[]=[], profile=new Array<number>(12).fill(0), window=hann(N_FFT);
  let lastMel=new Float64Array(N_MEL), maxRms=0;
  for(let start=0;start<mono22.length;start+=HOP) {
    if ((frames.length&15)===0)checkCancelled(signal);
    const {power}=spectrum(mono22,start,N_FFT,window);
    let sum=0,weighted=0,low=0;
    const chroma=new Array<number>(12).fill(0);
    for(let k=1;k<power.length;k++) {
      const freq=k*RATE/N_FFT, p=power[k]; sum+=p; weighted+=freq*p;
      if(freq<200)low+=p;
      if(freq>=55&&freq<=5000) {
        const pitch=Math.round(69+12*Math.log2(freq/440));
        chroma[((pitch%12)+12)%12]+=p;
      }
    }
    const mel=new Float64Array(N_MEL);
    for(let m=0;m<N_MEL;m++) {
      let v=0;const weights=MEL[m];
      for(let k=1;k<weights.length;k++)if(weights[k])v+=power[k]*weights[k];
      mel[m]=Math.log10(Math.max(1e-10,v));
    }
    let flux=0;
    for(let m=0;m<N_MEL;m++)flux+=Math.max(0,mel[m]-lastMel[m]);
    flux/=N_MEL;lastMel=mel;
    const mfcc=new Array<number>(20).fill(0);
    for(let coeff=0;coeff<20;coeff++)for(let m=0;m<N_MEL;m++)
      mfcc[coeff]+=mel[m]*Math.cos(Math.PI*coeff*(m+0.5)/N_MEL);
    const peak=Math.max(...chroma,1e-10);
    for(let c=0;c<12;c++){chroma[c]/=peak;profile[c]+=chroma[c];}
    const rmsDb=10*Math.log10(Math.max(1e-10,sum/N_FFT));
    maxRms=Math.max(maxRms,sum);
    frames.push({time:pcm.originSeconds+start/RATE,rmsDb,centroidHz:weighted/Math.max(sum,1e-10),lowShare:low/Math.max(sum,1e-10),flux,chroma,mfcc});
    env.push(flux);
  }
  // Rectify against local baseline, retain onset-time resolution for beat refinement.
  const onsetEnvelope=env.map((v,i)=>Math.max(0,v-0.5*(env[i-1]??v)-0.5*(env[i-2]??v)));
  const duration=pcm.originSeconds+mono22.length/RATE;
  const edges=barTimes.length?[...barTimes,duration]:[pcm.originSeconds,duration];
  const bars:MusicalFeatures['bars']=[];
  for(let b=0;b<edges.length-1;b++) {
    const begin=Math.max(0,Math.floor((edges[b]-pcm.originSeconds)*RATE/HOP));
    const end=Math.max(begin+1,Math.min(frames.length,Math.ceil((edges[b+1]-pcm.originSeconds)*RATE/HOP)));
    const subset=frames.slice(begin,end);
    if(!subset.length)continue;
    const mean=(fn:(f:SpectralFrame)=>number)=>subset.reduce((s,f)=>s+fn(f),0)/subset.length;
    const chroma=Array.from({length:12},(_,k)=>mean(f=>f.chroma[k]));
    const mfcc=Array.from({length:20},(_,k)=>mean(f=>f.mfcc[k]));
    const rmsDb=mean(f=>f.rmsDb),lowShare=mean(f=>f.lowShare),flux=mean(f=>f.flux);
    const energy=clamp(0.55*(rmsDb+60)/60+0.25*flux+0.2*lowShare,0,1);
    bars.push({start:edges[b],end:edges[b+1],rmsDb,lowShare,onsetDensity:flux,energy,chroma,mfcc});
  }
  const waveform=new Uint8Array(160);
  const bin=Math.max(1,Math.floor(mono22.length/160));let peakRms=0;
  const levels=new Float64Array(160);
  for(let b=0;b<160;b++) {
    let p=0,c=0;for(let i=b*bin;i<Math.min((b+1)*bin,mono22.length);i++){p+=mono22[i]*mono22[i];c++;}
    levels[b]=Math.sqrt(p/Math.max(1,c));peakRms=Math.max(peakRms,levels[b]);
  }
  for(let b=0;b<160;b++)waveform[b]=Math.round(255*levels[b]/Math.max(peakRms,1e-9));
  return {version:DSP_VERSION,algorithm:'stft-mel-chroma-mfcc-v1',sampleRate:RATE,hopSeconds:HOP/RATE,frames,onsetEnvelope,
    chromaProfile:profile.map(x=>x/Math.max(1,frames.length)),bars,sections:segmentSections(bars),waveform};
}
/** Bounded section heuristic; native Python uses DP block matching and is richer. */
export function segmentSections(bars:MusicalFeatures['bars']):Section[] {
  if(!bars.length)return[];
  const parts:Section[]=[],avg=bars.reduce((s,b)=>s+b.energy,0)/bars.length;
  // Segment at 4-bar blocks; avoid falsely presenting these as ground-truth musical sections.
  for(let start=0;start<bars.length;start+=4) {
    const end=Math.min(start+4,bars.length),energy=bars.slice(start,end).reduce((s,b)=>s+b.energy,0)/(end-start);
    let label:Section['label']=energy>avg+0.12?'chorus':energy<avg-0.12?'break':'verse';
    if(start===0&&energy<avg)label='intro';
    else if(end===bars.length&&energy<avg)label='outro';
    parts.push({startBar:start,endBar:end,label,energy,group:parts.length,chorusProb:clamp((energy-avg+0.1)*2,0,1)});
  }
  return parts;
}
