import { KeyboardEvent, ReactNode, RefObject, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from '../feel/root';
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
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const morph = moving && running && !sending && !value.trim();
  // Send springs back in only when it returns from Stop, never on an ordinary redraw: each return
  // gives it a new key, so its one arrival plays once and is not cut short by the next keystroke
  const wasMorph = useRef(false);
  const returns = useRef(0);
  if (wasMorph.current && !morph) returns.current += 1;
  useEffect(() => { wasMorph.current = morph; });
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
          {/* Stop springs in when real work starts. With the feel's motion on and nothing written,
              Send could do nothing anyway, so Stop takes its place and its weight (the send morphs
              into stop); as soon as there are words to send, Send is back beside Stop, because a new
              message can still replace the running one. With the motion off both stay, as before. */}
          {running && <Action type="button" className={morph ? 'primary feel-pop lucy-stop' : 'feel-pop'} working="Stopping…" run={onStop}><Icon name="stop" /> Stop</Action>}
          {!morph && <button key={returns.current} type="submit" className={`primary${returns.current ? ' feel-pop' : ''}`} disabled={!canSend} aria-busy={sending || undefined}>{sending ? 'Sending…' : 'Send'}</button>}
        </div>
      </div>
    </form>
  );
}
