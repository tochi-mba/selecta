import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, problemKind } from '../api';
import { lucy } from './client';
import { EMPTY_VIEW, LucyView, reduce, summarize } from './reducer';
import { EVENT_VERSION, openStream, StreamState } from './stream';
import type { LucyEvent, Revision } from './types';

/** One open conversation: its snapshot, the live events after it, and the current revision. Events
 * are held for at most one animation frame and then applied together, in order, so a fast reply is
 * one React update per frame rather than one per word. */

export type LoadState = { state: 'idle' | 'loading' | 'ready' | 'missing' | 'failed'; message: string };

export type Conversation = {
  view: LucyView;
  revision: Revision | null;
  load: LoadState;
  stream: StreamState | null;
  /** Read the snapshot again, then carry on from its cursor. */
  reload: () => void;
  /** A revision the page itself just made current. */
  adopt: (revision: Revision) => void;
};

const RETRY_AFTER_MS = 4000;
const READINESS_SETTLE_MS = 800;

export function useConversation(id: string | null, onSummary: (words: string[]) => void): Conversation {
  const [view, dispatch] = useReducer(reduce, EMPTY_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [revision, setRevision] = useState<Revision | null>(null);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const [load, setLoad] = useState<LoadState>({ state: id ? 'loading' : 'idle', message: '' });
  const [stream, setStream] = useState<StreamState | null>(null);
  const [epoch, setEpoch] = useState(0);
  const said = useRef(onSummary);
  said.current = onSummary;

  const buffer = useRef<LucyEvent[]>([]);
  const scheduled = useRef<{ frame: number; timer: number } | null>(null);
  const cancelFlush = () => {
    const pending = scheduled.current;
    if (!pending) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pending.frame);
    window.clearTimeout(pending.timer);
    scheduled.current = null;
  };
  const flush = useCallback(() => {
    cancelFlush();
    const events = buffer.current;
    buffer.current = [];
    if (!events.length) return;
    dispatch({ type: 'events', events });
    const words = summarize(events);
    if (words.length) said.current(words);
  }, []);
  const queue = useCallback((events: LucyEvent[]) => {
    buffer.current.push(...events);
    if (scheduled.current) return;
    // a hidden tab doesn't draw frames, so a timer makes sure the events still land
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : 0;
    scheduled.current = { frame, timer: window.setTimeout(flush, 250) };
  }, [flush]);

  const shownId = useRef<string | null>(null);
  useEffect(() => {
    cancelFlush();
    buffer.current = [];
    if (shownId.current !== id) {
      shownId.current = id;
      dispatch({ type: 'reset' });
      setRevision(null);
    }
    if (!id) {
      setLoad({ state: 'idle', message: '' });
      setStream(null);
      return;
    }
    let live = true;
    let close: (() => void) | null = null;
    let retry: number | undefined;
    if (!viewRef.current.loaded) setLoad({ state: 'loading', message: '' });
    lucy.conversation(id)
      .then((snapshot) => {
        if (!live) return;
        dispatch({ type: 'snapshot', snapshot });
        setRevision(snapshot.proposal?.current ?? null);
        setLoad({ state: 'ready', message: '' });
        if (typeof snapshot.event_schema === 'number' && snapshot.event_schema !== EVENT_VERSION) {
          // a newer server whose updates this page can't read: what's shown stays true until a reload
          setStream('refused');
          return;
        }
        close = openStream(id, snapshot.cursor, queue, (state) => {
          if (!live) return;
          setStream(state);
          if (state === 'resync') {
            flush();
            setEpoch((value) => value + 1);
          }
        });
      })
      .catch((error: Error) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 404) {
          setLoad({ state: 'missing', message: error.message });
          return;
        }
        if (viewRef.current.loaded) {
          // keep what's on screen, say it may be behind, and try again shortly
          setStream('reconnecting');
          retry = window.setTimeout(() => setEpoch((value) => value + 1), RETRY_AFTER_MS);
          return;
        }
        setLoad({ state: 'failed', message: problemKind(error) === 'offline' ? '' : error.message });
      });
    return () => {
      live = false;
      window.clearTimeout(retry);
      close?.();
    };
  }, [id, epoch, queue, flush]);

  useEffect(() => () => cancelFlush(), []);

  // The current revision, read again whenever the server says it changed. Older ones are left alone.
  const readTick = useRef(-1);
  const current = view.proposal?.currentId ?? null;
  useEffect(() => {
    if (!current) {
      if (view.loaded) setRevision(null);
      return;
    }
    if (revisionRef.current?.id === current && readTick.current === view.revisionTick) return;
    if (revisionRef.current?.id === current && readTick.current === -1) {
      readTick.current = view.revisionTick;
      return;
    }
    readTick.current = view.revisionTick;
    let live = true;
    lucy.revision(current)
      .then((next) => {
        if (live && viewRef.current.proposal?.currentId === next.id) setRevision(next);
      })
      .catch(() => { /* what's shown stays; the next change reads it again */ });
    return () => { live = false; };
  }, [current, view.revisionTick, view.loaded]);

  // Render jobs moving on can change which transitions are ready, so readiness is checked again.
  useEffect(() => {
    const shown = revisionRef.current;
    if (!view.readinessTick || !shown) return;
    const timer = window.setTimeout(() => {
      lucy.readiness(shown.id)
        .then((ledger) => setRevision((was) => (was && was.id === shown.id ? { ...was, ledger } : was)))
        .catch(() => {});
    }, READINESS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [view.readinessTick]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  const adopt = useCallback((next: Revision) => {
    readTick.current = viewRef.current.revisionTick;
    setRevision(next);
    dispatch({ type: 'current', revision: next });
  }, []);

  return { view, revision, load, stream, reload, adopt };
}
