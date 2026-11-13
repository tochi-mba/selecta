// A change control that says why it is disabled (D7: "Update payment to make changes" on every
// disabled control after grace, the pilot wording after a pilot ends, "You're offline").

import { ButtonHTMLAttributes, useId } from 'react';
import { Action } from '../../ui/controls';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  reason: string | null;
  run: () => Promise<unknown> | unknown;
  working?: string;
};

export function GuardedAction({ reason, run, working, children, className, ...rest }: Props) {
  const id = useId();
  if (!reason) return <Action {...rest} className={className} run={run} working={working}>{children}</Action>;
  return <span className="hq-guarded">
    <button {...rest} type="button" className={className} disabled aria-describedby={id}>{children}</button>
    <span id={id} className="biz-quiet hq-reason">{reason}</span>
  </span>;
}
