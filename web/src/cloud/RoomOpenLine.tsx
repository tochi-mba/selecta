import { navigate } from '../router';
import { roomLine, type RoomSession } from '../rooms/useRoomSession';
import { countOf } from '../ui/format';

/** The open room in the top bar (flag `rooms`): one compact live line that opens Rooms. Kept out
 * of CloudShell.tsx so the shell stays under the file-length cap. */
export function RoomOpenLine({ room, path, waiting, add }: {
  room: RoomSession;
  /** Rooms' own address in More. */
  path: string;
  /** Requests waiting for the host's approval. */
  waiting: number;
  /** What the Requests list can add now, what is still on its way, and what waits on a device. */
  add: { ready: number; onTheWay: number; onDevice: number };
}) {
  return (
    <a className="room-open-line" role="status" data-testid="room-open-line" href={path} title={`${roomLine(room)}. Open Rooms.`} onClick={(event) => { event.preventDefault(); navigate(path); }}>
      <b>{roomLine(room)}</b>
      <span>{countOf(room.guestsHere, 'guest')} here</span>
      {waiting > 0 && <span className="room-open-waiting">{countOf(waiting, 'request')} to approve</span>}
      {add.ready > 0 && <span className="room-open-waiting">{countOf(add.ready, 'request')} to add</span>}
      {add.onTheWay > 0 && <span className="room-open-waiting">{countOf(add.onTheWay, 'request')} on the way</span>}
      {add.onDevice > 0 && <span className="room-open-waiting" data-testid="room-on-device" title={`${countOf(add.onDevice, 'request')} waiting on another device`}>{add.onDevice} waiting on a device</span>}
    </a>
  );
}
