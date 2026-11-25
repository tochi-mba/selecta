import { BlendArt } from '../cloud/BlendArt';
import { PageLink } from '../shell/Shell';
import { useFeelPart } from './feelBits';

/** Listen keeps its own route and purpose even before a mix exists. */
export function ListenEmpty() {
  // ADR-0477: with depth on, the empty deck shows the hand-over drawing at rest, lit under the mouse;
  // it is decoration, and the words and the one primary action say what to do
  const deck = useFeelPart('depth');
  return (
    <main className="page listen-empty" id="main">
      <p className="eyebrow">Listen</p>
      <h1 className="display">Nothing is lined up yet.</h1>
      <p className="lede">Pick a mix in Explore, or start one from a song in your Library. SelectaDJ waits for you before it plays anything.</p>
      {deck && <div className="listen-empty-deck" data-glow=""><BlendArt variant="blend" /></div>}
      <div className="row wrap">
        <PageLink className="button primary big" to="/mixes">Explore mixes</PageLink>
        <PageLink className="button" to="/library">Choose a song</PageLink>
      </div>
    </main>
  );
}
