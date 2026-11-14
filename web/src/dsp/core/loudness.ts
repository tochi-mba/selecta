import { assertPCM,checkCancelled,DSPUnsupported,type PCM } from './types';
export type LoudnessReport={integratedLufs:number|null;ungatedLufs:number|null;blocks:number;absoluteGateLufs:-70;relativeGateLu:-10;method:'bs1770-k-weighting-gated-approx'};
type Coeff={b0:number;b1:number;b2:number;a1:number;a2:number};
function normalize(b0:number,b1:number,b2:number,a0:number,a1:number,a2:number):Coeff {
  return {b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0};
}
/** ITU-R BS.1770 K weighting approximated through sample-rate-aware biquad formulas. */
function shelf(sr:number):Coeff {
  const f=1681.974450955533,gain=3.999843853973347,q=0.7071752369554196;
  const A=10**(gain/40),w=2*Math.PI*f/sr,cs=Math.cos(w);
  const alpha=Math.sin(w)/(2*q),s=2*Math.sqrt(A)*alpha;
  return normalize(A*((A+1)+(A-1)*cs+s),-2*A*((A-1)+(A+1)*cs),A*((A+1)+(A-1)*cs-s),
    (A+1)-(A-1)*cs+s,2*((A-1)-(A+1)*cs),(A+1)-(A-1)*cs-s);
}
function highpass(sr:number):Coeff {
  const w=2*Math.PI*38.13547087602444/sr,q=0.5003270373238773,alpha=Math.sin(w)/(2*q),c=Math.cos(w);
  return normalize((1+c)/2,-(1+c),(1+c)/2,1+alpha,-2*c,1-alpha);
}
function process(ch:Float32Array,coeff:Coeff):Float64Array {
  const out=new Float64Array(ch.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<ch.length;i++){const x=ch[i],y=coeff.b0*x+coeff.b1*x1+coeff.b2*x2-coeff.a1*y1-coeff.a2*y2;
    out[i]=y;x2=x1;x1=x;y2=y1;y1=y;}
  return out;
}
function weighted(ch:Float32Array,sr:number):Float64Array {
  const first=process(ch,shelf(sr));
  // Avoid allocating an additional Float32Array for the intermediate.
  const hp=highpass(sr),out=new Float64Array(ch.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<first.length;i++){const x=first[i],y=hp.b0*x+hp.b1*x1+hp.b2*x2-hp.a1*y1-hp.a2*y2;
    out[i]=y;x2=x1;x1=x;y2=y1;y1=y;}return out;
}
/**
 * EBU R128-style 400ms blocks, 75% overlap, -70 LUFS absolute + -10 LU relative gates.
 * Stereo/mono only. Numerical parity with pyloudnorm is not yet established.
 */
export function integratedLoudness(pcm:PCM,signal?:AbortSignal):LoudnessReport {
  const n=assertPCM(pcm);
  if(pcm.channels.length>2)throw new DSPUnsupported('K-weighting for multichannel layouts is not calibrated');
  const sr=pcm.sampleRate,window=Math.round(sr*.4),hop=Math.round(sr*.1);
  if(n<window)throw new DSPUnsupported('Integrated loudness requires at least 400ms of PCM');
  const channels=pcm.channels.map(c=>weighted(c,sr)),energies:number[]=[];
  for(let start=0;start+window<=n;start+=hop){
    checkCancelled(signal);
    let energy=0;
    for(const ch of channels)for(let i=start;i<start+window;i++)energy+=ch[i]*ch[i];
    energies.push(energy/window);
  }
  const lufs=(value:number)=>-0.691+10*Math.log10(Math.max(value,1e-30));
  const absolute=energies.filter(x=>lufs(x)>-70);
  if(!absolute.length)return {integratedLufs:null,ungatedLufs:null,blocks:energies.length,
    absoluteGateLufs:-70,relativeGateLu:-10,method:'bs1770-k-weighting-gated-approx'};
  const preliminary=absolute.reduce((a,b)=>a+b,0)/absolute.length,threshold=lufs(preliminary)-10;
  const included=absolute.filter(x=>lufs(x)>=threshold);
  const final=included.reduce((a,b)=>a+b,0)/Math.max(1,included.length);
  return {integratedLufs:lufs(final),ungatedLufs:lufs(preliminary),blocks:energies.length,
    absoluteGateLufs:-70,relativeGateLu:-10,method:'bs1770-k-weighting-gated-approx'};
}
export function loudnessGainDb(measured:number,target=-14,maxBoostDb=12):number {
  if(!Number.isFinite(measured)||!Number.isFinite(target))throw new DSPUnsupported('Cannot normalise unknown loudness');
  return Math.min(maxBoostDb,target-measured);
}
