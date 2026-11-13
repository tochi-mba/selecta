// ZoneSwitcher (ADR-0453 D10, ADR-0443 BZ-0443-07): a segmented control for 2 to 4 zones, a Menu
// above that; one zone needs no switcher. The deck steers the zone chosen here.

import { Menu } from '../../ui/controls';
import { MenuItem } from '../../ui/primitives';
import { STAFF_COPY } from '../copy/staff';
import type { Zone } from '../types';
import './staff.css';

export function ZoneSwitcher({ zones, current, onChange }: { zones: Zone[]; current: string; onChange: (id: string) => void }) {
  if (zones.length < 2) return null;
  const chosen = zones.find((zone) => zone.id === current) ?? zones[0];
  if (zones.length > 4) {
    return (
      <Menu className="biz-zone-menu" label={<span>{STAFF_COPY.zonesLabel}: {chosen.name}</span>} title={STAFF_COPY.chooseZone}>
        {zones.map((zone) => (
          <MenuItem key={zone.id} aria-current={zone.id === chosen.id || undefined} onClick={() => onChange(zone.id)}>{zone.name}</MenuItem>
        ))}
      </Menu>
    );
  }
  return (
    <div className="biz-zone-switch" role="group" aria-label={STAFF_COPY.chooseZone}>
      {zones.map((zone) => (
        <button key={zone.id} type="button" className="biz-big-action biz-zone-option" aria-pressed={zone.id === chosen.id} onClick={() => onChange(zone.id)}>
          {zone.name}
        </button>
      ))}
    </div>
  );
}
