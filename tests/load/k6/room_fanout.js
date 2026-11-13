// Rooms SSE fan-out at L3 with k6 (SC-0407-04, SC-0416-06; docs/saas/15-stress-testing.md
// section 15.5 "Rooms": 500 rooms open at once with 100 guests each, SSE fan-out within targets).
// The k6 twin of tests/load/room_fanout.py, for runs bigger than one Python process can hold.
//
// Each room belongs to one Premium host (HOSTS: one host token per line, one room per token).
// LISTENERS streams per room hold the host workspace's `GET /api/events` open, the stream every
// room change travels over (rooms/cloud_ports.py). Each host then locks and unlocks its room
// ACTIONS times on a fixed timetable (one change every INTERVAL_S seconds, rooms staggered across
// the interval), each change a `room.updated` frame.
//
// k6 VUs share no memory, so listeners can't see when a host's request left. Instead every
// change has a scheduled moment, known to all VUs from setup(); a listener times each frame from
// the moment its change was due. A host that sends late only makes fan-out look slower, never
// faster, and `room_host_lateness_ms` shows how late hosts were. Run from one machine, or keep
// the generators' clocks in NTP sync.
//
// Targets, pass/fail through the thresholds (k6 exits non-zero when one is missed):
//   - fan-out p99 under 1 s ("pages update within a second of real changes", ADR-0407);
//   - no dropped and no out-of-order events ("no missed SSE event", 15-stress-testing.md);
//   - every host change and every stream accepted.
//
// Staging only, never production, with the xk6-sse extension (pin the versions you verify):
//   xk6 build --with github.com/phymbert/xk6-sse --output ./k6
//   ./k6 run -e BASE_URL=https://api.staging.example -e HOSTS=hosts.txt tests/load/k6/room_fanout.js
// Smaller: -e ROOMS=50 -e LISTENERS=20. `python infra/staging/run.py room-fanout-k6` runs it.
// 50,000 streams need several load generators or a large one (raise its open-file limit).
import http from 'k6/http';
import sse from 'k6/x/sse';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Set BASE_URL to a staging origin');
if (!/staging|localhost|127\.0\.0\.1/.test(BASE)) throw new Error(`Refusing ${BASE}: staging only`);
const ROOMS = Number(__ENV.ROOMS || 500);
const LISTENERS = Number(__ENV.LISTENERS || 100); // the Premium room cap (billing/plans.py)
const ACTIONS = Number(__ENV.ACTIONS || 20);
const INTERVAL_S = Number(__ENV.INTERVAL_S || 5);
const CONNECT_S = Number(__ENV.CONNECT_S || 90); // time for every stream to open first
const GRACE_S = 10; // how long a listener waits for the last frame after it was due

const hosts = new SharedArray('hosts', () =>
  open(__ENV.HOSTS || 'hosts.txt').split('\n').map((line) => line.trim()).filter(Boolean),
);
if (hosts.length < ROOMS) throw new Error(`HOSTS has ${hosts.length} tokens; ROOMS needs ${ROOMS}`);

const fanout = new Trend('room_fanout_ms', true);
const lateness = new Trend('room_host_lateness_ms', true);
const dropped = new Counter('room_fanout_dropped');
const outOfOrder = new Counter('room_fanout_out_of_order');
const hostFailed = new Counter('room_host_change_failed');
const streamOpened = new Rate('room_stream_opened');

const LISTEN_S = CONNECT_S + ACTIONS * INTERVAL_S + INTERVAL_S + GRACE_S;

export const options = {
  setupTimeout: '10m',
  teardownTimeout: '10m',
  scenarios: {
    listeners: {
      executor: 'per-vu-iterations',
      exec: 'listen',
      vus: ROOMS * LISTENERS,
      iterations: 1,
      maxDuration: `${LISTEN_S + 60}s`,
    },
    hosts: {
      executor: 'per-vu-iterations',
      exec: 'drive',
      vus: ROOMS,
      iterations: 1,
      maxDuration: `${LISTEN_S + 60}s`,
    },
  },
  thresholds: {
    room_fanout_ms: ['p(99)<1000'],
    room_fanout_dropped: ['count==0'],
    room_fanout_out_of_order: ['count==0'],
    room_host_change_failed: ['count==0'],
    room_stream_opened: ['rate==1'],
  },
};

