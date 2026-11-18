import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine';
import { buildRecord, canonicalRecord, Probes, qualification, recordDigest, RECORD_SCHEMA, TUPLE_FIELDS, tupleKey } from './capabilityRecord';
import { DeviceIdentity, deviceIdentity, identityFromDescription, UNKNOWN_IDENTITY } from './deviceIdentity';
import { codecAnswers, runBenchmark, runProbeSuite } from './probeSuite';

const PASSING: Probes = {
  worklet: { ok: true, sampleRate: 48000, schedulingMisses: 0, blocks: 120 },
  storage: { opfs: { supported: true }, space: { supported: true, usage: 1, quota: 2, persisted: false } },
  pickers: { directoryInput: { supported: true }, dirPicker: { supported: false, reason: 'no picker' } },
  codecs: { mp3: 'probably', aac: 'maybe', flac: '', opus: 'probably', wav: 'probably' },
  benchmark: { ran: true, implementation: 'synthetic', blocks: 10, worstBlockMs: 0.2, medianBlockMs: 0.1, budgetMsPerBlock: 1 },
  outputSelection: false,
  wakeLockApi: true,
};

const IDENTITY: DeviceIdentity = { device_model: 'SM-X200', os_version: 'Android 14', browser_engine: 'blink', browser_version: 'Chrome 131.0', identity_source: 'client_hints' };

const record = (probes: Probes = PASSING, identity = IDENTITY) => buildRecord({
  identity, engineVersion: ENGINE_VERSION, codec: 'mp3', mediaSource: 'local_file', output: 'bluetooth', probes, measuredAt: 1_800_000_000,
});

