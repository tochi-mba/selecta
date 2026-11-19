/** The SelectaDJ "S". Always decoration: the words beside it (or the page's own heading) carry the
 * name, so a screen reader never hears a lone "S". */
export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark-badge ${className}`.trim()} aria-hidden="true">S</span>;
}
