/** Transition scripts as JSON, read and written as src/selecta/render/script_json.py does
 * (docs/engineering/transition-script-json.md, schema 1).
 *
 * Numbers are plain JSON numbers, read back as the same doubles (Python writes the shortest exact
 * repr); a value that is not finite is `{"$type": "float", "value": "inf"}`. A schema, a meta tag
 * or an effect field this reader does not know is refused, never guessed. One difference in
 * writing: JavaScript has one number type, so a meta value Python held as the float 16.0 comes
 * back from this writer as 16, which Python reads as an int of the same value.
 */

import { Curve, type Echo, type MetaValue, type Part, type SourceRef, STEM_NAMES, type StemName, type TransitionScript, type Wash, Warp } from './script';

export const SCHEMA_VERSION = 1;
const TAG = '$type';
const CURVES = ['gain', 'low', 'mid', 'high'] as const;
const OPTIONAL_CURVES = [
  ['highpass', 'highpass'],
  ['lowpass', 'lowpass'],
  ['echo_send', 'echoSend'],
  ['wash_send', 'washSend'],
] as const;

export class ScriptJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptJsonError';
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Python's float(): a JSON number, or the tagged form of a value that isn't finite. */
export function readNumber(value: unknown, where = 'number'): number {
  if (typeof value === 'number') return value;
  if (isObject(value) && value[TAG] === 'float') {
    const text = String(value.value).trim().toLowerCase();
    if (text === 'inf' || text === '+inf' || text === 'infinity' || text === '+infinity') return Infinity;
    if (text === '-inf' || text === '-infinity') return -Infinity;
    if (text === 'nan' || text === '+nan' || text === '-nan') return NaN;
    const parsed = Number(text);
    if (text !== '' && !Number.isNaN(parsed)) return parsed;
  }
  throw new ScriptJsonError(`${where} is not a number`);
}

export function writeNumber(value: number): Json {
  if (Number.isFinite(value)) return value;
  return { [TAG]: 'float', value: Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf' };
}

/** Python's bool() of a JSON value. */
function pyBool(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

function field(data: JsonObject, name: string, where: string): Json {
  if (!(name in data)) throw new ScriptJsonError(`${where} has no ${name}`);
  return data[name];
}

function readCurve(points: unknown, where: string): Curve {
  if (!Array.isArray(points)) throw new ScriptJsonError(`${where} is not a list of points`);
  return new Curve(
    points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) throw new ScriptJsonError(`${where}[${index}] is not a [time, value] pair`);
      return [readNumber(point[0], `${where}[${index}]`), readNumber(point[1], `${where}[${index}]`)] as [number, number];
    }),
  );
}

function writeCurve(curve: Curve): Json {
  return curve.points().map(([time, value]) => [writeNumber(time), writeNumber(value)]);
}

