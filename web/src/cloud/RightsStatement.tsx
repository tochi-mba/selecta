import { useId } from 'react';
import { Action } from '../ui/controls';
import type { UploadRights } from './uploadConsent';
import './uploadToCloud.css';

// The upload rights statement with "I agree" (`cloud.move_to_cloud`, ADR-0489), shared by the
// Upload to your cloud library sheet and Add music. Shown only while the current wording is not
// confirmed; the caller keeps the answer (`agreeToRights`).

export function RightsStatement({ rights, onAgree, changed = false }: {
  rights: UploadRights;
  onAgree: () => Promise<unknown>;
  /** The wording changed while it was shown, so these are new words to read. */
  changed?: boolean;
}) {
  const headingId = useId();
  if (!rights.statement) return null;
  return (
    <section className="upload-sheet-rights" aria-labelledby={headingId}>
      <h3 id={headingId}>{changed ? 'The statement has changed' : 'Before your first upload'}</h3>
      <blockquote>{rights.statement}</blockquote>
      <Action className="primary" run={onAgree} working="Saving…" failed="SelectaDJ could not save that. Try again.">I agree</Action>
    </section>
  );
}
