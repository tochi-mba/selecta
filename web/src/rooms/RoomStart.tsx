import { FormEvent, useState } from 'react';
import { Action } from '../ui/controls';
import { ELLIPSIS } from '../ui/format';
import { Icon, type IconName } from '../ui/Icon';

// No room yet: what a room is in one line, the one thing to do (name it, Open room), and the
// three things a host wants to know before sharing a code with a room full of people.

const POINTS: { icon: IconName; title: string; words: string }[] = [
  { icon: 'users', title: 'Guests join in seconds', words: 'They scan a QR code. No app, no account.' },
  { icon: 'request', title: 'They ask, you play', words: 'Guests pick from your library. Nothing plays on their phones.' },
  { icon: 'lock', title: 'You stay in charge', words: 'Approve requests, set limits, remove anyone.' },
];

export function RoomStart({ open, offline }: { open: (name: string) => Promise<unknown>; offline: string }) {
  const [name, setName] = useState('');
  const go = () => open(name.trim() || 'Party');
  return (
    <section className="room-panel room-start" aria-labelledby="room-title">
      <div className="room-card room-start-card">
        <div className="room-start-main">
          <p className="room-eyebrow">Request room</p>
          <h2 id="room-title">Let your guests pick the music</h2>
          <p className="room-lede">Open a room, share the code, and add the songs they ask for to your mix.</p>
          {/* one field, so Enter still sends the form; the button is an Action so it shows that it is busy */}
          <form onSubmit={(event: FormEvent) => { event.preventDefault(); void go(); }} className="room-open">
            <label htmlFor="room-name">Room name</label>
            <div className="room-open-row">
              <input id="room-name" value={name} maxLength={40} placeholder="Party" autoComplete="off" aria-describedby="room-name-help" onChange={(event) => setName(event.target.value)} />
              <fieldset className="offline-fieldset" disabled={!!offline}><Action type="button" className="primary" run={go} working={`Opening${ELLIPSIS}`}>Open room</Action></fieldset>
            </div>
            <p className="room-help" id="room-name-help">Guests see this name when they join.</p>
          </form>
          {offline && <p className="needs-connection">{offline}</p>}
        </div>
        <ul className="room-points">
          {POINTS.map((point) => (
            <li key={point.title}>
              <span className="room-point-mark" aria-hidden="true"><Icon name={point.icon} /></span>
              <span><b>{point.title}</b><span>{point.words}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
