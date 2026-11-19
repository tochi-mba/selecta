import { describe, expect, it } from 'vitest';
import { BANNED_CLAIMS } from '../../copy';
import { BANNED_CLAIMS as DSP_CLAIMS } from '../../dsp/honesty';
import { allStemsCopy, DOWNLOAD_FAILED, percentWords, READINESS, sizeWords, STEM_DEGRADED, stemDegradedReason, stemRefusal, steppedProgress } from './stemsCopy';

type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const DIR = `${node.cwd()}/src/cloud/stems/`;

describe('stems copy (ADR-0459 honesty rules)', () => {
  const copy = allStemsCopy();

  it('has every surface’s words', () => {
    expect(copy.length).toBeGreaterThan(40);
  });

  it('says no banned claim, from either list', () => {
    const claims = [...BANNED_CLAIMS, ...DSP_CLAIMS].map((claim) => claim.toLowerCase());
    for (const words of copy) {
      const lowered = words.toLowerCase().replace(/[’‘]/g, "'");
      for (const claim of claims) expect(lowered, words).not.toContain(claim);
    }
  });

  it('claims no quality and never says a stem move played', () => {
    for (const words of copy) {
      expect(words.toLowerCase(), words).not.toMatch(/\b(quality|studio|perfect|flawless|lossless|guarantee)/);
      expect(words.toLowerCase(), words).not.toMatch(/\b(vocal ride|strip and land|intertwined stems) (played|was played)/);
    }
  });

  it('has no em dash in any stems file', () => {
    const files = fs.readdirSync(DIR).filter((file) => /\.(ts|tsx)$/.test(file));
    expect(files.length).toBeGreaterThan(5);
    const dash = String.fromCharCode(0x2014);
    for (const file of files) expect(fs.readFileSync(DIR + file, 'utf8'), file).not.toContain(dash);
    const moves = fs.readFileSync(`${node.cwd()}/src/cloud/browserMoves.ts`, 'utf8');
    expect(moves).not.toContain(dash);
  });

  it('keeps each stems file within 1000 lines', () => {
    for (const file of fs.readdirSync(DIR)) expect(fs.readFileSync(DIR + file, 'utf8').split('\n').length, file).toBeLessThanOrEqual(1000);
  });

  it('formats sizes and progress for a reader', () => {
    expect(sizeWords(4_500_000)).toBe('4.5 MB');
    expect(sizeWords(170_000_000)).toBe('170 MB');
    expect(sizeWords(1_250_000_000)).toBe('1.3 GB');
    expect(sizeWords(Number.NaN)).toBe('an unknown amount');
    expect(percentWords(0.404)).toBe('40%');
    expect(percentWords(7)).toBe('100%');
    expect(steppedProgress(0.47)).toBe(0.4);
    expect(steppedProgress(-1)).toBe(0);
    expect(READINESS.running(0.47)).toBe('Getting stems ready for this transition (40%)');
  });

  it('writes the degraded reasons as whole sentences for "Scheduled here: Blend."', () => {
    expect(stemDegradedReason('not_ready')).toBe('The stems weren’t ready in time.');
    expect(stemDegradedReason('not_connected')).toMatch(/^The song isn’t connected/);
    expect(stemDegradedReason('split_failed', 'The worker ran out of memory.')).toBe('Splitting failed: the worker ran out of memory.');
    expect(stemDegradedReason('split_failed')).toBe('Splitting failed.');
    for (const words of Object.values(STEM_DEGRADED)) expect(words()).toMatch(/\.$/);
  });

  it('says what a refused stem move needs', () => {
    expect(stemRefusal('vocal_ride', 'tempo')).toBe('Vocal ride needs two songs closer in tempo.');
    expect(stemRefusal('vocal_ride', 'voice')).toBe('Vocal ride needs a voice in the first song to ride over.');
    expect(stemRefusal('stem_arrange', 'More bars before the drop.')).toBe('Strip and land needs more bars before the drop.');
  });

  it('points storage full at clearing cached audio', () => {
    expect(DOWNLOAD_FAILED.storage_full()).toContain('Clearing cached audio in This device');
    expect(DOWNLOAD_FAILED.other('server said no.')).toBe('The download didn’t finish: server said no.');
  });
});
