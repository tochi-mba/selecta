// Saving the horizon ahead (ADR-0446 "Downloading with signed URLs"). Each file is fetched with
// a short-lived URL asked for just before the download. A 403 (the URL expired) gets one fresh
// URL and the download carries on from the bytes already saved with an HTTP Range request, so a
// long download survives URL expiry. At most two downloads run at once, and nothing is fetched
// while the player is offline: playback only ever reads saved files.

import type { Segment, ZoneCache } from '../business/offline/zoneCache';

export const PARALLEL = 2;

export type Downloader = {
  urlFor: (key: string) => Promise<string>;
  fetch?: typeof fetch;
};

/** The whole file as a Blob, refreshing the URL once on a 403 and resuming with Range. */
export async function downloadSegment(segment: Segment, options: Downloader): Promise<Blob> {
  const go = options.fetch ?? fetch;
  const parts: BlobPart[] = [];
  let received = 0;
  let refreshed = false;
  let url = await options.urlFor(segment.key);
  for (;;) {
    const headers: Record<string, string> = received > 0 ? { Range: `bytes=${received}-` } : {};
    const answer = await go(url, { headers });
    if (answer.status === 403 && !refreshed) {
      refreshed = true;
      url = await options.urlFor(segment.key);
      continue;
    }
    if (!answer.ok && answer.status !== 206) throw new Error(`download failed (${answer.status})`);
    if (received > 0 && answer.status !== 206) {
      // the server ignored the Range: start again from this full answer
      parts.length = 0;
      received = 0;
    }
    const reader = answer.body?.getReader();
    if (!reader) {
      parts.push(await answer.blob());
      return new Blob(parts);
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return new Blob(parts);
        parts.push(value);
        received += value.byteLength;
      }
    } catch (error) {
      if (refreshed) throw error;
      // a dropped stream or an expired URL mid-way: one fresh URL, then carry on
      refreshed = true;
      url = await options.urlFor(segment.key);
    }
  }
}

/** Save what the manifest still needs, nearest first, two at a time. Returns how many saved. */
export async function fillCache(cache: ZoneCache, options: Downloader & { online: () => boolean }): Promise<number> {
  const queue = cache.missing();
  let saved = 0;
  const retried = new Set<string>();
  const worker = async () => {
    for (;;) {
      if (!options.online()) return;
      const segment = queue.shift();
      if (!segment) return;
      try {
        const blob = await downloadSegment(segment, options);
        const result = await cache.put(segment, blob);
        if (result.ok) saved += 1;
        else if (result.reason === 'checksum' && !retried.has(segment.id)) {
          retried.add(segment.id); // a bad copy is discarded and fetched again, once per fill
          queue.push(segment);
        }
      } catch {
        // try again on the next fill
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return saved;
}
