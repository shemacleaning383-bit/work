import type { Db } from './db.ts';
import type { Adapters } from './adapters/types.ts';
import type { Mode } from '../shared/types.ts';

export interface Ctx {
  db: Db;
  adapters: Adapters;
  mode: Mode;
  demo: boolean;
  /** Artificial pacing between demo stages so progress is observable. */
  stageDelayMs: number;
  baseUrl: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pace(ctx: Ctx, factor = 1) {
  if (ctx.demo && ctx.stageDelayMs > 0) await sleep(ctx.stageDelayMs * factor);
}
