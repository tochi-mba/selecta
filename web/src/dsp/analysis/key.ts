import { clamp } from '../core/types';
/** Python analysis/key.py Krumhansl-Schmuckler chroma templates. Learned S-KEY is Agent 04. */
const MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const NOTES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const CAMELOT_MAJOR=[8,3,10,5,12,7,2,9,4,11,6,1];
const CAMELOT_MINOR=[5,12,7,2,9,4,11,6,1,8,3,10];
export type KeyResult = { name:string; camelot:string; confidence:number; method:'chroma-template'; learnedKey?:string; agreesWithLearned?:boolean };
export interface LearnedKeyAdapter { infer(chroma: readonly number[]): Promise<{name:string;confidence:number}> }
export function camelot(name:string):string {
  const [note,mode]=name.split(' '),idx=NOTES.indexOf(note);
  if(idx<0||!['major','minor'].includes(mode))throw new RangeError('Invalid key label');
  return mode==='major'?`${CAMELOT_MAJOR[idx]}B`:`${CAMELOT_MINOR[idx]}A`;
}
export function camelotDistance(a:string,b:string):number {
  const x=parseInt(a,10),y=parseInt(b,10),dist=Math.abs(x-y);
  return Math.min(dist,12-dist)+(a.slice(-1)===b.slice(-1)?0:1);
}
export function chromaKey(chroma:readonly number[]):KeyResult {
  if(chroma.length!==12||chroma.some(v=>!Number.isFinite(v)||v<0))throw new RangeError('Expected 12 nonnegative chroma values');
  const mean=chroma.reduce((a,b)=>a+b,0)/12;
  if(mean<1e-8)return {name:'unknown',camelot:'',confidence:0,method:'chroma-template'};
  const scores:{name:string;score:number}[]=[];
  for(let tonic=0;tonic<12;tonic++)for(const [template,mode] of [[MAJOR,'major'],[MINOR,'minor']] as const) {
    const tm=template.reduce((a,b)=>a+b,0)/12;let score=0,norm=0,d=0;
    for(let i=0;i<12;i++){const a=chroma[i]-mean,b=template[(i-tonic+12)%12]-tm;score+=a*b;norm+=a*a;d+=b*b;}
    scores.push({name:`${NOTES[tonic]} ${mode}`,score:score/Math.sqrt(Math.max(1e-20,norm*d))});
  }
  scores.sort((a,b)=>b.score-a.score);
  const best=scores[0];
  // Chroma-only inference is weak: never advertise neural-level confidence.
  return {name:best.name,camelot:camelot(best.name),confidence:clamp((best.score-scores[1].score)*2,0,0.7),method:'chroma-template'};
}
export async function inferKey(chroma:readonly number[], adapter?:LearnedKeyAdapter):Promise<KeyResult> {
  const candidate=chromaKey(chroma);
  if(!adapter||candidate.name==='unknown')return candidate;
  const learned=await adapter.infer(chroma);
  return {...candidate,learnedKey:learned.name,agreesWithLearned: learned.name===candidate.name ||
    (candidate.camelot!==''&&camelotDistance(candidate.camelot,camelot(learned.name))<=1)};
}
