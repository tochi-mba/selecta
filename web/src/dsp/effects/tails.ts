import { allocatePCM, assertPCM, checkCancelled, DSPUnsupported, type PCM, type ProcessingBudget, MOBILE_BUDGET } from '../core/types';
import { zeroPhaseLowpass,zeroPhaseHighpass } from './filters';
export type Echo = {delaySeconds:number; feedback:number; wet:number; returnHighpassHz:number; dampLowpassHz:number};
export type Wash = {wet:number; decaySeconds:number; damping:number; returnHighpassHz:number};
export function echoTail(send:PCM,params:Echo,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  const n=assertPCM(send,budget),sr=send.sampleRate;
  const {delaySeconds,feedback,wet,returnHighpassHz,dampLowpassHz}=params;
  if(delaySeconds<=0||delaySeconds>4||feedback<0||feedback>=1||wet<0||wet>1)throw new DSPUnsupported('Invalid echo parameters');
  const interval=Math.max(1,Math.round(delaySeconds*sr));
  const out=allocatePCM(sr,send.channels.length,n,send.originSeconds,budget);
  let current=send,gain=wet,offset=interval;
  while(gain>0.01&&offset<n){
    checkCancelled(signal);
    current=zeroPhaseLowpass(current,dampLowpassHz,budget,signal);
    for(let c=0;c<out.channels.length;c++)for(let i=0;i<Math.min(n-offset,current.channels[c].length);i++)
      out.channels[c][offset+i]+=current.channels[c][i]*gain;
    gain*=feedback;offset+=interval;
  }
  return zeroPhaseHighpass(out,returnHighpassHz,budget,signal);
}
/** Resource-bounded Schroeder-like diffuse return; not the native seeded convolution IR. */
export function reverbTail(send:PCM,p:Wash,budget:ProcessingBudget=MOBILE_BUDGET,signal?:AbortSignal):PCM {
  const n=assertPCM(send,budget);
  if(p.decaySeconds<0.1||p.decaySeconds>8||p.damping<0||p.damping>1||p.wet<0||p.wet>1)
    throw new DSPUnsupported('Invalid reverb parameters');
  const out=allocatePCM(send.sampleRate,send.channels.length,n,send.originSeconds,budget);
  const delays=[0.0297,0.0371,0.0411,0.0437].map(t=>Math.round(t*send.sampleRate));
  for(let c=0;c<send.channels.length;c++){
    const buffers=delays.map(t=>new Float32Array(t));
    const positions=new Uint32Array(delays.length);
    const state=new Float64Array(delays.length);
    for(let i=0;i<n;i++){
      if((i&8191)===0)checkCancelled(signal);
      let wet=0;
      for(let k=0;k<delays.length;k++){
        const index=positions[k],delayed=buffers[k][index],g=Math.exp(-6.91*delays[k]/(send.sampleRate*p.decaySeconds));
        state[k]=state[k]*p.damping+delayed*(1-p.damping);
        buffers[k][index]=send.channels[c][i]*0.25+state[k]*g;
        positions[k]=(index+1)%delays[k];wet+=(k%2===c%2?1:-0.8)*delayed;
      }
      out.channels[c][i]=wet*p.wet;
    }
  }
  return zeroPhaseHighpass(out,p.returnHighpassHz,budget,signal);
}
