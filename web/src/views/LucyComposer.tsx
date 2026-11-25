import { KeyboardEvent, ReactNode, RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { lucyTransport } from '../lucy/client';
import { Action } from '../ui/controls';
import { Icon } from '../ui/Icon';

/** Where you write to Lucy. Enter sends and Shift+Enter starts a new line. While Lucy is working,
 * Stop is right there. Voice input, where the browser has it and it's turned on, only ever puts words
 * into the box to be read and edited: it never sends, and never touches the music. */

const MAX_HEIGHT = 220;
/** Local Lucy lets a new message replace the running one; Cloud answers one at a time on every
 * device (ADR-0476 item 16), so there the words wait for the answer to finish. */
const RUNNING_WORDS = () => (lucyTransport()
  ? 'Lucy is answering. Send this when she’s done, or press Stop.'
  : 'Lucy is working. Sending now replaces what it’s doing.');

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionClass = new () => Recognition;

export function speechRecognition(): RecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const found = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null;
}

const VOICE_PROBLEMS: Record<string, string> = {
  'not-allowed': 'The microphone isn’t allowed in this browser. You can type instead.',
  'service-not-allowed': 'This browser won’t do voice input here. You can type instead.',
  'audio-capture': 'No microphone was found. You can type instead.',
  'no-speech': 'Didn’t hear anything. Try again, or type instead.',
  network: 'Voice input needs a connection this browser couldn’t make. You can type instead.',
};

function VoiceButton({ onWords }: { onWords: (words: string) => void }) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const said = useRef(onWords);
  said.current = onWords;
  useEffect(() => () => recognition.current?.abort(), []);
  const toggle = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Speech = speechRecognition();
    if (!Speech) return;
    setProblem('');
    try {
      const heard = new Speech();
      heard.lang = document.documentElement.lang || navigator.language || 'en';
      heard.interimResults = false;
      heard.continuous = false;
      heard.onresult = (event) => {
        let words = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          if (event.results[index].isFinal) words += event.results[index][0].transcript;
        }
        if (words.trim()) said.current(words.trim());
      };
      heard.onerror = (event) => setProblem(VOICE_PROBLEMS[event.error] ?? 'Voice input stopped. You can type instead.');
      heard.onend = () => {
        setListening(false);
        recognition.current = null;
      };
      recognition.current = heard;
      heard.start();
      setListening(true);
    } catch {
      setListening(false);
      setProblem('Voice input couldn’t start. You can type instead.');
    }
  };
  return (
    <>
      <button type="button" className="lucy-mic" aria-pressed={listening} onClick={toggle} title={listening ? 'Stop listening' : 'Speak instead of typing'}>
        <Icon name={listening ? 'stop' : 'mic'} />
        <span className="visually-hidden">{listening ? 'Stop voice input' : 'Voice input'}</span>
      </button>
      {listening && <span className="lucy-listening" role="status">Listening…</span>}
      {problem && <span className="lucy-voice-problem hint" role="status">{problem}</span>}
    </>
  );
}

export function Composer({ value, onChange, onSend, onStop, running, sending, blocked, problem = '', voice, above, boxRef }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => Promise<void>;
  running: boolean;
  sending: boolean;
  /** Why nothing can be sent right now, if it can't. */
  blocked: string;
  /** Why the last message wasn't sent. Said here, beside the words that came back, because the
   * copy in the conversation can be a long way above whoever is looking at the box. */
  problem?: string;
  voice: boolean;
  above?: ReactNode;
  boxRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const hintId = useId();
  const latest = useRef(value);
  latest.current = value;
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight + 2, MAX_HEIGHT)}px`;
  }, [value, boxRef]);
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!blocked && !sending && value.trim()) onSend();
  };
  const canSend = !blocked && !sending && !!value.trim();
  return (
    <form className="lucy-composer" onSubmit={(event) => {
      event.preventDefault();
      if (!canSend) return;
      // Send is disabled the moment the box empties, and a disabled button drops the keyboard's
      // focus to the top of the page: someone who pressed Send itself goes back to the box
      if (document.activeElement instanceof HTMLButtonElement && document.activeElement.type === 'submit') boxRef.current?.focus({ preventScroll: true });
      onSend();
    }}>
      {above}
      <label className="visually-hidden" htmlFor={`${hintId}-box`}>Message to Lucy</label>
      <textarea
        id={`${hintId}-box`}
        ref={boxRef}
        rows={1}
        value={value}
        placeholder={blocked ? '' : 'Describe a mix, or ask Lucy to change this one'}
        aria-describedby={problem ? `${hintId}-problem ${hintId}` : hintId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys}
      />
      {problem && <p id={`${hintId}-problem`} className="warn lucy-send-problem">{problem}</p>}
      <div className="lucy-composer-row">
        <span id={hintId} className="hint">{blocked || (running ? RUNNING_WORDS() : 'Enter sends · Shift+Enter for a new line')}</span>
        <div className="row">
          {voice && <VoiceButton onWords={(words) => onChange(latest.current.trim() ? `${latest.current.trimEnd()} ${words}` : words)} />}
          {/* Stop springs in beside Send when real work starts; Send stays, because a new message
              can replace the running one, so the two never become one button */}
          {running && <Action type="button" className="feel-pop" working="Stopping…" run={onStop}><Icon name="stop" /> Stop</Action>}
          <button type="submit" className="primary" disabled={!canSend} aria-busy={sending || undefined}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </form>
  );
}
