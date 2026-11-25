import { backWords, leftWords, lineWords, stateWords, usageLines, useLucyUsageNews, whenWords, type LucyUsageLine, type LucyWindows } from '../cloud/lucyUsage';
import { Icon } from '../ui/Icon';
import { Meter, type MeterTone } from '../ui/Meter';
import '../styles/lucy.css';

/** The full Lucy usage meter (ADR-0484 rules 3 and 4): "This session" and "This week", each a bar
 * of what is left with when it comes back, in words. Free, Standard and Premium see the same
 * layout. Only the share left is ever shown, never what is counted behind it. */

/** Here a full bar is good news, the other way round from storage, so the tone is said outright. */
const TONE: Record<LucyUsageLine['window']['state'], MeterTone> = { ok: 'neutral', near: 'warning', spent: 'danger' };

function UsageLine({ line }: { line: LucyUsageLine }) {
  const { window: share, kind, name } = line;
  const state = stateWords(share.state);
  const back = backWords(share, kind);
  return (
    <div className="lucy-usage-line" data-state={share.state}>
      <p className="lucy-usage-words">
        <b>{name}</b>
        <span className="lucy-usage-figure">{leftWords(share)}{back ? <span className="soft"> · {back}</span> : null}</span>
      </p>
      <Meter kind="meter" label={name} showLabel={false} value={share.left} max={100} valueText={lineWords(share, kind)} tone={TONE[share.state]} />
      {/* warning and failed are one colour in the design system: the mark and the words tell them apart */}
      {share.state === 'near' && <p className="lucy-usage-state"><Icon name="warning" size="compact" /> {state}</p>}
      {share.state === 'spent' && <p className="lucy-usage-state"><Icon name="minus" size="compact" /> {state}</p>}
    </div>
  );
}

export function LucyUsageMeter({ windows, className = '' }: { windows: LucyWindows; className?: string }) {
  useLucyUsageNews(windows);
  const until = windows.session ? whenWords(windows.session.back_words) : '';
  return (
    <div className={`lucy-usage ${className}`.trim()}>
      {usageLines(windows).map((line) => <UsageLine key={line.kind} line={line} />)}
      {windows.lighter && (
        <p className="lucy-usage-note" role="note">
          A lighter Lucy is answering until this session ends{until ? ` ${until}` : ''}. After that Lucy is back to normal.
        </p>
      )}
      {windows.extra && (
        <p className="lucy-usage-words lucy-usage-extra">
          <b>Extra usage</b>
          <span className="lucy-usage-figure">{`${windows.extra.left}% left`}</span>
        </p>
      )}
    </div>
  );
}
