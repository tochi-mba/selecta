// The privacy notice, as a DRAFT pending legal review (ADR-0412, SC-0412-01). It is shown only
// behind the off-by-default `cloud.privacy_notice_draft` flag so the owner and a privacy adviser
// can read it in place. Nothing here is published: the owner and an adviser rewrite and approve
// it, register with the ICO, and only then is a notice published. Facts come from
// docs/saas/12-security-privacy-legal.md sections 12.2 and 12.4; check each one before publishing.

export const DRAFT_BANNER = 'Draft pending legal review. This notice is not published and is not in force.';

export type NoticeSection = { heading: string; paragraphs: string[] };

export const PRIVACY_NOTICE_DRAFT: NoticeSection[] = [
  {
    heading: 'Who we are',
    paragraphs: [
      'Selecta Cloud is run by [legal name and address, to be confirmed]. We are the controller of the personal data described here. Contact: [privacy contact, to be confirmed].',
    ],
  },
  {
    heading: 'What we hold and why',
    paragraphs: [
      'Your account: email address, sign-in sessions and the devices you have signed in on, to run your account (contract).',
      'Your music: the files you upload and what Selecta works out from them (tempo, key, sections, playback files and transitions), to provide the service you asked for (contract). Your files are private to your workspace and are never shared.',
      'Billing: your plan and payment status; card details are held by Stripe, not by us (contract and legal obligation).',
      'Lucy: the messages you send, and the song titles and artists Lucy needs to answer; lyric snippets and a listening summary only if you turn them on (contract, and consent for the optional parts). They are not used to train models.',
      'Security records: an audit log of sign-ins and changes that holds random ids, never names, emails or content (legitimate interests: keeping accounts safe).',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: [
      'Original files: until you delete them, or 12 months after a lapsed account stays over its storage limit, with warnings first.',
      'Derived data (playback files, transitions, analysis): removed when space is needed and made again on demand.',
      'Exports: for the time your plan states. Lucy conversations: until you delete them, or 24 months without use.',
      'Audit records: 2 years. Database backups: 30 days.',
    ],
  },
  {
    heading: 'Who processes it for us',
    paragraphs: [
      'Cloudflare (storage and delivery), Render (servers and database), Modal (audio processing), Anthropic (Lucy), Stripe (payments), WorkOS (sign-in), Sentry and Grafana (errors and monitoring) and our email provider [to be confirmed], each under a data processing agreement.',
      'Some are in the United States. Transfers rely on the UK Extension to the EU-US Data Privacy Framework where the provider is certified, otherwise the UK International Data Transfer Agreement or Addendum. We choose EU regions where offered.',
    ],
  },
  {
    heading: 'Cookies',
    paragraphs: ['Only strictly necessary cookies: your sign-in session and protection against forged requests. No advertising or tracking cookies.'],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'You can download a copy of your data (Download my data), delete songs or your whole account, and ask us to correct or stop using your data. We answer within one month.',
      'You can complain to the Information Commissioner\'s Office (ico.org.uk). ICO registration number: [to be added once registered].',
    ],
  },
];
