// BigAction (ADR-0453 D5, D10): the S4 touch target. 64 px tall (`--control-height-big`) with
// 12 px (`--space-3`) between neighbours in the deck, so a wet thumb cannot hit two. Built on the
// existing Action, so it shows it is working and cannot be pressed twice.

import type { ComponentProps, ReactNode } from 'react';
import { Action } from '../../ui/controls';
import './staff.css';

export type BigActionProps = Omit<ComponentProps<typeof Action>, 'disabled'> & {
  /** The reason it cannot be pressed, said in its title and accessible description. */
  disabled?: string | null;
  /** Small words under the label (a count, a time). */
  detail?: ReactNode;
  /** false renders the ordinary 44 px size (used where a BigAction sits in a manager page). */
  big?: boolean;
  pressed?: boolean;
};

export function BigAction({ disabled, detail, big = true, pressed, className = '', children, ...rest }: BigActionProps) {
  return (
    <Action
      {...rest}
      className={`${big ? 'biz-big-action' : 'biz-button'} ${className}`.trim()}
      disabled={Boolean(disabled)}
      title={disabled ?? rest.title}
      aria-pressed={pressed}
      data-big={big || undefined}
    >
      <span className="biz-big-label">{children}</span>
      {detail != null && <span className="biz-big-detail">{detail}</span>}
      {disabled && <span className="visually-hidden">. {disabled}</span>}
    </Action>
  );
}
