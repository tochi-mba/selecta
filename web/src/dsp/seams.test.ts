import { describe, expect, it } from 'vitest';
import {
  scheduleSeam,
  LEAVE_AFTER_SECONDS,
  MAX_WINDOW_SECONDS,
  type TrackTiming,
} from './seams';
import { FALLBACK_FADE_SECONDS } from './crossfade';

function track(bpm: number, confidence = 0.9, ambiguous = false): TrackTiming {
  const period = 60 / bpm;
  const beats = Array.from({ length: Math.floor(120 / period) }, (_, beat) => beat * period);
  return { beats, tempo: { bpm, confidence, ambiguous }, durationSeconds: 120 };
}

describe('scripted seam windows', () => {
  it('refuses a beatmatched seam on low confidence and falls back to a fade', () => {
    const schedule = scheduleSeam(track(120, 0.2), track(122), { exitSeconds: 40 });
    expect(schedule.kind).toBe('fade');
    expect(schedule.reason).toContain('confidence is low');
    expect(schedule.windowSeconds).toBe(FALLBACK_FADE_SECONDS);
  });

  it('treats half/double-time ambiguity as low confidence', () => {
    const schedule = scheduleSeam(track(120), track(170, 0.9, true), { exitSeconds: 40 });
    expect(schedule.kind).toBe('fade');
    expect(schedule.reason).toContain('half/double-time ambiguous');
  });

  it('honours leave_after: a transition never starts before 30 s into the song', () => {
    const schedule = scheduleSeam(track(120), track(122), { exitSeconds: 10 });
    expect(schedule.kind).toBe('beatmatch');
    expect(schedule.startSeconds).toBeGreaterThanOrEqual(LEAVE_AFTER_SECONDS);
    // The fade fallback is held to the same settle rule.
    const fade = scheduleSeam(track(120, 0.1), track(122), { exitSeconds: 5 });
    expect(fade.startSeconds).toBeGreaterThanOrEqual(LEAVE_AFTER_SECONDS);
  });

  it('snaps a confident seam to a beat and starts deck B there', () => {
    const schedule = scheduleSeam(track(120), track(122), { exitSeconds: 40.1 });
    expect(schedule.kind).toBe('beatmatch');
    expect(schedule.startSeconds).toBeCloseTo(40.5, 9); // next 120 BPM beat after 40.1
    const start = schedule.events.find((event) => event.kind === 'start');
    expect(start).toBeDefined();
    expect(start?.deck).toBe('b');
    expect(start?.at).toBeCloseTo(40.5, 9);
    expect(start?.sourceAt).toBeDefined();
  });

  it('bounds the prepared window length', () => {
    const schedule = scheduleSeam(track(120), track(122), { exitSeconds: 40, windowSeconds: 90 });
    expect(schedule.windowSeconds).toBe(MAX_WINDOW_SECONDS);
  });

  it('emits a bounded, time-sorted event list the scheduler can consume directly', () => {
    const schedule = scheduleSeam(track(120), track(122), { exitSeconds: 40 });
    expect(schedule.events.length).toBeGreaterThan(3);
    expect(schedule.events.length).toBeLessThan(220); // 2 x 50 gain points + start + stop
    for (let index = 1; index < schedule.events.length; index += 1) {
      expect(schedule.events[index].at).toBeGreaterThanOrEqual(schedule.events[index - 1].at);
    }
    const stop = schedule.events[schedule.events.length - 1];
    expect(stop.kind).toBe('stop');
    expect(stop.deck).toBe('a');
    // Every gain event carries a value in [0, 1].
    for (const event of schedule.events) {
      if (event.kind === 'gain') {
        expect(event.value).toBeGreaterThanOrEqual(0);
        expect(event.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('falls back to a fade when a track has no usable beat grid', () => {
    const gridless: TrackTiming = {
      beats: [],
      tempo: { bpm: 120, confidence: 0.9, ambiguous: false },
      durationSeconds: 120,
    };
    const schedule = scheduleSeam(gridless, track(122), { exitSeconds: 40 });
    expect(schedule.kind).toBe('fade');
    expect(schedule.reason).toContain('no usable beat');
  });
});
