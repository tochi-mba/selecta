import { DRAFT_BANNER, PRIVACY_NOTICE_DRAFT } from './privacyNoticeDraftText';

/** The draft privacy notice under Settings, behind the off-by-default `cloud.privacy_notice_draft`
 * flag (SC-0412-01). An explicit `true` is needed, so a server that doesn't know the flag never
 * shows it. */
export const PRIVACY_DRAFT_FLAG = 'cloud.privacy_notice_draft';

export function showsPrivacyDraft(features: Record<string, boolean> | undefined) {
  return features?.[PRIVACY_DRAFT_FLAG] === true;
}

export function PrivacyNoticeDraft() {
  return (
    <section className="cloud-card" aria-labelledby="cloud-privacy-draft-title">
      <p className="cloud-eyebrow">PRIVACY NOTICE (DRAFT)</p>
      <h2 id="cloud-privacy-draft-title">Privacy notice</h2>
      <p role="note"><strong>{DRAFT_BANNER}</strong></p>
      {PRIVACY_NOTICE_DRAFT.map((section) => (
        <div key={section.heading}>
          <h3>{section.heading}</h3>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      ))}
    </section>
  );
}
