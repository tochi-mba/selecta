import { createContext, useContext } from 'react';

/** Which draft this part of the page is editing, or null for the current mix. */
export const MixScope = createContext<number | null>(null);

/** The same routes work on any mix: this adds which one. */
export function scoped(path: string, draft: number | null): string {
  if (draft === null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}draft=${draft}`;
}

export function useMixPath(): (path: string) => string {
  const draft = useContext(MixScope);
  return (path) => scoped(path, draft);
}
