import { createContext, type ComponentType } from 'react';
import type { MixItem } from '../api';

/** Another way to make a mix's file, drawn in the Export panel by a shell that has one (Cloud's
 * "Make the file in your cloud library", cloud.one_mixer). `onFirst(true)` says it is the
 * recommended way here (on a phone), so the panel's own Save it steps back from primary. With no
 * provider the panel is exactly as before. */
export type ExportElsewhereProps = { mix: readonly MixItem[]; onFirst: (first: boolean) => void };
export const ExportElsewhere = createContext<ComponentType<ExportElsewhereProps> | null>(null);
