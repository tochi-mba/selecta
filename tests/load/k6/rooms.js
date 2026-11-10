// Rooms stress scenarios on staging (ADR-0416 SC-0416-06, docs/saas/15-stress-testing.md §15.5
// "Rooms"): 1,000 guests join within 10 s, 10,000 votes a minute, and room-code brute forcing.
//
//   k6 run -e BASE_URL=https://staging.example -e CODE=K7QDM2XP -e REQUEST_ID=<pending request> tests/load/k6/rooms.js
//
// CODE is an open staging room (raise its guest cap to 1,000 for this run); REQUEST_ID is a pending
// request in it to vote on. Run behind the same Cloudflare rule as production, from many source
// addresses, or the per-IP join limit (10 a minute) will rightly refuse most joins.
// Thresholds are pass/fail: k6 exits non-zero when any is missed.

import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Set BASE_URL to a staging origin');
const CODE = __ENV.CODE;
const REQUEST_ID = __ENV.REQUEST_ID;
const json = { headers: { 'Content-Type': 'application/json', Origin: BASE } };

const joinTime = new Trend('room_join_duration', true);
const joinFailed = new Rate('room_join_failed');
const voteTime = new Trend('room_vote_duration', true);
const voteFailed = new Rate('room_vote_failed');
const roomsFound = new Counter('brute_force_rooms_found');

export const options = {
  scenarios: {
    stampede: { executor: 'shared-iterations', exec: 'join', vus: 1000, iterations: 1000, maxDuration: '10s' },
    votes: { executor: 'constant-arrival-rate', exec: 'vote', rate: 10000, timeUnit: '1m', duration: '3m', preAllocatedVUs: 300, startTime: '15s' },
    guessing: { executor: 'constant-arrival-rate', exec: 'guess', rate: 50, timeUnit: '1s', duration: '2m', preAllocatedVUs: 50, startTime: '15s' },
  },
  thresholds: {
    room_join_duration: ['p(95)<500'],
    room_join_failed: ['rate<0.01'],
    room_vote_duration: ['p(95)<300'],
    room_vote_failed: ['rate<0.005'],
    brute_force_rooms_found: ['count==0'],
  },
};

let roomId = null;

export function join() {
  const answer = http.post(`${BASE}/api/guest/join`, JSON.stringify({ code: CODE }), json);
  joinTime.add(answer.timings.duration);
  joinFailed.add(answer.status !== 201);
  if (answer.status === 201) roomId = answer.json('room_id');
}

export function vote() {
  if (!roomId) join();
  if (!roomId || !REQUEST_ID) return;
  const path = `${BASE}/api/guest/rooms/${roomId}/requests/${REQUEST_ID}/vote`;
  const answer = __ITER % 2 === 0 ? http.post(path, null, json) : http.del(path, null, json);
  if (answer.status === 429) return; // a guest's own write limit is deliberate throttling
  voteTime.add(answer.timings.duration);
  voteFailed.add(answer.status >= 400);
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // src/selecta/rooms/codes.py
export function guess() {
  let made = '';
  for (let i = 0; i < 8; i++) made += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  if (made === CODE) return;
  const answer = http.post(`${BASE}/api/guest/join`, JSON.stringify({ code: made }), json);
  if (answer.status === 201) roomsFound.add(1);
}
