import { describe, expect, it } from 'vitest';
import { meteredConnection, planStudios, type PlanSong } from './studioPlan';

// Which studio makes each transition (cloud.studio_seams): the cloud when both songs have their
// own cloud copy, even when they are here too; the device studio when both are here and it is on;
// live otherwise; nothing from the cloud on Data Saver or mobile data.

const song = (songId: number, cloud: boolean, here: boolean, cued = false): PlanSong => ({ songId, cloud, here, cued });
const ON = { cloud: true, device: true };

describe('planStudios', () => {
  it('gives the cloud a pair with two cloud copies, the device a pair here, and the rest live', () => {
    const plan = planStudios([song(1, true, false), song(2, true, false), song(3, false, true), song(4, false, true), song(5, false, false)], ON);
    expect(plan.seams).toEqual(['cloud', 'live', 'device', 'live']);
    // the songs next to a cloud seam play their lossless files; the others their originals
    expect(plan.lossless).toEqual([true, true, false, false, false]);
    expect(plan.metered).toBe(false);
  });

  it('uses the cloud studio for songs held both ways', () => {
    const plan = planStudios([song(1, true, true), song(2, true, true), song(3, false, true)], ON);
    expect(plan.seams).toEqual(['cloud', 'device']);
    expect(plan.lossless).toEqual([true, true, false]);
  });

  it('reads only each song’s own copy: a song whose copy is a version’s is not the cloud’s', () => {
    // the caller says `cloud` from the song's own row (ownCloudCopies); a version's copy is false
    const plan = planStudios([song(1, true, false), song(2, false, false)], ON);
    expect(plan.seams).toEqual(['live']);
    expect(plan.lossless).toEqual([false, false]);
  });

  it('leaves the device studio out when it is off, and the cloud out when its flag is', () => {
    expect(planStudios([song(1, true, true), song(2, true, true)], { cloud: false, device: true }).seams).toEqual(['device']);
    expect(planStudios([song(1, false, true), song(2, false, true)], { cloud: true, device: false }).seams).toEqual(['live']);
    expect(planStudios([song(1, true, true), song(2, true, true)], { cloud: false, device: false }).seams).toEqual(['live']);
  });

  it('keeps the member’s own cue points, and never pairs a song with itself', () => {
    const plan = planStudios([song(1, true, true), song(2, true, true, true), song(2, true, true), song(3, true, true)], ON);
    expect(plan.seams).toEqual(['live', 'live', 'cloud']);
    expect(plan.lossless).toEqual([false, false, true, true]);
  });

  it('asks nothing of the cloud on Data Saver or mobile data: every song plays its original', () => {
    const songs = [song(1, true, true), song(2, true, true), song(3, true, false)];
    for (const connection of [{ saveData: true }, { type: 'cellular' }, { saveData: true, type: 'wifi' }]) {
      const plan = planStudios(songs, { ...ON, connection });
      expect(plan.metered).toBe(true);
      expect(plan.seams).toEqual(['device', 'live']);
      expect(plan.lossless).toEqual([false, false, false]);
    }
    expect(planStudios(songs, { ...ON, connection: { type: 'wifi', saveData: false } }).seams).toEqual(['cloud', 'cloud']);
  });

  it('reads a missing or silent connection as unmetered', () => {
    expect(meteredConnection(null)).toBe(false);
    expect(meteredConnection(undefined)).toBe(false);
    expect(meteredConnection({})).toBe(false);
    expect(meteredConnection({ type: 'ethernet' })).toBe(false);
  });

  it('has no seams for one song or none', () => {
    expect(planStudios([song(1, true, true)], ON)).toEqual({ seams: [], lossless: [false], metered: false });
    expect(planStudios([], ON)).toEqual({ seams: [], lossless: [], metered: false });
  });
});
