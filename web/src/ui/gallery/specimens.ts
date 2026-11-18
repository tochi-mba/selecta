import type { StatusKind } from '../controls';
import type { SkeletonVariant } from '../Skeleton';

/** Every status kind and every skeleton variant, shown by both galleries (ui/ControlGallery.tsx and
 * harness/CloudGallery.tsx); gallery-completeness.test.ts checks both lists against their types. */
export const GALLERY_KINDS: StatusKind[] = ['planned', 'queued', 'working', 'paused', 'recovering', 'ready', 'warning', 'blocked', 'failed', 'needs-action', 'unavailable'];
export const GALLERY_SKELETONS: SkeletonVariant[] = ['text', 'cards', 'vibes', 'library', 'listen', 'timeline', 'inspector', 'pairs', 'metrics', 'rows'];
