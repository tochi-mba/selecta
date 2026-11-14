import { describe,it,expect } from 'vitest';
import { extractSpectral } from './spectral';
import { chromaKey,camelot,camelotDistance } from './key';
import { detectBeats,fitBeatGrid } from './beats';
import { sine } from '../fixtures/synthetic';
describe('Musical feature contracts',()=>{
  it('extracts 12 chroma classes, 20 MFCC coefficients and finite energy',()=>{
    const features=extractSpectral(sine(440,1.2,22050,0.4,1));
    expect(features.chromaProfile).toHaveLength(12);
    expect(features.frames[0].mfcc).toHaveLength(20);
    expect(features.frames.every(f=>Number.isFinite(f.rmsDb))).toBe(true);
    expect(features.waveform).toHaveLength(160);
  });
  it('matches native Camelot wheel and harmonic distance',()=>{
    expect(camelot('C major')).toBe('8B');
    expect(camelot('A minor')).toBe('8A');
    expect(camelotDistance('8A','9A')).toBe(1);
    expect(chromaKey(new Array(12).fill(0)).name).toBe('unknown');
  });
  it('detects a 120 BPM onset grid with explicitly reduced non-neural confidence',()=>{
    const hop=0.01,env=new Array(1800).fill(0);
    for(let t=0;t<18;t+=0.5)env[Math.round(t/hop)]=1;
    const result=detectBeats(env,hop);
    expect(result).not.toBeNull();
    expect(result!.bpm).toBeGreaterThan(117);
    expect(result!.bpm).toBeLessThan(123);
    expect(result!.confidence).toBeLessThanOrEqual(0.49);
    expect(result!.beats.length).toBeGreaterThan(30);
    const shifted=detectBeats(env,hop,20);
    expect(shifted!.beats[0]).toBeGreaterThanOrEqual(20);
    expect(shifted!.onsetAgreement).toBeGreaterThan(0);
  });
  it('ports the native constant-tempo fit path for supplied model beats',()=>{
    const beats=Array.from({length:40},(_,i)=>i*0.5+0.003*Math.sin(i));
    const env=new Array(4000).fill(0);
    for(const beat of beats)env[Math.round(beat/0.005)]=1;
    const result=fitBeatGrid(beats,env,0.005,beats.filter((_,i)=>i%4===0));
    expect(result!.constantTempo).toBe(true);
    expect(result!.bpm).toBeGreaterThan(119);
    expect(result!.bpm).toBeLessThan(121);
    expect(result!.barStarts.length).toBeGreaterThan(6);
  });
});
