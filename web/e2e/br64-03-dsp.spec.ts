import { test,expect } from '@playwright/test';
import { sine,clicks } from '../src/dsp/fixtures/synthetic';
import { renderTransitionWindow } from '../src/dsp/transitions/render';
import { equalPowerFade } from '../src/dsp/transitions/script';
import { samplePeak } from '../src/dsp/core/dynamics';
// Independent of a server fixture: portable format/transition contracts under Playwright runner.
test('browser DSP golden synthetic: a prepared seam has exact sample count',()=>{
  const first=sine(220,0.5,22050,0.3,1),second=sine(440,0.5,22050,0.3,1);
  const result=renderTransitionWindow({
    style:'equal_power',duration:0.5,overlap:[0,0.5],
    a:{sourceId:'a',warp:{output:[0,0.5],source:[0,0.5]},gain:equalPowerFade(0,0.5,'out')},
    b:{sourceId:'b',warp:{output:[0,0.5],source:[0,0.5]},gain:equalPowerFade(0,0.5,'in')}
  },{a:first,b:second},{sampleRate:22050});
  expect(result.pcm.channels[0].length).toBe(11025);
  expect(samplePeak(result.pcm)).toBeGreaterThan(0.1);
  expect(result.source).toBe('local-pcm');
});
test('click fixture is reproducible for native golden comparison',()=>{
  const a=clicks(120,1,22050,1),b=clicks(120,1,22050,1);
  expect(a.channels[0]).toEqual(b.channels[0]);
});