function readWarp(data: unknown, where: string): Warp {
  if (!isObject(data)) throw new ScriptJsonError(`${where} is not a warp`);
  const output = field(data, 'output', where);
  const source = field(data, 'source', where);
  if (!Array.isArray(output) || !Array.isArray(source)) throw new ScriptJsonError(`${where} needs output and source lists`);
  try {
    return new Warp(Float64Array.from(output, (t) => readNumber(t, where)), Float64Array.from(source, (t) => readNumber(t, where)));
  } catch (problem) {
    if (problem instanceof ScriptJsonError) throw problem;
    throw new ScriptJsonError(`${where}: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}

export function readSourceRef(data: unknown, where = 'source'): SourceRef {
  if (!isObject(data)) throw new ScriptJsonError(`${where} is not a source reference`);
  const song = field(data, 'song', where);
  if (typeof song !== 'number' && typeof song !== 'string') throw new ScriptJsonError(`${where}.song is neither a number nor text`);
  if (data.role === 'stem') {
    const stem = data.stem;
    if (typeof stem !== 'string' || !(STEM_NAMES as readonly string[]).includes(stem)) throw new ScriptJsonError(`unknown stem ${JSON.stringify(stem)}`);
    const window = field(data, 'window', where);
    if (!isObject(window)) throw new ScriptJsonError(`${where}.window is not a window`);
    return { song, role: 'stem', stem: stem as StemName, start: readNumber(field(window, 'start', where)), duration: readNumber(field(window, 'duration', where)) };
  }
  const role = data.role === undefined ? 'mix' : String(data.role);
  if (role !== 'mix') throw new ScriptJsonError(`unknown source role ${JSON.stringify(role)}`);
  return { song, role: 'mix', stem: null, start: 0, duration: 0 };
}

export function writeSourceRef(ref: SourceRef): Json {
  if (ref.role === 'mix') return { song: ref.song, role: 'mix' };
  return { song: ref.song, role: 'stem', stem: ref.stem, window: { start: ref.start, duration: ref.duration } };
}

const ECHO_FIELDS: Record<string, keyof Echo> = {
  delay_seconds: 'delaySeconds',
  feedback: 'feedback',
  wet: 'wet',
  return_highpass_hz: 'returnHighpassHz',
  damp_lowpass_hz: 'dampLowpassHz',
};
const WASH_FIELDS: Record<string, keyof Wash> = {
  wet: 'wet',
  decay_seconds: 'decaySeconds',
  damping: 'damping',
  return_highpass_hz: 'returnHighpassHz',
};

function readEffect<T>(data: unknown, fields: Record<string, keyof T>, defaults: Partial<T>, where: string): T {
  if (!isObject(data)) throw new ScriptJsonError(`${where} is not an object`);
  const out: Partial<T> = { ...defaults };
  for (const [key, value] of Object.entries(data)) {
    const name = fields[key];
    // the dataclass refuses a keyword it does not have
    if (name === undefined) throw new ScriptJsonError(`${where} has an unknown field ${key}`);
    (out as Record<keyof T, number>)[name] = readNumber(value, `${where}.${key}`);
  }
  for (const name of Object.values(fields)) if (out[name] === undefined) throw new ScriptJsonError(`${where} has no ${String(name)}`);
  return out as T;
}

function writeEffect<T>(effect: T, fields: Record<string, keyof T>): Json {
  const out: JsonObject = {};
  for (const [key, name] of Object.entries(fields)) out[key] = writeNumber(effect[name] as number);
  return out;
}

function readPart(data: unknown, version: number, where: string): Part {
  if (!isObject(data)) throw new ScriptJsonError(`${where} is not a part`);
  const source = readSourceRef(field(data, 'source', where), `${where}.source`);
  const facts = field(data, 'facts', where);
  if (!isObject(facts)) throw new ScriptJsonError(`${where}.facts is not an object`);
  const optional = (name: string): Curve | null => (data[name] === undefined || data[name] === null ? null : readCurve(data[name], `${where}.${name}`));
  const number = (name: string): number | null => (data[name] === undefined || data[name] === null ? null : readNumber(data[name], `${where}.${name}`));
  return {
    source,
    facts: { id: source.song, gainDb: readNumber(field(facts, 'gain_db', `${where}.facts`)), version, vocalsKnown: false, lines: [] },
    warp: readWarp(field(data, 'warp', where), `${where}.warp`),
    gain: readCurve(field(data, 'gain', where), `${where}.gain`),
    low: readCurve(field(data, 'low', where), `${where}.low`),
    mid: readCurve(field(data, 'mid', where), `${where}.mid`),
    high: readCurve(field(data, 'high', where), `${where}.high`),
    highpass: optional('highpass'),
    lowpass: optional('lowpass'),
    echo: data.echo === undefined || data.echo === null ? null : readEffect<Echo>(data.echo, ECHO_FIELDS, { feedback: 0.6, wet: 0.35, returnHighpassHz: 250, dampLowpassHz: 6000 }, `${where}.echo`),
    echoSend: optional('echo_send'),
    wash: data.wash === undefined || data.wash === null ? null : readEffect<Wash>(data.wash, WASH_FIELDS, { wet: 0.38, decaySeconds: 2.2, damping: 0.45, returnHighpassHz: 350 }, `${where}.wash`),
    washSend: optional('wash_send'),
    windowOrigin: readNumber(field(data, 'window_origin', where), `${where}.window_origin`),
    renderFrom: number('render_from'),
    renderUntil: number('render_until'),
    followsB: pyBool(data.follows_b ?? false),
  };
}

function writePart(part: Part): Json {
  const out: JsonObject = {
    source: writeSourceRef(part.source),
    window_origin: writeNumber(part.windowOrigin),
    facts: { gain_db: writeNumber(part.facts.gainDb) },
    warp: { output: Array.from(part.warp.output, writeNumber), source: Array.from(part.warp.source, writeNumber) },
  };
  for (const name of CURVES) out[name] = writeCurve(part[name]);
  for (const [key, name] of OPTIONAL_CURVES) out[key] = part[name] === null ? null : writeCurve(part[name] as Curve);
  out.echo = part.echo === null ? null : writeEffect(part.echo, ECHO_FIELDS);
  out.wash = part.wash === null ? null : writeEffect(part.wash, WASH_FIELDS);
  out.render_from = part.renderFrom === null ? null : writeNumber(part.renderFrom);
  out.render_until = part.renderUntil === null ? null : writeNumber(part.renderUntil);
  out.follows_b = part.followsB;
  return out;
}

function readMeta(value: Json): MetaValue {
  if (Array.isArray(value)) return value.map(readMeta);
  if (isObject(value)) {
    const tag = value[TAG];
    if (tag === 'curve') return readCurve(value.points, 'meta curve');
    if (tag === 'float') return readNumber(value);
    if (tag !== undefined) throw new ScriptJsonError(`unknown meta type ${JSON.stringify(tag)}`);
    const out: { [key: string]: MetaValue } = {};
    for (const [key, item] of Object.entries(value)) out[key] = readMeta(item);
    return out;
  }
  return value;
}

function writeMeta(value: MetaValue, where: string): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return writeNumber(value);
  if (value instanceof Curve) return { [TAG]: 'curve', points: writeCurve(value) };
  if (Array.isArray(value)) return value.map((item, index) => writeMeta(item, `${where}[${index}]`));
  if (TAG in value) throw new ScriptJsonError(`meta ${where} uses the reserved key ${TAG}`);
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) out[key] = writeMeta(item, `${where}.${key}`);
  return out;
}

/** The script from its JSON data (`script_json.from_dict`). */
export function scriptFromDict(data: unknown): TransitionScript {
  if (!isObject(data)) throw new ScriptJsonError('a script is a JSON object');
  if (data.schema !== SCHEMA_VERSION) throw new ScriptJsonError(`script schema ${JSON.stringify(data.schema ?? null)} isn't ${SCHEMA_VERSION}`);
  const version = Math.trunc(Number(field(data, 'facts_version', 'script')));
  if (!Number.isFinite(version)) throw new ScriptJsonError('facts_version is not a whole number');
  const overlap = field(data, 'overlap', 'script');
  if (!Array.isArray(overlap) || overlap.length < 2) throw new ScriptJsonError('overlap is not a pair');
  const extras = data.extras;
  const meta = readMeta(data.meta ?? {});
  if (!isObject(meta)) throw new ScriptJsonError('meta is not an object');
  return {
    style: String(field(data, 'style', 'script')),
    duration: readNumber(field(data, 'duration', 'script'), 'duration'),
    a: readPart(field(data, 'a', 'script'), version, 'a'),
    b: readPart(field(data, 'b', 'script'), version, 'b'),
    overlap: [readNumber(overlap[0], 'overlap'), readNumber(overlap[1], 'overlap')],
    expectsBeatsAligned: pyBool(data.expects_beats_aligned ?? false),
    quietAllowed: readNumber(data.quiet_allowed ?? 0, 'quiet_allowed'),
    extras: Array.isArray(extras) ? extras.map((extra, index) => readPart(extra, version, `extras[${index}]`)) : [],
    meta: meta as { [key: string]: MetaValue },
    factsVersion: version,
  };
}

export function scriptFromJson(text: string): TransitionScript {
  return scriptFromDict(JSON.parse(text));
}

/** The script as JSON data (`script_json.to_dict`), keys in Python's order. */
export function scriptToDict(script: TransitionScript): Json {
  const meta: JsonObject = {};
  for (const [key, value] of Object.entries(script.meta)) meta[key] = writeMeta(value, key);
  return {
    schema: SCHEMA_VERSION,
    facts_version: script.factsVersion,
    style: script.style,
    duration: writeNumber(script.duration),
    overlap: [writeNumber(script.overlap[0]), writeNumber(script.overlap[1])],
    expects_beats_aligned: script.expectsBeatsAligned,
    quiet_allowed: writeNumber(script.quietAllowed),
    a: writePart(script.a),
    b: writePart(script.b),
    extras: script.extras.map(writePart),
    meta,
  };
}

export function scriptToJson(script: TransitionScript): string {
  return JSON.stringify(scriptToDict(script));
}
