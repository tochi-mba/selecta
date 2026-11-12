import { afterEach, describe, expect, it } from 'vitest';
import { parseRoute, pathOf } from '../router';
import { describeRoute, destinationOf } from '../shell/manifest';
import { forgetSent, keepUnsent, unsentKey } from './unsent';
import { countsWords, seamWords } from './words';

describe('Lucy addresses', () => {
  it('parse, describe and round-trip', () => {
    expect(parseRoute('/mixes/lucy')).toEqual({ page: 'lucy', conversation: null });
    const route = parseRoute('/mixes/lucy/cv_0a1b2c3d');
    expect(route).toEqual({ page: 'lucy', conversation: 'cv_0a1b2c3d' });
    expect(pathOf(route)).toBe('/mixes/lucy/cv_0a1b2c3d');
    expect(pathOf({ page: 'lucy', conversation: null })).toBe('/mixes/lucy');
    expect(destinationOf(route)).toBe('explore');
    expect(describeRoute(route).crumbs.map((crumb) => crumb.label)).toEqual(['Make a Mix', 'Lucy']);
  });

  it('never reads a strange address as a conversation', () => {
    expect(parseRoute('/mixes/lucy/../../etc').page).toBe('missing');
    expect(parseRoute('/mixes/lucy/a b').page).toBe('missing');
  });
});

describe('unsent words', () => {
  afterEach(() => window.localStorage.clear());

  it('belong to one conversation and never show up in another', () => {
    keepUnsent('cv_a', 'half a thought');
    expect(window.localStorage.getItem(unsentKey('cv_a'))).toBe('half a thought');
    expect(window.localStorage.getItem(unsentKey('cv_b'))).toBeNull();
    forgetSent('cv_a', 'something else');
    expect(window.localStorage.getItem(unsentKey('cv_a'))).toBe('half a thought');
    forgetSent('cv_a', 'half a thought');
    expect(window.localStorage.getItem(unsentKey('cv_a'))).toBeNull();
  });
});

describe('plain words for states', () => {
  it('never says ready for something that is gone or unknown', () => {
    expect(seamWords('already_rendered', true).words).toBe('Ready to play');
    expect(seamWords('already_rendered', false).words).toBe('Rendered, not verified on disk');
    expect(seamWords('something new', true).words).toBe('Unknown');
    expect(seamWords('gone').words).toBe('Was ready before - gone now');
    expect(seamWords('none').words).toBe('Not rendered yet');
    expect(seamWords('something new').words).toBe('Unknown');
  });

  it('counts changes exactly', () => {
    expect(countsWords({ replaced: 1, kept: 5, added: 0, moved: 0, removed: 0 })).toContain('1 replaced');
  });
});
