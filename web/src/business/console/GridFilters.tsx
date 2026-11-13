// Sort, filters (region, status, venue tag) and search by name for the venue health grid (D7).

import { Select } from '../../ui/formControls';
import { SearchField } from '../../ui/primitives';
import { CONSOLE_COPY } from '../copy/console';
import type { GridOptions, SortKey, StatusFilter } from './consoleLogic';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: CONSOLE_COPY.everyStatus },
  { value: 'silent', label: CONSOLE_COPY.statusWords.silent },
  { value: 'needs_you', label: CONSOLE_COPY.statusWords.needs_you },
  { value: 'not_reporting', label: CONSOLE_COPY.statusWords.not_reporting },
  { value: 'paused_by_staff', label: CONSOLE_COPY.statusWords.paused_by_staff },
  { value: 'playing', label: CONSOLE_COPY.statusWords.playing },
  { value: 'closed', label: CONSOLE_COPY.statusWords.closed },
];

export function GridFilters({ options, onChange, regions, tags }: { options: GridOptions; onChange: (next: GridOptions) => void; regions: string[]; tags: string[] }) {
  const set = <K extends keyof GridOptions>(key: K, value: GridOptions[K]) => onChange({ ...options, [key]: value });
  return <div className="hq-filters" role="search" aria-label={CONSOLE_COPY.searchLabel}>
    <SearchField label={CONSOLE_COPY.searchLabel} value={options.query} onChange={(value) => set('query', value)} onEscape={() => set('query', '')} />
    <Select<SortKey> label={CONSOLE_COPY.sortLabel} value={options.sort} onChange={(value) => set('sort', value)} options={[
      { value: 'severity', label: CONSOLE_COPY.sortSeverity }, { value: 'name', label: CONSOLE_COPY.sortName }, { value: 'region', label: CONSOLE_COPY.sortRegion },
    ]} />
    <Select<string> label={CONSOLE_COPY.regionLabel} value={options.region} onChange={(value) => set('region', value)} options={[{ value: '', label: CONSOLE_COPY.everyRegion }, ...regions.map((region) => ({ value: region, label: region }))]} />
    <Select<StatusFilter> label={CONSOLE_COPY.statusLabel} value={options.status} onChange={(value) => set('status', value)} options={STATUS_OPTIONS} />
    {tags.length > 0 && <Select<string> label={CONSOLE_COPY.tagLabel} value={options.tag} onChange={(value) => set('tag', value)} options={[{ value: '', label: CONSOLE_COPY.everyTag }, ...tags.map((tag) => ({ value: tag, label: tag }))]} />}
  </div>;
}
