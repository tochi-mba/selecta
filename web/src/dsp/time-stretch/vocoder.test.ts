import { describe,it,expect } from 'vitest';
import { stretchPCM,stretchWarp } from './vocoder';
import { sine } from '../fixtures/synthetic';
import { DSPCancelled, MOBILE_BUDGET } from '../core/types';
function frequency(ch:Float32Array,rate:number):number {
  let count=0;for(let i=1;i<ch.length;i++)if(ch[i-1]<=0&&ch[i]>0)count++;
  return count*rate/(ch.length/rate*rate);
}
describe('Portable phase-vocoder',()=>{
  it('preserves pitch within 2% while shortening time 8%',()=>{
    const source=sine(440,0.8,22050,0.2,1);
    const out=stretchPCM(source,1.08);
    expect(out.channels[0].length).toBe(Math.round(source.channels[0].length/1.08));
    expect(Math.abs(frequency(out.channels[0],22050)-440)/440).toBeLessThan(0.02);
  });
  it('maps piecewise beats to sample-count-controlled output duration',()=>{
    const input=sine(220,1.5,22050,0.3,1);
    const output=stretchWarp(input,{output:[0,0.5,1],source:[0,0.52,1.08]},0,22050);
    expect(output.channels[0].length).toBe(22050);
    expect(output.channels[0].some(v=>Math.abs(v)>0.05)).toBe(true);
  });
  it('cancels and enforces unsupported ratios',()=>{
    const input=sine(440,0.2,22050,0.1,1);
    expect(()=>stretchPCM(input,1.8)).toThrow();
    const controller=new AbortController();controller.abort();
    expect(()=>stretchPCM(input,1.05,undefined,MOBILE_BUDGET,controller.signal)).toThrow(DSPCancelled);
  });
});
