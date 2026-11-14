import type { PCM, ProcessingBudget, PreparedAudio } from '../core/types';
import type { MusicalFeatures } from '../analysis/spectral';
import type { BeatGrid } from '../analysis/beats';
import type { KeyResult } from '../analysis/key';
import type { TransitionScript } from '../transitions/script';
export type AnalyzeRequest={kind:'analyse';id:string;pcm:PCM;bars?:number[];budget?:ProcessingBudget};
export type RenderRequest={kind:'render';id:string;script:TransitionScript;sources:Record<string,PCM>;
  sampleRate?:number;windowStart?:number;duration?:number;budget?:ProcessingBudget};
export type DSPRequest=AnalyzeRequest|RenderRequest;
export type DSPResult={kind:'analysis';id:string;features:MusicalFeatures;grid:BeatGrid|null;key:KeyResult} |
  {kind:'render';id:string;artifact:PreparedAudio};
export type DSPFailure={kind:'error';id:string;code:'unsupported_here'|'cancelled'|'failure';message:string};
/** Consumer contract: no source bytes in Cloud, only transferable local worker messages. */
