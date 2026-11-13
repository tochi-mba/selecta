// Polite now-playing announcements for the zones on screen, at most once every 30 s per zone (D5),
// with a pause the person controls. Only SilentZoneAlert is assertive.

import { useEffect, useRef } from 'react';
import { announce } from '../../ui/controls';
import { CONSOLE_COPY } from '../copy/console';
import { zoneShownState } from '../state';
import type { Venue } from '../types';
import { AnnouncementLimiter } from './consoleLogic';

export function useNowPlayingAnnouncements(venues: Venue[], now: number, paused: boolean, clock: () => number = Date.now) {
  const limiter = useRef(new AnnouncementLimiter());
  useEffect(() => {
    const at = clock();
    for (const venue of venues) {
      for (const zone of venue.zones) {
        const state = zoneShownState(zone, venue, now);
        if (!zone.now || (state !== 'playing' && state !== 'playing_saved' && state !== 'quiet_hours')) continue;
        // The limiter still learns the song while paused, so resuming does not read out a backlog.
        const news = limiter.current.offer(zone.id, zone.now.id, at);
        if (news && !paused) announce(CONSOLE_COPY.nowPlayingAnnouncement(zone.name, venue.name, zone.now.title, zone.now.artist));
      }
    }
  }, [venues, now, paused, clock]);
}
