import { clamp, DSPUnsupported } from '../core/types';
import { validateWarp, warpAt, type Warp } from '../time-stretch/vocoder';
import type { Echo,Wash } from '../effects/tails';
export type Curve = [number,number][];
export type TransitionPart={
  sourceId:string; warp:Warp; gain?:Curve; low?:Curve; mid?:Curve; high?:Curve;
  sourceGainDb?:number; lowpass?:Curve; highpass?:Curve; echo?:Echo; echoSend?:Curve;
  wash?:Wash; washSend?:Curve; renderFrom?:number; renderUntil?:number; followsB?:boolean;
};
export type TransitionScript={
  style:string;duration:number;a:TransitionPart;b:TransitionPart;extras?:TransitionPart[];
  overlap:[number,number];expectsBeatsAligned?:boolean;quietAllowed?:number;
  meta?:Record<string,number|string|boolean|null>;
};
export function validateCurve(curve:Curve):void {
  if(!curve.length||curve.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)))
    throw new DSPUnsupported('Malformed curve');
}
export function sampleCurve(curve:Curve|undefined,t:number,defaultValue=1):number {
  if(!curve)return defaultValue;
  validateCurve(curve);
  if(t<=curve[0][0])return curve[0][1];
  if(t>=curve[curve.length-1][0])return curve[curve.length-1][1];
  for(let i=1;i<curve.length;i++)if(t<=curve[i][0]) {
    const [x,y]=curve[i-1],[nx,ny]=curve[i];
    return y+(ny-y)*clamp((t-x)/Math.max(1e-12,nx-x),0,1);
  }
  return curve[curve.length-1][1];
}
export function curveIs(curve:Curve|undefined,value:number):boolean {
  return !curve||curve.every(p=>Math.abs(p[1]-value)<1e-9);
}
export function equalPowerFade(from:number,to:number,direction:'in'|'out',steps=48):Curve {
  if(to<=from)throw new DSPUnsupported('Fade interval must increase');
  return Array.from({length:steps+1},(_,i)=> {
    const u=i/steps;return [from+(to-from)*u,direction==='in'?Math.sin(u*Math.PI/2):Math.cos(u*Math.PI/2)];
  });
}
export function stepCurve(t:number,before:number,after:number,ramp=0.01):Curve {
  return [[t-ramp/2,before],[t+ramp/2,after]];
}
export function logarithmicSweep(from:number,to:number,hz0:number,hz1:number,steps=48):Curve {
  if(hz0<=0||hz1<=0||to<=from)throw new DSPUnsupported('Invalid sweep');
  return Array.from({length:steps+1},(_,i)=>[from+(to-from)*i/steps,hz0*(hz1/hz0)**(i/steps)]);
}
export function validateScript(script:TransitionScript):void {
  if(!script.style||!Number.isFinite(script.duration)||script.duration<=0||
    !Array.isArray(script.overlap)||script.overlap.length!==2||
    script.overlap[0]<0||script.overlap[1]<script.overlap[0]||script.overlap[1]>script.duration)
    throw new DSPUnsupported('Malformed transition script');
  for(const p of [script.a,script.b,...(script.extras??[])]) {
    if(!p.sourceId)throw new DSPUnsupported('Each transition part needs a local media source binding');
    validateWarp(p.warp);
    for(const curve of [p.gain,p.low,p.mid,p.high,p.highpass,p.lowpass,p.echoSend,p.washSend])
      if(curve)validateCurve(curve);
  }
}
export { warpAt };
