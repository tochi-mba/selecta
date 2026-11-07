import { MouseEvent, ReactNode } from 'react';
import { navigate } from '../router';

/** An ordinary link that doesn't reload the page, so the music keeps going. */
export function PageLink({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={follow}>{children}</a>;
}
