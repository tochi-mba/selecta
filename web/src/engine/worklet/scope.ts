/** The AudioWorklet global scope, typed for the engine's processors (ADR-0457).
 *
 * Processors read the scope through `globalThis` instead of ambient globals. Ambient
 * declarations of `sampleRate`, `currentTime` and `currentFrame` would leak into the whole web
 * compile, where a stray `currentTime` in a component would typecheck and then crash at runtime.
 *
 * Processor code is shipped as source text (see `processorSource`) and loaded through a blob
 * module URL. A `new URL('./x.ts', import.meta.url)` worklet URL is copied by the production
 * build as a raw asset, so the browser would be handed TypeScript it cannot parse.
 */

export type WorkletScope = {
  AudioWorkletProcessor: new (options?: unknown) => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
  sampleRate: number;
  currentFrame: number;
};

/** Source text for a worklet module: the define function, called with its JSON arguments.
 * The function must be self-contained: it may only reach the worklet scope via globalThis. */
export function processorSource(define: (...args: never[]) => void, ...args: unknown[]): string {
  return `(${define.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')});\n`;
}

/** How long a module load may take before the device is called unable. Some browsers never
 * settle addModule at all. */
export const MODULE_WAIT_MS = 5000;

/** Load one processor module from its source text, with a timeout, revoking the blob URL. */
export async function loadWorkletModule(
  worklet: Pick<AudioWorklet, 'addModule'>,
  source: string,
  waitMs = MODULE_WAIT_MS,
): Promise<void> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let wait: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worklet.addModule(url),
      new Promise<never>((_, reject) => {
        wait = setTimeout(() => reject(new Error('the module did not load in time')), waitMs);
      }),
    ]);
  } finally {
    clearTimeout(wait);
    URL.revokeObjectURL(url);
  }
}
