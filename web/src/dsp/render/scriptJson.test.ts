import { describe, expect, it } from 'vitest';
import { Curve } from './script';
import { ScriptJsonError, scriptFromDict, scriptFromJson, scriptToDict, scriptToJson } from './scriptJson';

// Scripts as script_json.py writes them (docs/engineering/transition-script-json.md), read from
// the device-render fixtures, which hold the real to_json output of every recipe.

const files = import.meta.glob('../golden/device-render/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const manifest = JSON.parse(files['../golden/device-render/manifest.json']) as { cases: { name: string; file: string }[] };
const scripts = manifest.cases.map((entry) => ({
  name: entry.name,
  data: (JSON.parse(files[`../golden/device-render/${entry.file}`]) as { script: Record<string, unknown> }).script,
}));

const sameNumbers = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

describe('script JSON', () => {
  for (const { name, data } of scripts) {
    it(`reads and writes back the ${name} script with every number the same double`, () => {
      const script = scriptFromDict(data);
      expect(sameNumbers(scriptToDict(script), data)).toBe(true);
      expect(sameNumbers(scriptToDict(scriptFromJson(scriptToJson(script))), data)).toBe(true);
    });
  }

  it('reads curves in meta, stem sources and the extras of a stem seam', () => {
    const seam = scripts.find((entry) => entry.name === 'stem-seam');
    expect(seam).toBeDefined();
    const script = scriptFromDict(seam!.data);
    expect(script.meta.stem_lanes).toBe(true);
    const gains = script.meta.vocal_gains as Record<string, Curve>;
    expect(gains.a).toBeInstanceOf(Curve);
    expect(script.a.source.role).toBe('stem');
    expect(script.a.source.stem).toBe('drums');
    expect(script.a.windowOrigin).toBe(script.a.source.start);
    expect(script.extras.some((extra) => extra.followsB && extra.source.role === 'mix')).toBe(true);
  });

  it('refuses a schema, a stem, a meta tag or an effect field it does not know', () => {
    const base = scripts[0].data;
    expect(() => scriptFromDict({ ...base, schema: 2 })).toThrow(ScriptJsonError);
    const badStem = structuredClone(base) as Record<string, Record<string, unknown>>;
    badStem.a.source = { song: 1, role: 'stem', stem: 'choir', window: { start: 0, duration: 1 } };
    expect(() => scriptFromDict(badStem)).toThrow(/unknown stem/);
    expect(() => scriptFromDict({ ...base, meta: { odd: { $type: 'array', value: [] } } })).toThrow(/unknown meta type/);
    const badEcho = structuredClone(base) as Record<string, Record<string, unknown>>;
    badEcho.a.echo = { delay_seconds: 0.5, sparkle: 1 };
    expect(() => scriptFromDict(badEcho)).toThrow(/unknown field/);
  });

  it('writes a value that is not finite in its tagged form and reads it back', () => {
    const script = scriptFromDict(scripts[0].data);
    script.quietAllowed = Infinity;
    const written = scriptToDict(script) as Record<string, unknown>;
    expect(written.quiet_allowed).toEqual({ $type: 'float', value: 'inf' });
    expect(scriptFromDict(written).quietAllowed).toBe(Infinity);
  });
});
