import { DSPCancelled, DSPUnsupported } from '../core/types';
import type { DSPRequest, DSPResult, DSPFailure } from './protocol';
/**
 * One short-lived worker per bounded job. Abort terminates even a synchronous WASM/FFT
 * operation; unlike a worker-side 'cancel' message, it does not wait for the event loop.
 */
export function runDSPJob(request:DSPRequest,signal?:AbortSignal):Promise<DSPResult> {
  if(signal?.aborted)return Promise.reject(new DSPCancelled());
  if(typeof Worker==='undefined')return Promise.reject(new DSPUnsupported('Dedicated Workers unavailable here'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./dsp-worker.ts',import.meta.url),{type:'module'});
    let settled=false;
    const finish=()=>{if(settled)return false;settled=true;signal?.removeEventListener('abort',abort);
      worker.terminate();return true;};
    const abort=()=>{if(finish())reject(new DSPCancelled());};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=(event:MessageEvent<DSPResult|DSPFailure>)=>{
      if(event.data.id!==request.id)return;
      if(!finish())return;
      if(event.data.kind==='error'){
        const e=event.data.code==='unsupported_here'?new DSPUnsupported(event.data.message):new Error(event.data.message);
        reject(e);
      }else resolve(event.data);
    };
    worker.onerror=(event)=>{if(finish())reject(new Error(event.message||'DSP worker failed'));};
    // Structured clone is local to the browser. Caller retains buffers for playback.
    try{worker.postMessage(request);}catch(e){if(finish())reject(e);}
    if(signal?.aborted)abort();
  });
}
