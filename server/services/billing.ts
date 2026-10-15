// Subscription lifecycle. Only verified provider events (webhooks) change
// payment state; the checkout redirect is never trusted.
import type { Ctx } from '../ctx.ts';
import { now, newId, j } from '../db.ts';
import { getProject, transition, UserError } from './projects.ts';
import { enqueue } from './jobs.ts';
import { event, track, audit } from './events.ts';
import { slugify } from '../../shared/validate.ts';
import { effectiveFacts } from './facts.ts';
import type { PaymentEvent } from '../adapters/types.ts';

function upsertSub(ctx: Ctx, projectId: string, fields: Record<string, string | null>) {
  const existing = ctx.db.get('SELECT project_id FROM subscriptions WHERE project_id = ?', projectId);
  if (!existing) ctx.db.run('INSERT INTO subscriptions (project_id, status, provider, updated_at) VALUES (?, ?, ?, ?)', projectId, 'none', ctx.adapters.payments.name, now());
  const keys = Object.keys(fields);
  if (!keys.length) return;
  ctx.db.run(`UPDATE subscriptions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE project_id = ?`, ...keys.map((k) => fields[k]), now(), projectId);
}

export function approveLaunch(ctx: Ctx, projectId: string, factsConfirmed: boolean, launchApproved: boolean) {
  const p = getProject(ctx, projectId);
  if (!['site_ready', 'paid', 'launching', 'live'].includes(p.status)) throw new UserError('Your full site preview needs to be ready first.', 'invalid_state', 409);
  if (!factsConfirmed || !launchApproved) throw new UserError('Please confirm your details and approve the launch.', 'approval_required', 422);
  ctx.db.run('UPDATE projects SET launch_approved_at = COALESCE(launch_approved_at, ?) WHERE id = ?', now(), projectId);
  audit(ctx, projectId, 'owner', 'launch_approved');
}

