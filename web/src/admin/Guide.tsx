import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../ui/useMediaQuery';
import { AdminFetch, Me } from './adminApi';
import { HELP, PLAYBOOKS, TOURS, TourStep } from './help';
import { AdminPage, adminPath, go } from './route';

// Onboarding and help (doc 07b §7B.8): the help panel, page tours, the first-visit welcome, and
// the command palette. None of them blocks the console; all work by keyboard.

/** The help panel for one page: what it is for, its numbers, how-tos, playbooks, the runbook. */
export function HelpPanel({ page, onClose, onTour, onWelcome }: { page: AdminPage; onClose: () => void; onTour: () => void; onWelcome: () => void }) {
  const help = HELP[page];
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return (
    <aside className="admin-help" aria-label="Help for this page" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="admin-section-head"><h2>Help</h2><button ref={close} type="button" onClick={onClose}>Close help</button></div>
      <p>{help.purpose}</p>
      <h3>What the numbers mean</h3>
      <dl className="admin-facts">{help.numbers.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
      <h3>How do I</h3>
      <dl className="admin-facts">{help.tasks.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
      <h3>Playbooks</h3>
      <ul className="admin-links">{PLAYBOOKS.map((p) => <li key={p.id}><a href={`/admin/${page}?playbook=${p.id}`} onClick={(event) => { event.preventDefault(); go(adminPath(page, [], { playbook: p.id })); onClose(); }}>{p.title}</a></li>)}</ul>
      <div className="admin-actions">
        <button type="button" onClick={onTour}>Replay this page’s tour</button>
        <button type="button" onClick={onWelcome}>Show the welcome again</button>
        <a href={help.runbook} target="_blank" rel="noreferrer">Runbook</a>
      </div>
    </aside>
  );
}

export function PlaybookView({ id, onClose }: { id: string; onClose: () => void }) {
  const book = PLAYBOOKS.find((p) => p.id === id);
  if (!book) return null;
  return (
    <aside className="admin-help" aria-label={`Playbook: ${book.title}`}>
      <div className="admin-section-head"><h2>{book.title}</h2><button type="button" onClick={onClose}>Close</button></div>
      <ol className="admin-steps">{book.steps.map((step) => <li key={step.text}>{step.text} {step.link && <a href={step.link} onClick={(event) => { event.preventDefault(); go(step.link!); }}>Go there</a>}</li>)}</ol>
    </aside>
  );
}

/**
 * A page tour: each step points at a real part of the page (`data-tour`), skipping parts the role
 * can't see. Focus moves to each step; Escape ends it; at phone width a step is a bottom sheet.
 */
export function Tour({ page, can, onDone }: { page: AdminPage; can: (p: string) => boolean; onDone: (finished: boolean) => void }) {
  const steps = useMemo(() => TOURS[page].filter((s: TourStep) => (!s.needs || can(s.needs)) && document.querySelector(`[data-tour="${s.target}"]`)), [page, can]);
  const [at, setAt] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const sheet = useMediaQuery('(max-width: 599px)');
  const card = useRef<HTMLDivElement>(null);
  const step = steps[at];
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'auto' });
    setBox(el?.getBoundingClientRect() ?? null);
    card.current?.focus();
  }, [step]);
  if (!step) return null;
  const last = at === steps.length - 1;
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onDone(false);
    if (event.key === 'ArrowRight' && !last) setAt(at + 1);
    if (event.key === 'ArrowLeft' && at > 0) setAt(at - 1);
  };
  const style = sheet || !box ? undefined : { top: Math.min(window.innerHeight - 220, box.bottom + 8), left: Math.max(16, Math.min(window.innerWidth - 360, box.left)) };
  return (
    <>
      {box && <div className="admin-tour-mark" aria-hidden="true" style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />}
      <div ref={card} className={`admin-tour ${sheet ? 'sheet' : ''}`} style={style} role="dialog" aria-modal="false" aria-labelledby="tour-title" tabIndex={-1} onKeyDown={keys}>
        <p className="admin-soft" aria-live="polite">Step {at + 1} of {steps.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="admin-actions">
          <button type="button" onClick={() => onDone(false)}>End tour</button>
          {at > 0 && <button type="button" onClick={() => setAt(at - 1)}>Back</button>}
          <button type="button" className="primary" onClick={() => (last ? onDone(true) : setAt(at + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </>
  );
}

/** The first visit: what the console is for, the person's roles in plain words, then a choice. */
export function Welcome({ me, onTour, onSkip }: { me: Me; onTour: () => void; onSkip: () => void }) {
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => { skip.current?.focus(); }, []);
  return (
    <section className="admin-welcome" aria-label="Welcome to the staff console">
      <h2>Welcome to the SelectaDJ staff console</h2>
      <p>This is where staff look after the service and its customers. It opens in view mode: nothing changes until you press Make changes, and risky actions ask you to confirm in words.</p>
      {me.roles.map((role) => (
        <div key={`${role.role}${role.scope}`} className="admin-role-card">
          <p><strong>{role.title}</strong>{role.scope !== 'platform:*' ? ` for ${role.scope}` : ''}{role.issued_by ? `, given by ${role.issued_by}` : ''}</p>
          {role.purpose && <p>{role.purpose}</p>}
          {role.cannot && <p className="admin-soft">{role.cannot}</p>}
        </div>
      ))}
      <div className="admin-actions">
        <button type="button" className="primary" onClick={onTour}>Take the tour</button>
        <button ref={skip} type="button" onClick={onSkip}>Skip</button>
      </div>
    </section>
  );
}

type Item = { id: string; label: string; hint: string; run: () => void };

/**
 * The command palette (Ctrl+K or Cmd+K): pages, playbooks and records by pasted id. It only ever
 * opens places; it never runs a change, so nothing can be done by accident from here.
 */
export function Palette({ api, pages, onClose, onPlaybook }: { api: AdminFetch; pages: { id: AdminPage; label: string }[]; onClose: () => void; onPlaybook: (id: string) => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Item[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const base: Item[] = useMemo(() => [
    ...pages.map((p) => ({ id: `page-${p.id}`, label: `Go to ${p.label}`, hint: 'Page', run: () => go(adminPath(p.id)) })),
    ...PLAYBOOKS.map((p) => ({ id: `book-${p.id}`, label: `How do I: ${p.title.toLowerCase()}`, hint: 'Playbook', run: () => onPlaybook(p.id) })),
  ], [pages, onPlaybook]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 4) { setFound([]); return; }
    const timer = window.setTimeout(() => {
      api<{ results: { kind: string; id: string; label: string }[] }>(`/admin/lookup?q=${encodeURIComponent(q)}`).then((answer) => {
        setFound(answer.results.map((r) => ({ id: `${r.kind}-${r.id}`, label: r.label, hint: r.kind === 'customer' ? 'Customer' : r.kind === 'job' ? 'Job' : 'Audit',
          run: () => go(r.kind === 'customer' ? adminPath('customers', [r.id]) : r.kind === 'job' ? adminPath('jobs', [r.id]) : adminPath('security', ['audit'], { request: r.id })) })));
      }).catch(() => setFound([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, api]);
  const items = [...found, ...base.filter((item) => item.label.toLowerCase().includes(text.trim().toLowerCase()))].slice(0, 12);
  const pick = (item: Item | undefined) => { if (!item) return; onClose(); item.run(); };
  return (
    <div className="admin-dialog-backdrop" onClick={onClose}>
      <div className="admin-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'ArrowDown') { event.preventDefault(); setAt(Math.min(items.length - 1, at + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setAt(Math.max(0, at - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); pick(items[at]); }
        }}>
        <input ref={input} value={text} onChange={(event) => { setText(event.target.value); setAt(0); }} placeholder="Go to a page, paste an email or id, or ask How do I" aria-label="Search the console" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[at]?.id} />
        <ul id="palette-list" role="listbox">
          {items.map((item, i) => <li key={item.id} id={item.id} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => pick(item)}><span>{item.label}</span><small>{item.hint}</small></li>)}
          {!items.length && <li className="admin-soft">Nothing matches. Paste a full email or id to find a record.</li>}
        </ul>
        <p className="admin-soft">The palette opens places; changes are made on the record itself.</p>
      </div>
    </div>
  );
}
