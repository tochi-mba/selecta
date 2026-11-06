import { useEffect, useRef, useState } from 'react';
import { MixData, MixItem, post } from '../api';
import { length } from '../lib';
import { Dialog, Status } from '../ui/controls';
import { seamFacts } from '../ui/seam';
import { useMixPath } from './mixScope';

/** Exactly which mix is being saved, what it's still waiting on, and the file once it really exists.
 * If the mix changes while this is going on, it stops rather than saving something else. */
export function ExportPanel(props: {
  mix: MixItem[];
  mixName: string;
  inDraft: boolean;
  guard: Record<string, string>;
  setMixData: (data: MixData) => void;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const { mix, mixName, inDraft, guard, setMixData, names, onClose } = props;
  const at = useMixPath();
  const [going, setGoing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [file, setFile] = useState<{ name: string; seconds: number } | null>(null);
  const order = useRef('');
  const seams = mix.slice(1);
  const ready = seams.filter((item) => item.seam?.state.status === 'ready').length;
  const failed = seams.filter((item) => item.seam?.state.status === 'failed');
  const left = seams.filter((item) => item.seam?.state.status !== 'ready');
  const orderNow = mix.map((item) => item.song_id).join(',');

  const start = async () => {
    setProblem('');
    setFile(null);
    order.current = orderNow;
    setGoing(true);
    try {
      setMixData(await post<MixData>(at('/mix/render'), undefined, guard));
    } catch (error) {
      setGoing(false);
      setProblem((error as Error).message);
    }
  };

  useEffect(() => {
    if (!going || saving) return;
    if (order.current !== orderNow) {
      setGoing(false);
      setProblem('This mix changed while it was getting ready, so nothing was saved. Start again when you’re happy with it.');
      return;
    }
    if (failed.length && failed.length === left.length) {
      setGoing(false);
      setProblem(`${failed.length} transition${failed.length === 1 ? '' : 's'} couldn’t be made. Pick another move for ${failed.length === 1 ? 'it' : 'them'}, then try again.`);
      return;
    }
    if (ready < seams.length) return;
    setSaving(true);
    post<{ name: string; seconds: number }>(at('/mix/export'), undefined, guard)
      .then(setFile)
      .catch((error: Error) => setProblem(error.message))
      .finally(() => {
        setSaving(false);
        setGoing(false);
      });
  }, [going, saving, orderNow, ready, seams.length, failed.length, left.length]);

  return (
    <Dialog title="Save as an audio file" onClose={onClose}>
      <p><b>{mixName}</b> <span className="soft">{inDraft ? 'draft' : 'current mix'}, {mix.length} songs. FLAC.</span></p>
      <p className="hint">{ready} of {seams.length} transitions ready. {left.length ? 'The rest get rendered first.' : 'Everything’s ready.'}</p>
      {!!left.length && (
        <ul className="export-left">
          {left.slice(0, 8).map((item) => {
            const facts = seamFacts(item.seam, names);
            return <li key={item.position}><Status kind={facts.kind}>Into {item.title}: {facts.words}</Status></li>;
          })}
          {left.length > 8 && <li className="hint">and {left.length - 8} more</li>}
        </ul>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {file ? (
        <p className="notice" role="status">Ready, {length(file.seconds)} long: <a href={`/api/exports/${file.name}`} download>download {file.name}</a></p>
      ) : (
        <button className="primary" disabled={going || saving || mix.length < 2} data-working={going || saving || undefined} onClick={() => void start()}>
          {saving ? 'Saving the file…' : going ? `Rendering ${ready} of ${seams.length}…` : 'Save it'}
        </button>
      )}
      <p className="hint">Your original songs aren’t touched.</p>
    </Dialog>
  );
}
