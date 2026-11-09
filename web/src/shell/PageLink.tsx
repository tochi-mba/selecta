import { MouseEvent, ReactNode } from 'react';
import { useFlags } from '../flags';
import { navigate, parseRoute } from '../router';
import { routeOn } from './manifest';

/** An ordinary link that doesn't reload the page, so the music keeps going. A link to a page this
 * build doesn't have isn't drawn, and says so in the console: whatever drew it should have asked. */
export function PageLink({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  useFlags();
  if (!routeOn(parseRoute(to.split('?')[0]))) {
    console.error(`A link to ${to} was drawn, but that page is turned off in this build.`);
    return null;
  }
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={follow}>{children}</a>;
}
