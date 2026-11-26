import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { countOf } from '../ui/format';

/** The kinds of notice above a Cloud page, most pressing first. */
export const NOTICE_GROUPS = ['blocking', 'playback', 'progress', 'info'] as const;
export type NoticeGroup = (typeof NOTICE_GROUPS)[number];
export type NoticeGroups = Partial<Record<NoticeGroup, ReactNode>>;

/** cloud.page_layout: the notices above a Cloud page, one open at a time.
 *
 * Each notice stays a direct child of the shell's banner stack, so it keeps its own look; hidden
 * marks say which group the notices after them belong to. The first notice of the most pressing
 * group is open (`data-notice-expanded`), progress chips share one row, and the rest fold behind
 * one "2 more notes" button. A notice component decides for itself whether it draws anything, so
 * the stack reads what was really drawn, after every change, rather than guessing from props. */
export function NoticeStack(groups: NoticeGroups) {
  const first = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [folded, setFolded] = useState(0);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const box = first.current?.parentElement;
    if (!box) return undefined;
    const arrange = () => {
      let group: string | null = null;
      let expanded = false;
      let count = 0;
      for (const child of Array.from(box.children) as HTMLElement[]) {
        const mark = child.dataset.noticeMark;
        if (mark) { group = mark === 'end' ? null : mark; continue; }
        if (!group || child === more.current) continue;
        delete child.dataset.noticeExpanded;
        delete child.dataset.noticeFolded;
        delete child.dataset.noticeChip;
        if (child.hidden) continue;
        if (group === 'progress') child.dataset.noticeChip = '';
        else if (!expanded) { child.dataset.noticeExpanded = ''; expanded = true; }
        else { child.dataset.noticeFolded = ''; count += 1; }
      }
      setFolded(count);
    };
    arrange();
    // what a notice draws changes without this component rendering again
    const watch = new MutationObserver(arrange);
    watch.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => { if (folded === 0) setOpen(false); }, [folded]);
  const mark = (group: NoticeGroup | 'end') => <i hidden data-notice-mark={group} ref={group === 'blocking' ? first : undefined} />;
  return (
    <>
      {mark('blocking')}{groups.blocking}
      {mark('playback')}{groups.playback}
      {mark('progress')}{groups.progress}
      {mark('info')}{groups.info}
      {folded > 0 && (
        <button ref={more} type="button" className="notice-more" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          {open ? `Hide ${countOf(folded, 'note')}` : countOf(folded, 'more note')}
        </button>
      )}
      {mark('end')}
      {/* the count is said when it changes, whether or not the button has focus */}
      <span className="visually-hidden notice-live" role="status">{folded > 0 && !open ? countOf(folded, 'more note') : ''}</span>
    </>
  );
}

