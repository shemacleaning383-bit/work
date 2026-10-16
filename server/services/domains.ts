// Customer-owned domain connection. We never buy domains and never claim to
// have checked availability. DNS status comes from real lookups (live) or is
// explicitly marked simulated (demo).
import type { Ctx } from '../ctx.ts';
import { now, j, pj } from '../db.ts';
import { randomBytes } from 'node:crypto';
import { normalizeDomain } from '../../shared/validate.ts';
import { UserError, getProject } from './projects.ts';
import { event, audit } from './events.ts';
import { config } from '../config.ts';
import { enqueue } from './jobs.ts';

export function recordsFor(domain: string, token: string) {
  return [
    { type: 'TXT', host: `_bluepark.${domain}`, value: `bluepark-verify=${token}`, purpose: 'Proves you control this domain' },
    { type: 'CNAME', host: `www.${domain}`, value: config.hosting.cnameTarget, purpose: 'Points www to your Blue Park site' },
    { type: 'A', host: domain, value: config.hosting.apexIp, purpose: 'Points the bare domain to your Blue Park site' },
  ];
}

export function setDomain(ctx: Ctx, projectId: string, mode: 'subdomain' | 'custom', raw?: string) {
  getProject(ctx, projectId);
  const existing = ctx.db.get('SELECT verify_token FROM domains WHERE project_id = ?', projectId);
  const token = existing?.verify_token ?? randomBytes(10).toString('hex');
  if (mode === 'subdomain') {
    ctx.db.run(`INSERT INTO domains (project_id, domain, mode, status, ssl_status, verify_token, records_json, note, simulated) VALUES (?, NULL, 'subdomain', 'verified', 'ready', ?, '[]', ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET domain = NULL, mode = 'subdomain', status = 'verified', ssl_status = 'ready', records_json = '[]', note = excluded.note, simulated = excluded.simulated`,
      projectId, token, 'Your site uses a Blue Park address. You can connect your own domain later.', ctx.demo ? 1 : 0);
    return;
  }
  const domain = normalizeDomain(raw ?? '');
  if (!domain) throw new UserError('Please enter a domain like yourbusiness.ca', 'invalid_domain', 422, 'domain');
  const taken = ctx.db.get(`SELECT project_id FROM domains WHERE domain = ? AND project_id != ? AND status = 'verified'`, domain, projectId);
  if (taken) throw new UserError('That domain is already connected to another site. Contact support if it’s yours.', 'domain_taken', 409, 'domain');
  const records = recordsFor(domain, token).map((r) => ({ ...r, found: null }));
  ctx.db.run(`INSERT INTO domains (project_id, domain, mode, status, ssl_status, verify_token, records_json, note, simulated) VALUES (?, ?, 'custom', 'awaiting_dns', 'not_started', ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET domain = excluded.domain, mode = 'custom', status = 'awaiting_dns', ssl_status = 'not_started', records_json = excluded.records_json, note = excluded.note, last_checked_at = NULL, simulated = excluded.simulated`,
    projectId, domain, token, j(records),
    'Add these records at the company where you bought your domain. Don’t change MX records: your email keeps working as it is now.', ctx.demo ? 1 : 0);
  audit(ctx, projectId, 'owner', 'domain_set', { domain });
}

export async function checkDomain(ctx: Ctx, projectId: string) {
  const d = ctx.db.get('SELECT * FROM domains WHERE project_id = ?', projectId);
  if (!d || d.mode !== 'custom') throw new UserError('No custom domain to check.', 'invalid_state', 409);
  const records = pj<any[]>(d.records_json, []);
  const results = await ctx.adapters.domains.check(records);
  const merged = records.map((r, i) => ({ ...r, found: results[i]?.found ?? null }));
  const ownership = merged.find((r) => r.type === 'TXT')?.found;
  const pointing = merged.filter((r) => r.type !== 'TXT').some((r) => r.found);
  const status = ownership && pointing ? 'verified' : 'awaiting_dns';
  const ssl = status === 'verified' ? 'pending' : 'not_started';
  const note = ctx.adapters.domains.simulated
    ? 'Demo mode: DNS isn’t really checked, so this always shows as waiting.'
    : status === 'verified'
      ? 'DNS verified. Your SSL certificate is issued automatically once traffic reaches the host; this can take up to an hour.'
      : 'DNS changes can take a few minutes to 48 hours to appear. We’ll keep checking when you tap “Check again”.';
  ctx.db.run('UPDATE domains SET records_json = ?, status = ?, ssl_status = ?, last_checked_at = ?, note = ? WHERE project_id = ?', j(merged), status, ssl, now(), note, projectId);
  if (status === 'verified' && d.status !== 'verified') {
    event(ctx, projectId, 'launch', 'success', `${d.domain} is verified.`);
    const p = getProject(ctx, projectId);
    if (p.status === 'live') enqueue(ctx, { projectId, type: 'launch', key: `launch:${projectId}:domain:${d.domain}`, payload: { republish: true } });
  }
  return { status, records: merged };
}
