// Durable job queue on SQLite. Jobs survive restarts and browser closes;
// idempotency keys make repeated taps/requests harmless.
import type { Ctx } from '../ctx.ts';
import { now, newId, j, pj, type Row } from '../db.ts';

export interface Job {
  id: string;
  project_id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  payload: any;
  error: string | null;
}

export class PermanentError extends Error {
  /** Customer-safe message; `message` holds the internal detail. */
  publicMessage: string;
  constructor(internal: string, publicMessage = 'Something went wrong on our side. Our team has been notified.') {
    super(internal);
    this.publicMessage = publicMessage;
  }
}

const toJob = (r: Row): Job => ({ ...(r as any), payload: pj(r.payload_json, {}) });

export function enqueue(ctx: Ctx, args: { projectId: string; type: string; key: string; payload?: unknown; delayMs?: number; maxAttempts?: number }): { job: Job; created: boolean } {
  const existing = ctx.db.get('SELECT * FROM jobs WHERE idempotency_key = ?', args.key);
  if (existing) return { job: toJob(existing), created: false };
  const id = newId('job');
  ctx.db.run(
    `INSERT INTO jobs (id, project_id, type, status, attempts, max_attempts, run_after, idempotency_key, payload_json, created_at)
     VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
    id, args.projectId, args.type, args.maxAttempts ?? 3, new Date(Date.now() + (args.delayMs ?? 0)).toISOString(), args.key, j(args.payload ?? {}), now(),
  );
  return { job: toJob(ctx.db.get('SELECT * FROM jobs WHERE id = ?', id)!), created: true };
}

export function claimNext(ctx: Ctx): Job | null {
  const r = ctx.db.get(
    `UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after, created_at LIMIT 1)
     RETURNING *`,
    now(), now(),
  );
  return r ? toJob(r) : null;
}

export function complete(ctx: Ctx, jobId: string) {
  ctx.db.run(`UPDATE jobs SET status = 'succeeded', finished_at = ?, locked_at = NULL, error = NULL WHERE id = ?`, now(), jobId);
}

/** Returns true if the job will be retried. */
export function fail(ctx: Ctx, job: Job, err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const permanent = err instanceof PermanentError;
  if (!permanent && job.attempts < job.max_attempts) {
    const backoff = Math.min(60_000, 1000 * 2 ** job.attempts);
    ctx.db.run(`UPDATE jobs SET status = 'queued', run_after = ?, locked_at = NULL, error = ? WHERE id = ?`, new Date(Date.now() + backoff).toISOString(), msg.slice(0, 2000), job.id);
    return true;
  }
  ctx.db.run(`UPDATE jobs SET status = 'failed', finished_at = ?, locked_at = NULL, error = ? WHERE id = ?`, now(), msg.slice(0, 2000), job.id);
  return false;
}

/** Re-queue a failed job in place (safe retry from the failed stage). */
export function retry(ctx: Ctx, jobId: string): boolean {
  const r = ctx.db.run(`UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, error = NULL, finished_at = NULL WHERE id = ? AND status = 'failed'`, now(), jobId);
  return r.changes > 0;
}

export function cancelProjectJobs(ctx: Ctx, projectId: string) {
  ctx.db.run(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE project_id = ? AND status = 'queued'`, now(), projectId);
}

/** Requeue jobs whose worker died mid-run (e.g. server restart). */
export function recoverStale(ctx: Ctx, staleMs = 120_000): number {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  return ctx.db.run(`UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < ?`, cutoff).changes;
}

export type Handler = (ctx: Ctx, job: Job) => Promise<void>;

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private ctx: Ctx;
  private handlers: Record<string, Handler>;
  private onFailure: (ctx: Ctx, job: Job, err: unknown, willRetry: boolean) => void;
  private pollMs: number;

  constructor(ctx: Ctx, handlers: Record<string, Handler>, onFailure: (ctx: Ctx, job: Job, err: unknown, willRetry: boolean) => void, pollMs = 400) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.onFailure = onFailure;
    this.pollMs = pollMs;
  }

  start() {
    recoverStale(this.ctx, 0);
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Process jobs until the queue has nothing ready. Returns number processed. */
  async drain(maxJobs = 100): Promise<number> {
    let n = 0;
    while (n < maxJobs) {
      const job = claimNext(this.ctx);
      if (!job) break;
      await this.run(job);
      n++;
    }
    return n;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Run up to a few jobs concurrently-in-sequence per tick.
      const job = claimNext(this.ctx);
      if (job) await this.run(job);
    } finally {
      this.busy = false;
    }
  }

  private async run(job: Job) {
    const h = this.handlers[job.type];
    try {
      if (!h) throw new PermanentError(`No handler for job type ${job.type}`);
      // Skip work for cancelled projects.
      const p = this.ctx.db.get<{ status: string }>('SELECT status FROM projects WHERE id = ?', job.project_id);
      if (!p || p.status === 'cancelled') {
        this.ctx.db.run(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?`, now(), job.id);
        return;
      }
      await h(this.ctx, job);
      complete(this.ctx, job.id);
    } catch (err) {
      const willRetry = fail(this.ctx, job, err);
      this.onFailure(this.ctx, job, err, willRetry);
    }
  }
}