function auth(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

function roomOf(answer) {
  const body = answer.json();
  const room = body.room || body;
  return room.room || room;
}

export function setup() {
  const rooms = [];
  for (let index = 0; index < ROOMS; index += 1) {
    const token = hosts[index];
    let made = http.post(`${BASE}/api/rooms`, JSON.stringify({ name: `Load room ${index}` }), auth(token));
    if (made.status === 409) made = http.get(`${BASE}/api/rooms/current`, auth(token));
    if (made.status !== 200 && made.status !== 201) {
      throw new Error(`Host ${index} could not open a room (${made.status})`);
    }
    const room = roomOf(made);
    if (room.status === 'locked') http.post(`${BASE}/api/rooms/${room.id}/unlock`, null, auth(token));
    rooms.push(room.id);
  }
  return { rooms, startAt: Date.now() + CONNECT_S * 1000 };
}

// When room `room`'s change `k` is due: rooms are spread across one interval so the API sees a
// steady rate (ROOMS / INTERVAL_S changes a second), not 500 at once.
function dueAt(data, room, k) {
  return data.startAt + k * INTERVAL_S * 1000 + Math.floor((room / ROOMS) * INTERVAL_S * 1000);
}

function statusFor(k) {
  return k % 2 === 0 ? 'locked' : 'open';
}

export function drive(data) {
  const room = (__VU - 1) % ROOMS;
  const token = hosts[room];
  const roomId = data.rooms[room];
  for (let k = 0; k < ACTIONS; k += 1) {
    const wait = dueAt(data, room, k) - Date.now();
    if (wait > 0) sleep(wait / 1000);
    lateness.add(Math.max(0, Date.now() - dueAt(data, room, k)));
    const verb = statusFor(k) === 'locked' ? 'lock' : 'unlock';
    const answer = http.post(`${BASE}/api/rooms/${roomId}/${verb}`, null, {
      ...auth(token),
      tags: { name: 'POST /api/rooms/{id}/lock|unlock' },
    });
    if (answer.status !== 200) hostFailed.add(1);
  }
}

export function listen(data) {
  const index = __VU - 1;
  const room = index % ROOMS;
  const roomId = data.rooms[room];
  let next = 0; // the change this listener expects next
  const response = sse.open(
    `${BASE}/api/events`,
    {
      headers: { Authorization: `Bearer ${hosts[room]}`, Accept: 'text/event-stream' },
      tags: { name: 'GET /api/events' },
    },
    (client) => {
      client.on('event', (event) => {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch (_error) {
          return; // a heartbeat or a frame that isn't ours
        }
        const payload = frame.payload || {};
        if (frame.topic !== 'room.updated' || payload.room_id !== roomId || !('status' in payload)) return;
        if (next >= ACTIONS) return;
        if (payload.status !== statusFor(next)) outOfOrder.add(1);
        fanout.add(Date.now() - dueAt(data, room, next));
        next += 1;
        if (next >= ACTIONS) client.close();
      });
      client.on('error', () => client.close());
      const until = dueAt(data, room, ACTIONS - 1) + GRACE_S * 1000 - Date.now();
      setTimeout(() => client.close(), Math.max(1000, until));
    },
  );
  const opened = Boolean(response) && response.status === 200;
  streamOpened.add(opened);
  dropped.add(ACTIONS - next);
}

export function teardown(data) {
  data.rooms.forEach((roomId, room) => {
    http.post(`${BASE}/api/rooms/${roomId}/end`, null, auth(hosts[room]));
  });
}
