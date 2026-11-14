import {describe,it,expect} from 'vitest';
import {makeTransition,canBeatmatch,canIntertwine,type TrackTiming} from './recipes';
const a:TrackTiming={sourceId:'a',bpm:120,beatsPerBar:4,gridConfidence:0.91,camelot:'8A'};
const b:TrackTiming={sourceId:'b',bpm:122,beatsPerBar:4,gridConfidence:0.87,camelot:'9A'};
describe('Native-inspired deterministic transition recipes',()=>{
  it('checks true beat, bar and key compatibility before a blend',()=>{
    expect(canBeatmatch(a,b)).toBe(true);
    expect(canIntertwine(a,b)).toBe(true);
    expect(canBeatmatch(a,{...b,bpm:150})).toBe(false);
  });
  it('pins bass handoff to musical bar and emits the correct filter sweep',()=>{
    const transition=makeTransition('filter_sweep',a,b,{time:24,bar:12},{time:8,bar:4},{bars:8});
    expect(transition.style).toBe('filter_sweep');
    expect(transition.a.highpass).toHaveLength(49);
    expect(transition.b.lowpass).toHaveLength(49);
    expect((transition.meta!.swap as number)%2).toBeCloseTo(0,5);
  });
  it('does not fabricate phrase timing for a lyric delay throw',()=>{
    expect(()=>makeTransition('delay_throw',a,b,{time:24,bar:12},{time:8,bar:4})).toThrow('word-end');
  });
});