export async function startCheckout(ctx: Ctx, projectId: string, email: string | null): Promise<{ url: string; reused: boolean }> {
  const p = getProject(ctx, projectId);
  if (p.status !== 'site_ready') {
    if (['paid', 'launching', 'live'].includes(p.status)) throw new UserError('This website already has an active subscription.', 'already_paid', 409);
    throw new UserError('Your full site preview needs to be ready before you subscribe.', 'invalid_state', 409);
  }
  if (!p.launch_approved_at) throw new UserError('Please approve the launch details first.', 'approval_required', 422);
  // Reuse a recent open checkout instead of creating duplicates on repeated taps.
  const open = ctx.db.get(`SELECT * FROM checkout_sessions WHERE project_id = ? AND status = 'open' AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
    projectId, new Date(Date.now() - 20 * 60_000).toISOString());
  if (open?.url) return { url: open.url, reused: true };
  const attempt = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM checkout_sessions WHERE project_id = ?', projectId)!.n + 1;
  const base = ctx.baseUrl.replace(/\/$/, '');
  const { sessionId, url } = await ctx.adapters.payments.createCheckout({
    projectId,
    successUrl: `${base}/p/${projectId}/launch?checkout=returned`,
    cancelUrl: `${base}/p/${projectId}/launch?checkout=cancelled`,
    email,
    idempotencyKey: `checkout:${projectId}:${attempt}`,
  });
  ctx.db.run('INSERT INTO checkout_sessions (id, project_id, provider, status, url, created_at) VALUES (?, ?, ?, ?, ?, ?)', sessionId, projectId, ctx.adapters.payments.name, 'open', url, now());
  upsertSub(ctx, projectId, { status: 'checkout_open', provider: ctx.adapters.payments.name, checkout_session_id: sessionId, last_error: null });
  track(ctx, 'checkout_started', projectId, { mode: ctx.mode });
  return { url, reused: false };
}

function ensureSlug(ctx: Ctx, projectId: string) {
  const p = getProject(ctx, projectId);
  if (p.live_slug) return p.live_slug;
  const base = slugify(String(effectiveFacts(ctx, projectId).displayName ?? 'site'));
  let slug = base;
  for (let i = 2; ctx.db.get('SELECT 1 FROM projects WHERE live_slug = ?', slug); i++) slug = `${base}-${i}`;
  ctx.db.run('UPDATE projects SET live_slug = ? WHERE id = ?', slug, projectId);
  return slug;
}

/** Applies a verified payment event exactly once. Returns 'duplicate' for redelivered events. */
export function handlePaymentEvent(ctx: Ctx, e: PaymentEvent): 'processed' | 'duplicate' | 'ignored' {
  const inserted = ctx.db.run('INSERT OR IGNORE INTO payment_events (id, project_id, type, received_at, payload_json) VALUES (?, ?, ?, ?, ?)', e.id, e.projectId, e.type, now(), j(e.raw));
  if (inserted.changes === 0) return 'duplicate';
  if (e.type === 'ignored' || !e.projectId || !ctx.db.get('SELECT 1 FROM projects WHERE id = ?', e.projectId)) {
    ctx.db.run('UPDATE payment_events SET processed_at = ?, outcome = ? WHERE id = ?', now(), 'ignored', e.id);
    return 'ignored';
  }
  const pid = e.projectId;
  ctx.db.tx(() => {
    const p = getProject(ctx, pid);
    switch (e.type) {
      case 'checkout.completed': {
        upsertSub(ctx, pid, {
          status: 'active', provider_customer: e.customerId ?? null, provider_subscription: e.subscriptionId ?? null,
          current_period_end: e.periodEnd ?? new Date(Date.now() + 30 * 86400_000).toISOString(), last_error: null,
        });
        ctx.db.run(`UPDATE checkout_sessions SET status = 'completed' WHERE project_id = ? AND status = 'open'`, pid);
        if (p.status === 'site_ready') {
          ensureSlug(ctx, pid);
          transition(ctx, pid, 'paid');
          event(ctx, pid, 'launch', 'success', ctx.adapters.payments.simulated ? 'Subscription confirmed (simulated, no charge was made).' : 'Payment confirmed. Your subscription is active.');
          enqueue(ctx, { projectId: pid, type: 'launch', key: `launch:${pid}:initial` });
        }
        track(ctx, 'subscribed', pid, { mode: ctx.mode });
        break;
      }
      case 'checkout.expired':
        ctx.db.run(`UPDATE checkout_sessions SET status = 'expired' WHERE project_id = ? AND status = 'open'`, pid);
        if (!['active', 'cancel_scheduled'].includes(String(ctx.db.get('SELECT status FROM subscriptions WHERE project_id = ?', pid)?.status))) upsertSub(ctx, pid, { status: 'none' });
        break;
      case 'payment.failed': {
        const cur = ctx.db.get('SELECT status FROM subscriptions WHERE project_id = ?', pid)?.status;
        upsertSub(ctx, pid, { status: cur === 'active' ? 'past_due' : 'payment_failed', last_error: e.message ?? 'The payment was declined.' });
        ctx.db.run(`UPDATE checkout_sessions SET status = 'failed' WHERE project_id = ? AND status = 'open'`, pid);
        event(ctx, pid, 'launch', 'warn', 'The payment didn’t go through. No subscription was started. You can try again.');
        track(ctx, 'payment_failed', pid);
        break;
      }
      case 'invoice.paid':
        upsertSub(ctx, pid, { status: 'active', current_period_end: e.periodEnd ?? null, last_error: null });
        break;
      case 'subscription.updated':
        upsertSub(ctx, pid, { status: e.cancelAtPeriodEnd ? 'cancel_scheduled' : 'active', ...(e.periodEnd ? { current_period_end: e.periodEnd } : {}) });
        break;
      case 'subscription.deleted':
        upsertSub(ctx, pid, { status: 'cancelled' });
        if (p.status !== 'cancelled') {
          ctx.db.run('UPDATE projects SET cancelled_at = ? WHERE id = ?', now(), pid);
          transition(ctx, pid, 'cancelled', 'billing');
          event(ctx, pid, 'launch', 'info', 'Subscription ended. The site is no longer hosted. Your domain remains yours.');
        }
        break;
    }
    ctx.db.run('UPDATE payment_events SET processed_at = ?, outcome = ? WHERE id = ?', now(), 'processed', e.id);
  });
  return 'processed';
}

export async function cancelSubscription(ctx: Ctx, projectId: string) {
  const sub = ctx.db.get('SELECT * FROM subscriptions WHERE project_id = ?', projectId);
  if (!sub || !['active', 'past_due'].includes(sub.status)) throw new UserError('There’s no active subscription to cancel.', 'invalid_state', 409);
  if (sub.provider_subscription && !ctx.adapters.payments.simulated) await ctx.adapters.payments.cancelAtPeriodEnd(sub.provider_subscription);
  // Demo: emit the same event the provider would send.
  if (ctx.adapters.payments.simulated) {
    handlePaymentEvent(ctx, { id: newId('demo_evt'), type: 'subscription.updated', projectId, cancelAtPeriodEnd: true, raw: { simulated: true } });
  }
  audit(ctx, projectId, 'owner', 'cancel_requested');
}

export async function resumeSubscription(ctx: Ctx, projectId: string) {
  const sub = ctx.db.get('SELECT * FROM subscriptions WHERE project_id = ?', projectId);
  if (!sub || sub.status !== 'cancel_scheduled') throw new UserError('Nothing to resume.', 'invalid_state', 409);
  if (sub.provider_subscription && !ctx.adapters.payments.simulated) await ctx.adapters.payments.resume(sub.provider_subscription);
  if (ctx.adapters.payments.simulated) handlePaymentEvent(ctx, { id: newId('demo_evt'), type: 'subscription.updated', projectId, cancelAtPeriodEnd: false, raw: { simulated: true } });
}
