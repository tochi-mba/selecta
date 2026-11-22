// The kiosk app's version, sent in every heartbeat and health report (ADR-0445 auto-update).
// The server lists the versions it accepts in src/selecta/business/kiosk.py KIOSK_RELEASES;
// bump both together when the kiosk changes.

export const KIOSK_VERSION = '2026.11.1';
