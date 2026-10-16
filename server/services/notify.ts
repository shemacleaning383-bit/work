// Notification preferences, consent and delivery records. A message is only
// sent to a destination the owner chose AND verified. Public business phone
// numbers found online are never used for notifications.
import type { Ctx } from '../ctx.ts';
import { now, newId, later } from '../db.ts';
import { createHash, randomBytes } from 'node:crypto';
import { enqueue, PermanentError, type Job } from './jobs.ts';
import { event, track } from './events.ts';
import { getProject } from './projects.ts';
import { effectiveFacts } from './facts.ts';
import { maskEmail, maskPhone } from '../../shared/validate.ts';

export const CONSENT_TEXT = 'We’ll use this to send your preview link and updates about this build.';

export function setPreference(ctx: Ctx, projectId: string, channel: 'sms' | 'email' | 'none', contactId: string | null, marketingOptIn: boolean) {
  ctx.db.run(
    `INSERT INTO notification_prefs (project_id, channel, contact_id, marketing_opt_in, consent_text, consent_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET channel = excluded.channel, contact_id = excluded.contact_id, marketing_opt_in = excluded.marketing_opt_in,
       consent_text = excluded.consent_text, consent_at = excluded.consent_at, updated_at = excluded.updated_at`,
    projectId, channel, contactId, marketingOptIn ? 1 : 0, channel === 'none' ? null : CONSENT_TEXT, channel === 'none' ? null : now(), now(),
  );
}

export function hashToken(t: string) {
  return createHash('sha256').update(t).digest('hex');
}

export function createMagicLink(ctx: Ctx, contactId: string, projectId: string, ttlMs = 72 * 3600_000): string {
  const token = randomBytes(24).toString('base64url');
  ctx.db.run('INSERT INTO magic_links (token_hash, contact_id, project_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', hashToken(token), contactId, projectId, later(ttlMs), now());
  return `${ctx.baseUrl.replace(/\/$/, '')}/r/${token}`;
}

const TEMPLATES: Record<string, (name: string, link: string) => { subject: string; text: string }> = {
  preview_ready: (n, l) => ({ subject: `Your ${n} website preview is ready`, text: `Your two homepage designs for ${n} are ready to view: ${l}\nThis private link expires in 72 hours. Reply STOP to opt out of texts.` }),
  site_ready: (n, l) => ({ subject: `Your full ${n} site preview is ready`, text: `The full website preview for ${n} is ready: ${l}` }),
  needs_info: (n, l) => ({ subject: `We need a detail for ${n}`, text: `We need a little more information to finish the ${n} preview: ${l}` }),
  launched: (n, l) => ({ subject: `${n} is live`, text: `Your website is live. Manage it here: ${l}` }),
  change_ready: (n, l) => ({ subject: `A proposed change for ${n} is ready`, text: `We prepared the change you asked for. Preview and approve it here: ${l}` }),
};

/** Queue a notification if the owner opted in with a verified destination. Idempotent per key. */
export function queueNotification(ctx: Ctx, projectId: string, template: keyof typeof TEMPLATES | string, key: string): string | null {
  const pref = ctx.db.get(
    'SELECT n.channel, c.id AS cid, c.destination, c.kind, c.verified_at, c.opted_out_at FROM notification_prefs n JOIN contacts c ON c.id = n.contact_id WHERE n.project_id = ?',
    projectId,
  );
  if (!pref || pref.channel === 'none' || !pref.verified_at) return null;
  const existing = ctx.db.get('SELECT id FROM notifications WHERE idempotency_key = ?', key);
  if (existing) return existing.id;
  const id = newId('ntf');
  const status = pref.opted_out_at ? 'suppressed' : 'queued';
  ctx.db.run('INSERT INTO notifications (id, project_id, channel, destination, template, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, projectId, pref.kind, pref.destination, template, status, key, now(), now());
  if (status === 'queued') enqueue(ctx, { projectId, type: 'notify', key: `notify:${id}`, payload: { notificationId: id, contactId: pref.cid }, maxAttempts: 3 });
  return id;
}

export async function handleNotify(ctx: Ctx, job: Job) {
  const n = ctx.db.get('SELECT * FROM notifications WHERE id = ?', job.payload.notificationId);
  if (!n || n.status !== 'queued') return;
  const p = getProject(ctx, n.project_id);
  const name = String(effectiveFacts(ctx, p.id).displayName ?? 'your business');
  const link = createMagicLink(ctx, job.payload.contactId, p.id);
  const tpl = TEMPLATES[n.template] ?? TEMPLATES.preview_ready;
  const msg = tpl(name, link);
  const res = await ctx.adapters.notify.send({ channel: n.channel, to: n.destination, subject: msg.subject, text: msg.text });
  ctx.db.run('UPDATE notifications SET status = ?, provider = ?, provider_id = ?, error = ?, updated_at = ? WHERE id = ?',
    res.status, res.provider, res.providerId ?? null, res.error ?? null, now(), n.id);
  const masked = n.channel === 'email' ? maskEmail(n.destination) : maskPhone(n.destination);
  if (res.status === 'failed') {
    event(ctx, p.id, 'ready', 'warn', `We couldn’t deliver your ${n.channel === 'sms' ? 'text' : 'email'} to ${masked}. You can update your contact below.`, { jobId: job.id, internal: res.error });
    track(ctx, 'notification_failed', p.id, { kind: n.channel });
    throw new PermanentError(`notification failed: ${res.error}`, 'Notification failed');
  }
  event(ctx, p.id, 'ready', 'info', res.status === 'simulated'
    ? `Notification simulated (demo): nothing was sent to ${masked}.`
    : `${n.channel === 'sms' ? 'Text' : 'Email'} handed to the provider for ${masked}.`, { jobId: job.id });
}
