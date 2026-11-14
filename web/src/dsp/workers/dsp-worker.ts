/// <reference lib="webworker" />
import { extractSpectral } from '../analysis/spectral';
import { detectBeats } from '../analysis/beats';
import { chromaKey } from '../analysis/key';
import { renderTransitionWindow } from '../transitions/render';
import { DSPCancelled,DSPUnsupported } from '../core/types';
import type { DSPRequest, DSPResult, DSPFailure } from './protocol';
const scope=self as DedicatedWorkerGlobalScope;
scope.onmessage=(event:MessageEvent<DSPRequest>)=>{
  const request=event.data;
  try {
    let result:DSPResult;
    if(request.kind==='analyse') {
      const features=extractSpectral(request.pcm,request.bars,request.budget);
      const origin=request.pcm.originSeconds;
      result={kind:'analysis',id:request.id,features,grid:detectBeats(features.onsetEnvelope,features.hopSeconds,origin),
        key:chromaKey(features.chromaProfile)};
    } else if(request.kind==='render') {
      result={kind:'render',id:request.id,artifact:renderTransitionWindow(request.script,request.sources,
        {sampleRate:request.sampleRate,windowStart:request.windowStart,duration:request.duration,budget:request.budget})};
    } else throw new DSPUnsupported('Unknown job operation');
    if(result.kind==='render') {
      const transfer=result.artifact.pcm.channels.map(ch=>ch.buffer);
      scope.postMessage(result,transfer);
    } else scope.postMessage(result);
  } catch(error) {
    const e=error instanceof Error?error:new Error(String(error));
    const code=error instanceof DSPUnsupported?'unsupported_here':error instanceof DSPCancelled?'cancelled':'failure';
    const response:DSPFailure={kind:'error',id:request.id,code,message:e.message};
    scope.postMessage(response);
  }
};
