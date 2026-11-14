import { describe,it,expect } from 'vitest';
import { runDSPJob } from './client';
import { DSPCancelled } from '../core/types';
describe('DSP worker boundary',()=>{
  it('rejects an already cancelled job before worker creation',async()=>{
    const signal=new AbortController();signal.abort();
    await expect(runDSPJob({kind:'analyse',id:'cancelled',pcm:{sampleRate:44100,originSeconds:0,channels:[new Float32Array(4)]}},signal.signal))
      .rejects.toBeInstanceOf(DSPCancelled);
  });
});
