import { CurrentMix, NoCurrentMix } from './CurrentMix';
import { Drafts } from './Drafts';
import { ViewProps } from './shared';

/** The permanent home for your own work: the one mix that's current, kept apart from the drafts you're
 * working on, and the order Selecta is preparing their audio in. */
export function MyMixes({ mix, mixName, now, player, setView, notify, openDraft, playDraft }: ViewProps) {
  return (
    <main className="page mixes my-mixes" id="main">
      <h1 className="display small">My Mixes</h1>
      {mix.length > 0
        ? <CurrentMix prominent mix={mix} mixName={mixName} now={now} player={player} setView={setView} />
        : <NoCurrentMix />}
      <Drafts notify={notify} openDraft={openDraft} playDraft={playDraft} setView={setView} />
    </main>
  );
}
