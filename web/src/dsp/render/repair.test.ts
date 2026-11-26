import { describe, expect, it } from 'vitest';
import {
  attemptedFromJson,
  attemptedToJson,
  auditFactsFromJson,
  closer,
  goodEnough,
  nextStep,
  optionFromJson,
  optionToJson,
  repairStepFromJson,
  repairStepToJson,
  takeStep,
} from './repair';

// The repair rule against src/selecta/planner_core/repair.py, on the table of cases
// tools/device_render_golden.py had the real rule answer (every branch of next_step, take_step,
// good_enough and closer). Exact equality: the rule has no arithmetic to round.

type Case = Record<string, unknown> & { kind: string; name: string };

const files = import.meta.glob('../golden/device-render/repair.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const cases = JSON.parse(files['../golden/device-render/repair.json']) as Case[];

const facts = (data: unknown) => auditFactsFromJson(data as Record<string, unknown>);

describe('the repair rule, against the Python rule', () => {
  it('has a case for every branch', () => {
    const kinds = new Set(cases.map((item) => item.kind));
    expect([...kinds].sort()).toEqual(['closer', 'good_enough', 'next_step', 'take_step']);
    const actions = new Set(cases.filter((item) => 'step' in item).map((item) => (item.step as { action: string }).action));
    expect([...actions].sort()).toEqual(['accept', 'fallback', 'keep', 'tighten', 'try']);
  });

  for (const item of cases) {
    it(`${item.kind}: ${item.name}`, () => {
      if (item.kind === 'next_step') {
        const options = (item.options as Record<string, unknown>[]).map(optionFromJson);
        const attempts = (item.attempts as Record<string, unknown>[]).map(attemptedFromJson);
        expect(repairStepToJson(nextStep(options, attempts, item.max_repairs as number))).toEqual(item.step);
      } else if (item.kind === 'take_step') {
        const step = takeStep(facts(item.first), item.second === null ? null : facts(item.second));
        expect(repairStepToJson(step)).toEqual(item.step);
      } else if (item.kind === 'good_enough') {
        expect(goodEnough(facts(item.facts))).toBe(item.answer);
      } else {
        expect(closer(facts(item.facts), facts(item.than))).toBe(item.answer);
      }
    });
  }

  it('writes every JSON form back as Python wrote it', () => {
    for (const item of cases.filter((entry) => entry.kind === 'next_step')) {
      for (const option of item.options as Record<string, unknown>[]) expect(optionToJson(optionFromJson(option))).toEqual(option);
      for (const attempt of item.attempts as Record<string, unknown>[]) expect(attemptedToJson(attemptedFromJson(attempt))).toEqual(attempt);
      expect(repairStepToJson(repairStepFromJson(item.step as Record<string, unknown>))).toEqual(item.step);
    }
  });

  it('reads a value that is not finite from its tagged form', () => {
    const read = facts({ passed: false, failures: [{ name: 'harmony', value: { $type: 'float', value: 'inf' }, limit: 0.16, fix: 'shorten' }] });
    expect(read.failures[0].value).toBe(Infinity);
  });
});
