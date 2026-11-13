import { PageLink } from '../shell/Shell';

/** Listen keeps its own route and purpose even before a mix exists. */
export function ListenEmpty() {
  return (
    <main className="page listen-empty" id="main">
      <p className="eyebrow">Listen</p>
      <h1 className="display">Nothing is lined up yet.</h1>
      <p className="lede">Pick a mix in Explore, or start one from a song in your Library. SelectaDJ waits for you before it plays anything.</p>
      <div className="row wrap">
        <PageLink className="button primary big" to="/mixes">Explore mixes</PageLink>
        <PageLink className="button" to="/library">Choose a song</PageLink>
      </div>
    </main>
  );
}
