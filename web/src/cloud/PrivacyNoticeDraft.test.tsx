import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import cloud from '../../../src/selecta/flags/cloud.json' with { type: 'json' };
import { PRIVACY_DRAFT_FLAG, PrivacyNoticeDraft, showsPrivacyDraft } from './PrivacyNoticeDraft';
import { DRAFT_BANNER, PRIVACY_NOTICE_DRAFT } from './privacyNoticeDraftText';

// SC-0412-01: the privacy notice is a draft pending legal review. It is in the app only behind an
// off-by-default flag, says plainly that it is a draft and not in force, and covers what the
// notice must list: data, purposes and lawful bases, retention, processors and transfers, cookies
// and rights.

afterEach(cleanup);

describe('the draft privacy notice', () => {
  it('is off by default and needs an explicit true to show', () => {
    expect((cloud.flags as Record<string, { default?: boolean }>)[PRIVACY_DRAFT_FLAG].default).toBe(false);
    expect(showsPrivacyDraft(undefined)).toBe(false);
    expect(showsPrivacyDraft({})).toBe(false);
    expect(showsPrivacyDraft({ [PRIVACY_DRAFT_FLAG]: false })).toBe(false);
    expect(showsPrivacyDraft({ [PRIVACY_DRAFT_FLAG]: true })).toBe(true);
  });

  it('says it is a draft pending legal review before anything else', () => {
    expect(DRAFT_BANNER).toMatch(/^Draft pending legal review\./);
    expect(DRAFT_BANNER).toContain('not published');
    render(<PrivacyNoticeDraft />);
    expect(screen.getByRole('note')).toHaveTextContent(DRAFT_BANNER);
    expect(screen.getByRole('heading', { name: 'Privacy notice' })).toBeInTheDocument();
  });

  it('covers every part the notice must list', () => {
    const headings = PRIVACY_NOTICE_DRAFT.map((section) => section.heading);
    expect(headings).toEqual(['Who we are', 'What we hold and why', 'How long we keep it', 'Who processes it for us', 'Cookies', 'Your rights']);
    const text = PRIVACY_NOTICE_DRAFT.flatMap((section) => section.paragraphs).join(' ');
    for (const word of ['(contract)', 'legitimate interests', '12 months', '2 years', '30 days', 'Stripe', 'WorkOS', 'Anthropic', 'International Data Transfer Agreement', 'strictly necessary', 'one month', "Information Commissioner's Office", 'LRCLIB', 'Rooms guest data: 30 days', 'within 60 days', 'hashed IP address']) {
      expect(text).toContain(word);
    }
    expect(text).not.toContain('\u2014');
    // the provider is named, but its registered details stay placeholders until confirmed
    expect(text).toContain('run by REX Technologies [registered address, to be confirmed; company number, to be confirmed]');
    expect(text).toContain('REX Technologies is the controller');
  });
});
