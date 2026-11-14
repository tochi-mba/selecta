import { DSPUnsupported, clamp } from '../core/types';
import { equalPowerFade,logarithmicSweep,stepCurve,type TransitionScript,type TransitionPart } from './script';
import { camelotDistance } from '../analysis/key';
/** Only metadata and user-selected cues cross the Cloud boundary; original media stays local. */
export type MusicalCue={time:number;bar:number;kind?:string};
export type TrackTiming={
  sourceId:string;bpm:number;beatsPerBar:number;gridConfidence:number;
  gainDb?:number;camelot?:string;lowShareBars?:number[];energyBars?:number[];
  exitCues?:MusicalCue[];entryCues?:MusicalCue[];
};
export type TransitionStyle='bass_swap_blend'|'filter_sweep'|'tempo_ramp'|'cut_on_one'|'echo_out'|'delay_throw'|'reverb_wash';
export type RecipeOptions={bars?:number;swapAt?:number;vocalPhraseEnd?:number};
const PERIOD=(bpm:number)=>60/bpm;
function assertTrack(t:TrackTiming) {
  if(!t.sourceId||!Number.isFinite(t.bpm)||t.bpm<40||t.bpm>240||
    t.beatsPerBar<2||t.beatsPerBar>7||t.gridConfidence<0||t.gridConfidence>1)
    throw new DSPUnsupported('Malformed musical timing metadata');
}
function level(t:TrackTiming,bar:number,key:'lowShareBars'|'energyBars'):number {
  const bins=t[key]??[];return bins.length?bins[Math.max(0,Math.min(bins.length-1,bar))]??0:0;
}
function lowSwap(a:TrackTiming,b:TrackTiming,exit:MusicalCue,entry:MusicalCue):number {
  return clamp(0.5+0.12*(level(b,entry.bar,'lowShareBars')-level(a,exit.bar,'lowShareBars'))+
    0.06*(level(b,entry.bar,'energyBars')-level(a,exit.bar,'energyBars')),0.38,0.62);
}
export function canBeatmatch(a:TrackTiming,b:TrackTiming,maxTempoGap=0.08):boolean {
  assertTrack(a);assertTrack(b);
  return a.beatsPerBar===b.beatsPerBar&&Math.abs(a.bpm/b.bpm-1)<=maxTempoGap&&
    Math.min(a.gridConfidence,b.gridConfidence)>=0.55;
}
export function canIntertwine(a:TrackTiming,b:TrackTiming):boolean {
  return canBeatmatch(a,b,0.03)&&Boolean(a.camelot&&b.camelot&&camelotDistance(a.camelot!,b.camelot!)<=1);
}
export function choosePhraseCues(t:TrackTiming,role:'entry'|'exit',minBar=0):MusicalCue|null {
  const candidates=(role==='exit'?t.exitCues:t.entryCues)??[];
  // Cue order is musical metadata provenance from analysis, not guessed from peaks.
  return candidates.filter(c=>c.bar>=minBar&&Number.isFinite(c.time)).sort((a,b)=>a.bar-b.bar)[0]??null;
}
export function makeTransition(style:TransitionStyle,a:TrackTiming,b:TrackTiming,
  exit:MusicalCue,entry:MusicalCue,options:RecipeOptions={}):TransitionScript {
  assertTrack(a);assertTrack(b);
  const bars=options.bars??(style==='bass_swap_blend'?16:style==='filter_sweep'?8:4);
  if(!Number.isInteger(bars)||bars<1||bars>32)throw new DSPUnsupported('Unsupported musical overlap length');
  const beat=PERIOD(a.bpm),bar=beat*a.beatsPerBar;
  const stable=canBeatmatch(a,b,style==='tempo_ramp'?0.16:0.08);
  if(['bass_swap_blend','filter_sweep','tempo_ramp'].includes(style)&&!stable)
    throw new DSPUnsupported('These tracks lack a compatible measured beat/meter grid');
  // A cue is the centre of the overlap; B enters on its own chosen bar.
  const overlapSeconds=bars*bar,lead=Math.max(0,exit.time-overlapSeconds/2);
  if(lead>exit.time||!Number.isFinite(entry.time)||entry.time<0)
    throw new DSPUnsupported('Transition requires real, nonnegative local cue times');
  const overlapStart=style==='cut_on_one'||style==='echo_out'||style==='delay_throw'||style==='reverb_wash'
    ?Math.max(0,exit.time-Math.max(3,2*bar)):lead;
  const overlapEnd=stable?overlapStart+overlapSeconds:overlapStart;
  const duration=(stable?overlapEnd:overlapStart)+4;
  const aPart:TransitionPart={sourceId:a.sourceId,
    warp:{output:[0,duration],source:[Math.max(0,exit.time-(stable?overlapSeconds/2:overlapStart)),Math.max(0,exit.time-(stable?overlapSeconds/2:overlapStart))+duration]},
    sourceGainDb:a.gainDb??0};
  const bStart=stable?overlapStart:overlapStart;
  const bPart:TransitionPart={sourceId:b.sourceId,warp:{output:[bStart,duration],
    source:[entry.time,entry.time+(duration-bStart)*(b.bpm/a.bpm)]},sourceGainDb:b.gainDb??0};
  const out:TransitionScript={style,duration,a:aPart,b:bPart,overlap:[overlapStart,stable?overlapEnd:overlapStart],
    expectsBeatsAligned:stable,meta:{bars,exitBar:exit.bar,entryBar:entry.bar}};
  if(style==='cut_on_one'){
    out.a.gain=stepCurve(overlapStart,1,0,0.008);
    out.b.gain=equalPowerFade(overlapStart,overlapStart+0.02,'in');
  }else if(style==='echo_out'||style==='delay_throw'){
    const sendFrom=style==='delay_throw'?(options.vocalPhraseEnd??NaN)-Math.min(beat,0.6):overlapStart-beat;
    if(!Number.isFinite(sendFrom))throw new DSPUnsupported('Delay throw needs verified word-end timing');
    out.a.gain=stepCurve(overlapStart,1,0,0.025);
    out.a.echo={delaySeconds:beat,feedback:0.33,wet:0.25,returnHighpassHz:300,dampLowpassHz:6000};
    out.a.echoSend=[[sendFrom-0.02,0],[sendFrom,1],[overlapStart,1],[overlapStart+0.02,0]];
    out.b.gain=equalPowerFade(overlapStart,overlapStart+0.02,'in');
  }else if(style==='reverb_wash'){
    out.a.gain=[[overlapStart-0.01,1],[overlapStart+beat,0]];
    out.a.wash={wet:0.25,decaySeconds:1.6,damping:0.45,returnHighpassHz:350};
    out.a.washSend=[[overlapStart-2*beat,0],[overlapStart,1],[overlapStart+beat,1],[overlapStart+beat+0.05,0]];
    out.b.gain=equalPowerFade(overlapStart,overlapStart+beat/2,'in');
  }else {
    const fade=overlapSeconds*(style==='filter_sweep'?0.35:0.65);
    out.a.gain=equalPowerFade(overlapEnd-fade,overlapEnd,'out');
    out.b.gain=equalPowerFade(overlapStart,overlapStart+fade,'in');
    const chosen=clamp(options.swapAt??lowSwap(a,b,exit,entry),0.1,0.9);
    const swap=overlapStart+Math.max(1,Math.round(bars*chosen))*bar;
    out.a.low=[[swap-beat/2,1],[swap+beat/2,0]];
    out.b.low=[[swap-beat/2,0],[swap+beat/2,1]];
    out.meta={...out.meta,swap,swapAt:chosen};
    if(style==='filter_sweep'){
      out.a.highpass=logarithmicSweep(overlapStart,overlapEnd,30,2000);
      out.b.lowpass=logarithmicSweep(overlapStart,overlapEnd,300,Math.min(20000,44100*.45));
    }
    if(style==='tempo_ramp')out.meta={...out.meta,needsBeatPinnedWarp:true};
  }
  return out;
}
