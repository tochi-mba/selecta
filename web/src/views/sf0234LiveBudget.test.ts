import { describe, expect, it } from 'vitest';

/**
 * SF-0234-05 (automated part): the live announcement budget. Things that change many times a
 * second while music plays (the lyric line, the bar countdown and the visualizer) must never sit
 * in a region a screen reader speaks on change. A person still has to listen with a screen reader;
 * this only holds the markup that makes chatter impossible.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const now = fs.readFileSync(`${node.cwd()}/src/views/Now.tsx`, 'utf8');

function openingTag(marker: string): string {
  const at = now.indexOf(marker);
  expect(at, `${marker} is in Now.tsx`).toBeGreaterThan(-1);
  const start = now.lastIndexOf('<', at);
  const end = now.indexOf('>', at);
  return now.slice(start, end + 1);
}

describe('SF-0234-05 live announcement budget', () => {
  it('keeps the following lyric line out of live speech', () => {
    expect(openingTag('className={`lyrics ${focus')).toContain('aria-live="off"');
  });

  it('keeps the bar countdown a silent timer', () => {
    const at = now.indexOf('className="handoff countdown"');
    const tag = now.slice(now.lastIndexOf('<section', at), now.indexOf('>', now.indexOf('aria-label', at)) + 1);
    expect(tag).toContain('role="timer"');
    expect(tag).toContain('aria-live="off"');
  });

  it('gives the visualizer a fixed name, never its moving levels', () => {
    const tag = openingTag('className={`music-visualizer');
    expect(tag).toContain('role="img"');
    const label = tag.slice(tag.indexOf('aria-label='));
    expect(label).not.toMatch(/levels\[|spectrum\[|\$\{[^}]*(level|time|frame)/);
  });

  it('never puts the playing clock inside a polite or assertive region', () => {
    const lines = now.split('\n').filter((line) => /aria-live="(polite|assertive)"|role="(status|alert)"/.test(line));
    expect(lines.filter((line) => /clock\(|currentTime|\btime\b/.test(line))).toEqual([]);
  });
});
