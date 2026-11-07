import { PageLink } from '../shell/Shell';

/** A real Listen state for a library that has no current mix yet. */
export function ListenEmpty() {
  return (
    <main className="page listen-empty" id="main">
      <p className="eyebrow">Listen</p>
      <h1 className="display">Nothing is lined up yet.</h1>
      <p className="lede">
        Pick a mix in Explore, or start one from a song in your Library. Selecta waits for you before it plays anything.
      </p>
      <div className="row wrap">
        <PageLink className="button primary big" to="/mixes">Explore mixes</PageLink>
        <PageLink className="button" to="/library">Choose a song</PageLink>
      </div>
    </main>
  );
}