describe('capability record (BF-0460-01)', () => {
  it('is keyed by every field of the ADR tuple, in order', () => {
    expect(TUPLE_FIELDS).toEqual(['device_model', 'os_version', 'browser_engine', 'browser_version', 'engine_version', 'codec', 'media_source', 'output_type']);
    const made = record();
    expect(made.schema).toBe(RECORD_SCHEMA);
    expect(made.key).toBe(tupleKey(made.tuple));
    for (const field of TUPLE_FIELDS) expect(made.key).toContain(`${field}=`);
    expect(made.tuple).toMatchObject({ device_model: 'SM-X200', engine_version: ENGINE_VERSION, codec: 'mp3', media_source: 'local_file', output_type: 'bluetooth' });
  });

  it('files different tuples apart: one changed field is a different key', () => {
    const base = record();
    const otherOutput = buildRecord({ identity: IDENTITY, engineVersion: ENGINE_VERSION, codec: 'mp3', mediaSource: 'local_file', output: 'hdmi_dock', probes: PASSING, measuredAt: 1 });
    const otherEngine = buildRecord({ identity: IDENTITY, engineVersion: 'older', codec: 'mp3', mediaSource: 'local_file', output: 'bluetooth', probes: PASSING, measuredAt: 1 });
    expect(new Set([base.key, otherOutput.key, otherEngine.key]).size).toBe(3);
  });

  it('has signed-shape canonical bytes: key order does not change them, and a digest where WebCrypto exists', async () => {
    const made = record();
    const shuffled = JSON.parse(JSON.stringify({ probes: made.probes, tuple: made.tuple, key: made.key, schema: made.schema, measured_at: made.measured_at, identity_source: made.identity_source }));
    expect(canonicalRecord(shuffled)).toBe(canonicalRecord(made));
    const digest = await recordDigest(made);
    if (digest !== null) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('qualifies by measured probes alone: the same probes give the same answer whatever the identity', () => {
    const identities = [IDENTITY, UNKNOWN_IDENTITY, { ...IDENTITY, device_model: 'iPad', browser_engine: 'webkit', browser_version: 'Safari 18' }];
    const answers = identities.map((identity) => qualification(record(PASSING, identity).probes));
    expect(answers.every((answer) => JSON.stringify(answer) === JSON.stringify(answers[0]))).toBe(true);
    expect(answers[0].player).toBe(true);
  });

  it('refuses with the probe reason when the worklet did not run, and when no format plays', () => {
    const noWorklet = qualification({ ...PASSING, worklet: { ok: false, reason: 'The audio worklet loaded but never processed audio.' } });
    expect(noWorklet).toMatchObject({ player: false, reason: 'The audio worklet loaded but never processed audio.' });
    const noCodec = qualification({ ...PASSING, codecs: { mp3: '', aac: '', flac: '', opus: '', wav: '' } });
    expect(noCodec.player).toBe(false);
  });

  it('notes missing storage and wake lock without refusing a device that passes', () => {
    const answer = qualification({ ...PASSING, storage: { ...PASSING.storage, opfs: { supported: false, reason: 'No private storage here.' } }, wakeLockApi: false });
    expect(answer.player).toBe(true);
    expect(answer.notes.join(' ')).toMatch(/No private storage here/);
    expect(answer.notes.join(' ')).toMatch(/auto-lock/);
  });
});

describe('the probe suite', () => {
  it('collects every probe into one record under the full tuple', async () => {
    const made = await runProbeSuite({
      worklet: { ok: true, sampleRate: 44100, schedulingMisses: 1, blocks: 64 },
      output: 'headphones',
      identity: async () => IDENTITY,
      codecs: () => ({ mp3: 'maybe', wav: 'probably' }),
      benchmark: () => ({ ran: false, reason: 'skipped in test' }),
      now: () => 5,
    });
    expect(made.tuple).toMatchObject({ output_type: 'headphones', codec: 'wav', engine_version: ENGINE_VERSION, media_source: 'local_file' });
    expect(made.probes.worklet).toEqual({ ok: true, sampleRate: 44100, schedulingMisses: 1, blocks: 64 });
    expect(made.probes.storage.opfs).toHaveProperty('supported');
    expect(made.probes.pickers.directoryInput).toHaveProperty('supported');
    expect(typeof made.probes.outputSelection).toBe('boolean');
    expect(made.measured_at).toBe(5);
  });

  it('keeps a failing worklet probe and its reason in the record', async () => {
    const made = await runProbeSuite({
      worklet: { ok: false, state: 'unsupported_here', reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' },
      identity: async () => UNKNOWN_IDENTITY,
      codecs: () => ({ mp3: '' }),
      benchmark: () => ({ ran: false, reason: 'skipped' }),
    });
    expect(made.probes.worklet).toEqual({ ok: false, reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' });
    expect(made.tuple.codec).toBe('unknown');
    expect(qualification(made.probes).player).toBe(false);
  });

  it('asks the browser about each codec and keeps only its three honest answers', () => {
    const answers = codecAnswers({ canPlayType: (type) => (type.includes('mpeg') ? 'probably' : type.includes('flac') ? 'nonsense' : '') });
    expect(answers.mp3).toBe('probably');
    expect(answers.flac).toBe('');
  });

  it('benchmarks real per-sample work and calibrates a budget from it', () => {
    let tick = 0;
    const result = runBenchmark({ batches: 3, blocksPerBatch: 2, now: () => (tick += 2) });
    expect(result).toMatchObject({ ran: true, blocks: 6 });
    if (result.ran) expect(result.budgetMsPerBlock).toBeGreaterThanOrEqual(result.worstBlockMs);
  });
});

describe('device identity labels the record and nothing else', () => {
  it('reads labels from the description string', () => {
    const tablet = identityFromDescription('Mozilla/5.0 (Linux; Android 14; SM-X200 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    expect(tablet).toMatchObject({ device_model: 'SM-X200', os_version: 'Android 14', browser_engine: 'blink', browser_version: '131.0.0.0' });
    const ipad = identityFromDescription('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1');
    expect(ipad).toMatchObject({ device_model: 'iPad', os_version: 'iOS 18.1', browser_engine: 'webkit' });
    expect(identityFromDescription('')).toEqual(UNKNOWN_IDENTITY);
  });

  it('prefers client hints where the browser has them', async () => {
    const identity = await deviceIdentity({
      description: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      hints: { getHighEntropyValues: async () => ({ model: 'Pixel Tablet', platform: 'Android', platformVersion: '15.0.0', fullVersionList: [{ brand: 'Chromium', version: '131.0.1' }, { brand: 'Google Chrome', version: '131.0.1' }] }) },
    });
    expect(identity).toMatchObject({ device_model: 'Pixel Tablet', os_version: 'Android 15.0.0', browser_engine: 'blink', browser_version: 'Google Chrome 131.0.1', identity_source: 'client_hints' });
  });
});
