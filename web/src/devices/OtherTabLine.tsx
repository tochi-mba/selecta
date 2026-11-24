// ADR-0475 F: this browser is the speaker, and another of its tabs makes the sound. One quiet
// line, and the press that moves the sound here (the other tab stops first).
export function OtherTabLine({ onPlayHere, gone = false }: { onPlayHere: () => void; gone?: boolean }) {
  // `gone`: that tab closed; this one carries on from where the music was, with a press here
  return (
    <p className="asked-to-play" role="status" data-testid="other-tab" data-gone={gone || undefined}>
      <span className="asked-to-play-words">{gone ? 'The tab that was playing closed.' : 'Playing in another tab.'}</span>
      <button type="button" className={gone ? 'primary' : undefined} onClick={onPlayHere}>{gone ? 'Carry on here' : 'Play in this tab instead'}</button>
    </p>
  );
}
