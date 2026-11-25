/** Give the page a turn in the middle of long work, without slowing down in a background tab.
 *
 * A zero-length timer is the usual way to yield, but browsers hold timers back in a tab that is
 * not in front: to once a second at first, and to once a minute after a few minutes. Work that
 * yields thousands of times (hashing a large file, mixing a decoded song down) then crawls as soon
 * as the person looks at another tab. A message on a channel is delivered as an ordinary task and
 * is not held back, so the page still gets its turn and the work keeps its pace. */
export function breathe(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => { setTimeout(resolve, 0); });
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
