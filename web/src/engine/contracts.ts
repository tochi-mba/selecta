/** Browser-local audio is never addressed by a Cloud URL. Recording files are user-authorised. */
export interface LocalRecording {
  id: string;
  title: string;
  file: File;
}
export type EnginePhase = 'idle' | 'ready' | 'starting' | 'playing' | 'paused' | 'interrupted' | 'error';
export type SoundCheck = 'unverified' | 'user_confirmed';
export interface EngineSnapshot {
  phase: EnginePhase;
  tracks: number;
  index: number;
  title: string | null;
  position: number;
  duration: number;
  volume: number;
  fadeSeconds: number;
  lowDb: number;
  highDb: number;
  context: AudioContextState | 'unavailable';
  output: string;
  soundCheck: SoundCheck;
  confirmationTime: number | null;
  ownership: 'none' | 'exclusive' | 'cooperative' | 'unsupported';
  pending: string | null;
  error: string | null;
  generation: number;
}
/** Injectable boundary for Agent 03: provide prepared, locally authorised decoded PCM. */
export interface BrowserAudioSourcePort {
  decode(file: File, context: AudioContext): Promise<AudioBuffer>;
}
/** Agent 06 may observe applied commands but may not infer physical audibility. */
export interface BrowserAudioSessionPort {
  onState?(state: EngineSnapshot): void;
}
/** Agent 05 can take recorded buffers off-thread; no renderer is imported by the live graph. */
export interface BrowserRenderPort {
  render?(recordings: readonly LocalRecording[], signal: AbortSignal): Promise<Blob>;
}
export interface AudioEngine {
  snapshot(): EngineSnapshot;
  subscribe(listener: () => void): () => void;
  setQueue(files: readonly LocalRecording[]): Promise<void>;
  activate(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setVolume(value: number): void;
  setFade(seconds: number): void;
  setEq(lowDb: number, highDb: number): void;
  confirmSound(heard: boolean): void;
  dispose(): Promise<void>;
}
