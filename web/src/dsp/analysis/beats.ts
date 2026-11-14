import { clamp, median } from '../core/types';
export type BeatGrid = {
  beats:number[]; barStarts:number[]; bpm:number; beatsPerBar:number;
  confidence:number; constantTempo:boolean; gridRmsMs:number; onsetAgreement:number;
  downbeatRegularity:number; tempoStability:number; provenance:'browser-autocorrelation'|'external-raw-beats';
};
export interface BeatModelAdapter { infer(pcm: import('../core/types').PCM):Promise<{beats:number[];downbeats:number[]}> }
const RATIO_HOP=256/22050;
function regularize(beats: number[]): number[] {
  if(beats.length<4)return [...beats];
  const period=median(beats.slice(1).map((x,i)=>x-beats[i]));
  const out=[beats[0]];
  for(const beat of beats.slice(1)){const gap=beat-out[out.length-1];if(gap<period*0.55)continue;
    const count=Math.max(1,Math.round(gap/period));const last=out[out.length-1];
    for(let i=1;i<count;i++)out.push(last+gap*i/count);out.push(beat);}
  return out;
}
function nearestStrength(t:number,env:readonly number[],hop:number):{offset:number;strength:number} {
  let peak=0,offset=0;const centre=Math.round(t/hop),r=Math.round(0.04/hop);
  for(let i=Math.max(0,centre-r);i<=Math.min(env.length-1,centre+r);i++)
    if(env[i]>peak){peak=env[i];offset=i*hop-t;}
  return {strength:peak,offset};
}
export function fitBeatGrid(raw:readonly number[],env:readonly number[],hop=RATIO_HOP,downbeats:readonly number[]=[]):BeatGrid|null {
  const beats=regularize([...raw].filter(Number.isFinite).sort((a,b)=>a-b));
  if(beats.length<4)return null;
  const intervals=beats.slice(1).map((b,i)=>b-beats[i]),period=median(intervals);
  if(period<=0)return null;
  const initial=beats[0],indices=beats.map((b)=>Math.round((b-initial)/period));
  const slope=indices.reduce((s,k,i)=>s+k*(beats[i]-initial),0)/Math.max(1,indices.reduce((s,k)=>s+k*k,0));
  const drift=beats.map((b,i)=>b-(initial+indices[i]*slope));
  const agreement=drift.filter(x=>Math.abs(x)<=0.03).length/drift.length;
  const constantTempo=agreement>=0.7 && beats.length>=16 && Math.sqrt(drift.reduce((s,x)=>s+x*x,0)/drift.length)<0.016;
  const grid=constantTempo?Array.from({length:indices[indices.length-1]+1},(_,i)=>initial+i*slope):beats;
  const good=grid.map(t=>nearestStrength(t,env,hop)),strong=good.filter(v=>v.strength>0);
  const sorted=env.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b),threshold=sorted[Math.floor(sorted.length*0.7)]??0;
  const offsets=good.filter(v=>v.strength>=threshold && v.strength>0).map(v=>v.offset);
  const nudge=offsets.length>=4?median(offsets):0;
  const refined=grid.map(t=>t+nudge);
  const hit=good.filter(v=>v.strength>=threshold&&Math.abs(v.offset-nudge)<0.03).length/Math.max(1,good.length);
  let meter=4,barStarts:number[]=[];
  if(downbeats.length>=2) {
    const matched=downbeats.map(t=>refined.reduce((best,b,i)=>Math.abs(b-t)<Math.abs(refined[best]-t)?i:best,0))
      .filter(i=>Math.abs(refined[i]-downbeats[downbeats.findIndex(t=>Math.abs(t-refined[i])<=0.09)])<=0.09);
    const gaps=matched.slice(1).map((i,j)=>i-matched[j]);
    meter=gaps.filter(g=>g===3).length>gaps.filter(g=>g===4).length?3:4;
    const phase=matched.length?matched.reduce((votes,i)=>{votes[i%meter]++;return votes;},new Array<number>(meter).fill(0)).indexOf(Math.max(...Array.from({length:meter},(_,p)=>matched.filter(i=>i%meter===p).length))):0;
    barStarts=refined.map((_,i)=>i).filter(i=>i%meter===phase);
  } else barStarts=refined.map((_,i)=>i).filter(i=>i%meter===0);
  const regularity=downbeats.length>=2?clamp(downbeats.length/Math.max(1,barStarts.length),0,1):0;
  const stdev=Math.sqrt(intervals.reduce((s,x)=>s+(x-period)**2,0)/intervals.length);
  const stability=constantTempo?1:clamp(1-stdev/period/0.05,0,1);
  const rms=Math.sqrt(drift.reduce((s,x)=>s+x*x,0)/drift.length)*1000;
  return {beats:refined,barStarts,bpm:60/median(refined.slice(1).map((v,i)=>v-refined[i])),beatsPerBar:meter,
    confidence:clamp((0.5*hit+0.5*regularity)*(0.35+0.65*stability),0,1),constantTempo,gridRmsMs:rms,
    onsetAgreement:hit,downbeatRegularity:regularity,tempoStability:stability,provenance:'external-raw-beats'};
}
/** Lightweight fallback; missing downbeats must NOT be represented as high confidence. */
export function detectBeats(env:readonly number[],hop=RATIO_HOP,origin=0):BeatGrid|null {
  if(env.length<16)return null;
  const max=Math.min(env.length-1,Math.floor(60/65/hop)),min=Math.max(1,Math.ceil(60/185/hop));
  let bestLag=0,best=-Infinity;
  for(let lag=min;lag<=max;lag++) {
    let score=0,power=0;
    for(let i=lag;i<env.length;i++){score+=env[i]*env[i-lag];power+=env[i]*env[i];}
    const result=score/Math.max(1e-12,power);
    if(result>best){best=result;bestLag=lag;}
  }
  if(!bestLag||best<0.035)return null;
  const period=bestLag*hop;
  let phase=0,strength=-Infinity;
  for(let shift=0;shift<bestLag;shift++){
    let total=0;for(let i=shift;i<env.length;i+=bestLag)total+=env[i];
    if(total>strength){strength=total;phase=shift;}
  }
  const raw:number[]=[];
  for(let t=origin+phase*hop;t<origin+env.length*hop;t+=period)raw.push(t);
  const local=fitBeatGrid(raw,env,hop);
  if(!local)return null;
  return {...local,confidence:Math.min(0.49,local.confidence),provenance:'browser-autocorrelation'};
}
