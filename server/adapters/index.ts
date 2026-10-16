import type { Adapters } from './types.ts';
import type { Mode } from '../../shared/types.ts';
import { demoAdapters } from './demo/index.ts';
import { liveAdapters } from './live/index.ts';

/** Demo mode uses fixtures only. Live mode uses live adapters; unconfigured ones report unavailable. */
export function selectAdapters(mode: Mode): Adapters {
  return mode === 'demo' ? demoAdapters() : liveAdapters();
}
