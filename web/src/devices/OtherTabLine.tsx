// ADR-0475 F: this browser is the speaker, and another of its tabs makes the sound. One quiet
// line, and the press that moves the sound here (the other tab stops first).
export function OtherTabLine({ onPlayHere }: { onPlayHere: () => void }) {
  return (
    <p className="asked-to-play" role="status" data-testid="other-tab">
      <span className="asked-to-play-words">Playing in another tab.</span>
      <button type="button" onClick={onPlayHere}>Play in this tab instead</button>
    </p>
  );
}
