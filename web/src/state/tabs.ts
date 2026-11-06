/** Two tabs playing at once would sound terrible, so the tab that starts playing takes the sound and
 * the others pause and say why. Nothing's lost: pressing play there takes it back. */

const tab = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let channel: BroadcastChannel | null = null;

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel('selecta-audio');
  return channel;
}

export function sayThisTabIsPlaying() {
  open()?.postMessage({ playing: tab });
}

export function whenAnotherTabPlays(handle: () => void): () => void {
  const line = open();
  if (!line) return () => {};
  const listen = (event: MessageEvent) => {
    if (event.data?.playing && event.data.playing !== tab) handle();
  };
  line.addEventListener('message', listen);
  return () => line.removeEventListener('message', listen);
}
