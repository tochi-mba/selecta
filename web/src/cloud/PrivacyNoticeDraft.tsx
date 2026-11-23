import { Badge, Notice, SettingsCard } from './AccountLayout';
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
    <SettingsCard id="cloud-privacy-draft" className="cloud-prose" title="Privacy notice" badge={<Badge tone="warn">Draft</Badge>}>
      <Notice tone="warn" role="note"><strong>{DRAFT_BANNER}</strong></Notice>
      {PRIVACY_NOTICE_DRAFT.map((section) => (
        <div key={section.heading}>
          <h4>{section.heading}</h4>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      ))}
    </SettingsCard>
  );
}
