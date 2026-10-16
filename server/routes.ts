import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from './ctx.ts';
import { Router, readJson, readBody, readForm, json, html, redirect, rateLimit, PREVIEW_CSP, LIVE_SITE_CSP, type Req, type Res } from './http.ts';
import { config } from './config.ts';
import { now, newId, pj } from './db.ts';
import {
  getSession, ensureSession, requireProject, startOtp, verifyOtp, consumeMagicLink, signOut, adminLogin, demoAdminLogin, canAccessProject, type Session,
} from './auth.ts';
import {
  UserError, createProject, runLookup, confirmCandidate, rejectMatch, startManual, requestBuild, regenerate, chooseVariant,
  projectView, getProject, currentVersion, cancelProject, transition, publicCandidate,
} from './services/projects.ts';
import { classifyIdentifier, clampText, normalizePhone, isEmail, maskEmail, maskPhone } from '../shared/validate.ts';
import { setOwnerFacts, factViews } from './services/facts.ts';
import { cleanFacts, selfServiceEdit, restoreVersion, createChangeRequest, decideProposal, proposeChange, teamUpdateRequest } from './services/edits.ts';
import { setPreference } from './services/notify.ts';
import { saveUpload } from './uploads.ts';
import { renderPage, sitePages, esc, type SiteContent, type Variant } from './services/sitegen.ts';
import { approveLaunch, startCheckout, handlePaymentEvent, cancelSubscription, resumeSubscription } from './services/billing.ts';
import { setDomain, checkDomain } from './services/domains.ts';
import { audit, event, track } from './services/events.ts';
import { retry as retryJob, enqueue } from './services/jobs.ts';
import { getSettings, saveSettings } from './services/settings.ts';
import { deliverPreview } from './services/pipeline.ts';
import { signDemoEvent } from './adapters/demo/index.ts';
import { renderLanding } from './pages/landing.ts';
import { renderDemoCheckout } from './pages/checkout.ts';
import { OFFER } from '../shared/offer.ts';

const WEB = join(process.cwd(), 'web');
export const REVIEW_ITEMS = ['identity', 'claims', 'contact', 'mobile', 'assets'];

function requireMutation(req: Req) {
  // CSRF defence: cross-site forms can't set custom headers or JSON content type.
  if (req.headers['x-bp'] !== '1') throw new UserError('Missing request header.', 'csrf', 403);
}

function adminOnly(ctx: Ctx, req: Req): Session {
  const s = getSession(ctx, req);
  if (!s?.is_admin) throw new UserError('Admin access required.', 'forbidden', 403);
  return s;
}

function ownerSession(ctx: Ctx, req: Req, id: string): Session {
  const s = getSession(ctx, req);
  requireProject(ctx, s, id);
  return s!;
}

function limit(req: Req, bucket: string, perMinute: number) {
  if (!rateLimit(`${bucket}:${req.ip}`, perMinute)) throw new UserError('Too many requests. Please wait a moment and try again.', 'rate_limited', 429);
}

export function buildRouter(ctx: Ctx): Router {
  const r = new Router();
  const view = (id: string) => projectView(ctx, id);
  const shell = (file: string) => (_req: Req, res: Res) => html(res, 200, readFileSync(join(WEB, file), 'utf8'));

  // ---------- pages ----------
  r.get('/', (_req, res) => html(res, 200, renderLanding(ctx), { 'cache-control': 'public, max-age=60' }));
  for (const p of ['/start', '/signin', '/app', '/app/*', '/p/*']) r.get(p, shell('app.html'));
  for (const p of ['/admin', '/admin/*']) r.get(p, shell('admin.html'));

  r.get('/api/config', () => ({
    mode: ctx.mode,
    offer: config.offer,
    settings: { previewTargetBusinessDays: getSettings(ctx).previewTargetBusinessDays, updateTurnaroundBusinessDays: getSettings(ctx).updateTurnaroundBusinessDays },
    integrations: integrationStatus(ctx),
  }));

  // ---------- intake & matching ----------
  r.post('/api/intake', async (req, res) => {
    requireMutation(req);
    limit(req, 'lookup', Math.ceil(config.offer.limits.lookupsPerHourPerIp / 6));
    if (getSettings(ctx).pausedIntake) throw new UserError('We’re not taking new previews for a short while. Please check back soon.', 'paused', 503);
    const body = await readJson(req);
    const query = clampText(body.query, 2048);
    const location = clampText(body.location, 120);
    const id = classifyIdentifier(location && !/^https?:/i.test(query) ? `${query}, ${location}` : query);
    if (!id) throw new UserError('Paste your Google Maps link or website, or type your business name.', 'invalid', 422, 'query');
    const s = ensureSession(ctx, req, res);
    let projectId = typeof body.projectId === 'string' ? body.projectId : '';
    if (projectId) {
      requireProject(ctx, s, projectId);
      if (getProject(ctx, projectId).status !== 'draft') projectId = '';
    }
    if (!projectId) projectId = createProject(ctx, s.id, query, id.kind);
    else rejectMatch(ctx, projectId);
    const result = await runLookup(ctx, projectId, id, query);
    return { projectId, kind: id.kind, ...result };
  });

  r.post('/api/projects/:id/confirm', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    confirmCandidate(ctx, req.params.id, String(b.candidateId ?? ''));
    return view(req.params.id);
  });
  r.post('/api/projects/:id/reject', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    rejectMatch(ctx, req.params.id);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/manual', async (req, res) => {
    requireMutation(req);
    const s = ensureSession(ctx, req, res);
    const b = await readJson(req);
    const name = clampText(b.name, 120);
    const city = clampText(b.city, 80);
    if (name.length < 2) throw new UserError('Please enter your business name.', 'invalid', 422, 'name');
    if (city.length < 2) throw new UserError('Please enter your city or main area.', 'invalid', 422, 'city');
    let id = req.params.id;
    if (id === 'new') id = createProject(ctx, s.id, name, 'manual');
    else requireProject(ctx, s, id);
    startManual(ctx, id, name, city);
    return view(id);
  });

  r.get('/api/projects/:id', (req) => {
    ownerSession(ctx, req, req.params.id);
    const since = Number(req.query.get('since') ?? 0);
    const v = projectView(ctx, req.params.id, { sinceEvent: Number.isFinite(since) ? since : 0 });
    return v;
  });

  r.put('/api/projects/:id/details', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const p = getProject(ctx, req.params.id);
    if (!['draft', 'needs_info'].includes(p.status)) throw new UserError('Details are locked while your preview is built. Use edits once it’s ready.', 'invalid_state', 409);
    if (!p.match_id) throw new UserError('Please confirm your business first.', 'invalid_state', 409);
    const b = await readJson(req);
    setOwnerFacts(ctx, p.id, cleanFacts(b.facts ?? {}));
    return view(p.id);
  });

  r.post('/api/projects/:id/build', async (req) => {
    requireMutation(req);
    const s = ownerSession(ctx, req, req.params.id);
    requestBuild(ctx, req.params.id, s.id);
    return view(req.params.id);
  });

  // ---------- notifications & saved access ----------
  r.post('/api/projects/:id/notify-pref', async (req) => {
    requireMutation(req);
    const s = ownerSession(ctx, req, req.params.id);
    limit(req, 'otp', 6);
    const b = await readJson(req);
    const channel = b.channel === 'sms' || b.channel === 'email' ? b.channel : 'none';
    if (channel === 'none') {
      setPreference(ctx, req.params.id, 'none', null, false);
      return { ok: true, view: view(req.params.id) };
    }
    const out = await startOtp(ctx, s, channel, String(b.destination ?? ''), 'save', req.params.id);
    return { ok: true, codeSentTo: out.masked, delivery: out.delivery, demoCode: out.demoCode };
  });
  r.post('/api/projects/:id/verify', async (req) => {
    requireMutation(req);
    const s = ownerSession(ctx, req, req.params.id);
    limit(req, 'verify', 12);
    const b = await readJson(req);
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    const { contactId } = verifyOtp(ctx, s, channel, String(b.destination ?? ''), String(b.code ?? ''));
    ctx.db.run('UPDATE projects SET contact_id = COALESCE(contact_id, ?) WHERE id = ?', contactId, req.params.id);
    const p = getProject(ctx, req.params.id);
    if (p.contact_id !== contactId) throw new UserError('This preview is already saved to a different contact.', 'forbidden', 403);
    setPreference(ctx, req.params.id, b.notify === false ? 'none' : channel, contactId, b.marketingOptIn === true);
    // If the preview is already ready, send the link now.
    if (b.notify !== false && ['directions_ready', 'site_ready'].includes(p.status)) {
      const { queueNotification } = await import('./services/notify.ts');
      queueNotification(ctx, p.id, p.status === 'site_ready' ? 'site_ready' : 'preview_ready', `${p.status}:${p.id}:${p.build_no}:${contactId}`);
    }
    audit(ctx, p.id, 'owner', 'contact_verified', { channel });
    return view(req.params.id);
  });

  r.post('/api/auth/start', async (req, res) => {
    requireMutation(req);
    limit(req, 'otp', 6);
    const s = ensureSession(ctx, req, res);
    const b = await readJson(req);
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    const out = await startOtp(ctx, s, channel, String(b.destination ?? ''), 'signin', null);
    return { codeSentTo: out.masked, delivery: out.delivery, demoCode: out.demoCode };
  });
  r.post('/api/auth/verify', async (req) => {
    requireMutation(req);
    limit(req, 'verify', 12);
    const s = getSession(ctx, req);
    if (!s) throw new UserError('Your session expired. Request a new code.', 'expired', 401);
    const b = await readJson(req);
    verifyOtp(ctx, s, b.channel === 'sms' ? 'sms' : 'email', String(b.destination ?? ''), String(b.code ?? ''));
    return me(ctx, getSession(ctx, req));
  });
  r.post('/api/auth/signout', (req, res) => {
    requireMutation(req);
    signOut(ctx, req, res);
    return { ok: true };
  });
  r.get('/api/me', (req) => me(ctx, getSession(ctx, req)));
  r.get('/r/:token', (req, res) => {
    const pid = consumeMagicLink(ctx, res, req.params.token);
    if (!pid) return html(res, 410, simplePage('Link expired', '<p>This link has expired or was already used. Sign in with your email or phone to continue.</p><p><a class="btn" href="/signin">Sign in</a></p>'));
    return redirect(res, `/p/${pid}`);
  });

  // ---------- uploads ----------
  r.post('/api/projects/:id/assets', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    limit(req, 'upload', 20);
    const kind = (['logo', 'photo', 'attachment'].includes(req.query.get('kind') ?? '') ? req.query.get('kind') : 'photo') as 'logo' | 'photo' | 'attachment';
    const buf = await readBody(req, config.offer.limits.maxUploadBytes);
    const id = saveUpload(ctx, req.params.id, buf, kind, clampText(req.query.get('label'), 120) || null);
    if (kind === 'logo') setOwnerFacts(ctx, req.params.id, { logoAssetId: id });
    return { assetId: id, view: view(req.params.id) };
  });
  r.delete('/api/projects/:id/assets/:assetId', (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    ctx.db.run('UPDATE assets SET deleted_at = ? WHERE id = ? AND project_id = ?', now(), req.params.assetId, req.params.id);
    return view(req.params.id);
  });

  // ---------- designs, edits ----------
  r.post('/api/projects/:id/regenerate', (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    regenerate(ctx, req.params.id);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/choose', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    if (b.variant !== 'a' && b.variant !== 'b') throw new UserError('Choose design A or B.', 'invalid', 422);
    chooseVariant(ctx, req.params.id, b.variant);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/viewed', (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    track(ctx, 'preview_viewed', req.params.id);
    return { ok: true };
  });
  r.post('/api/projects/:id/edit', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    selfServiceEdit(ctx, req.params.id, await readJson(req));
    return view(req.params.id);
  });
  r.post('/api/projects/:id/versions/:vid/restore', (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    restoreVersion(ctx, req.params.id, req.params.vid);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/change-requests', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    const out = createChangeRequest(ctx, req.params.id, String(b.message ?? ''), b.attachmentAssetId ? String(b.attachmentAssetId) : null, String(b.idempotencyKey ?? newId('k')));
    return { ...out, view: view(req.params.id) };
  });
  r.post('/api/projects/:id/change-requests/:cid/decision', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    decideProposal(ctx, req.params.id, req.params.cid, b.approve === true);
    return view(req.params.id);
  });

  // ---------- subscribe & launch ----------
  r.post('/api/projects/:id/approve-launch', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    approveLaunch(ctx, req.params.id, b.factsConfirmed === true, b.launchApproved === true);
    const p = getProject(ctx, req.params.id);
    if (p.status === 'paid') enqueue(ctx, { projectId: p.id, type: 'launch', key: `launch:${p.id}:after-approval` });
    return view(req.params.id);
  });
  r.post('/api/projects/:id/checkout', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    limit(req, 'checkout', 10);
    const p = getProject(ctx, req.params.id);
    const contact = p.contact_id ? ctx.db.get('SELECT kind, destination FROM contacts WHERE id = ?', p.contact_id) : null;
    try {
      return await startCheckout(ctx, p.id, contact?.kind === 'email' ? contact.destination : null);
    } catch (e: any) {
      if (e?.code === 'payments_unconfigured') throw new UserError('Online payment isn’t connected yet. Your site is saved; we’ll email you when you can subscribe.', 'payments_unconfigured', 503);
      throw e;
    }
  });
  r.post('/api/projects/:id/subscription/cancel', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    await cancelSubscription(ctx, req.params.id);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/subscription/resume', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    await resumeSubscription(ctx, req.params.id);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/domain', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    setDomain(ctx, req.params.id, b.mode === 'custom' ? 'custom' : 'subdomain', String(b.domain ?? ''));
    return view(req.params.id);
  });
  r.post('/api/projects/:id/domain/check', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    limit(req, 'dns', 10);
    await checkDomain(ctx, req.params.id);
    return view(req.params.id);
  });
  r.post('/api/projects/:id/cancel', (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const p = getProject(ctx, req.params.id);
    if (['paid', 'launching', 'live'].includes(p.status)) throw new UserError('Cancel your subscription from Billing instead.', 'invalid_state', 409);
    cancelProject(ctx, p.id, 'owner');
    return view(p.id);
  });

  // ---------- inquiries & support ----------
  r.get('/api/projects/:id/inquiries', (req) => {
    ownerSession(ctx, req, req.params.id);
    return ctx.db.all('SELECT * FROM inquiries WHERE project_id = ? ORDER BY created_at DESC LIMIT 200', req.params.id).map((i) => ({
      id: i.id, createdAt: i.created_at, name: i.name, phone: i.phone, email: i.email, service: i.service, area: i.area,
      propertyDetails: i.property_details, preferredTiming: i.preferred_timing, message: i.message, status: i.status, isSample: !!i.is_sample,
    }));
  });
  r.patch('/api/projects/:id/inquiries/:iid', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    if (!['new', 'read', 'contacted', 'closed'].includes(b.status)) throw new UserError('Invalid status.', 'invalid', 422);
    ctx.db.run('UPDATE inquiries SET status = ? WHERE id = ? AND project_id = ?', b.status, req.params.iid, req.params.id);
    return { ok: true };
  });
  r.get('/api/projects/:id/tickets', (req) => {
    ownerSession(ctx, req, req.params.id);
    return tickets(ctx, req.params.id);
  });
  r.post('/api/projects/:id/tickets', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    limit(req, 'ticket', 6);
    const b = await readJson(req);
    const subject = clampText(b.subject, 140);
    const body = clampText(b.body, 4000);
    if (body.length < 5) throw new UserError('Tell us a little more so we can help.', 'invalid', 422, 'body');
    const key = `t:${req.params.id}:${clampText(b.idempotencyKey, 80) || newId('k')}`;
    if (!ctx.db.get('SELECT 1 FROM tickets WHERE idempotency_key = ?', key)) {
      ctx.db.run('INSERT INTO tickets (id, project_id, subject, body, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId('tk'), req.params.id, subject || 'Question', body, 'open', key, now(), now());
    }
    return tickets(ctx, req.params.id);
  });
  r.post('/api/projects/:id/tickets/:tid/reply', async (req) => {
    requireMutation(req);
    ownerSession(ctx, req, req.params.id);
    const b = await readJson(req);
    const t = ctx.db.get('SELECT id FROM tickets WHERE id = ? AND project_id = ?', req.params.tid, req.params.id);
    if (!t) throw new UserError('Ticket not found.', 'not_found', 404);
    ctx.db.run('INSERT INTO ticket_replies (id, ticket_id, from_role, body, at) VALUES (?, ?, ?, ?, ?)', newId('tr'), t.id, 'owner', clampText(b.body, 4000), now());
    ctx.db.run(`UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?`, now(), t.id);
    return tickets(ctx, req.params.id);
  });

  // ---------- payments ----------
  r.post('/api/webhooks/payments', async (req) => {
    const raw = (await readBody(req, 512 * 1024)).toString('utf8');
    let evt;
    try {
      evt = ctx.adapters.payments.parseWebhook(raw, req.headers as any);
    } catch {
      throw new UserError('Invalid signature.', 'bad_signature', 400);
    }
    return { result: handlePaymentEvent(ctx, evt) };
  });
  r.get('/demo/checkout/:sid', (req, res) => {
    if (!ctx.demo) return html(res, 404, simplePage('Not found', '<p>Not found.</p>'));
    const cs = ctx.db.get('SELECT * FROM checkout_sessions WHERE id = ?', req.params.sid);
    if (!cs || !canAccessProject(ctx, getSession(ctx, req), cs.project_id)) return html(res, 404, simplePage('Not found', '<p>Checkout not found.</p>'));
    const p = getProject(ctx, cs.project_id);
    const name = String(factViews(ctx, p.id).find((f) => f.key === 'displayName')?.value ?? '');
    return html(res, 200, renderDemoCheckout({ sessionId: cs.id, status: cs.status, businessName: name, projectId: p.id }));
  });
  r.post('/demo/checkout/:sid', async (req, res) => {
    if (!ctx.demo) return html(res, 404, simplePage('Not found', '<p>Not found.</p>'));
    const cs = ctx.db.get('SELECT * FROM checkout_sessions WHERE id = ?', req.params.sid);
    if (!cs || !canAccessProject(ctx, getSession(ctx, req), cs.project_id)) return html(res, 404, simplePage('Not found', '<p>Checkout not found.</p>'));
    const form = await readForm(req);
    const outcome = form.get('outcome');
    const base = `/p/${cs.project_id}/launch`;
    if (outcome === 'cancel') return redirect(res, `${base}?checkout=cancelled`);
    if (cs.status !== 'open') return redirect(res, `${base}?checkout=returned`);
    // Build the event the provider would send, sign it, and run it through the same webhook verification path.
    const evt = outcome === 'success'
      ? { id: `demo_evt_${cs.id}_paid`, type: 'checkout.completed', projectId: cs.project_id, subscriptionId: `demo_sub_${cs.project_id}`, customerId: `demo_cus_${cs.project_id}`, periodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() }
      : { id: `demo_evt_${cs.id}_failed`, type: 'payment.failed', projectId: cs.project_id, message: 'Simulated card decline (demo).' };
    const raw = JSON.stringify(evt);
    const parsed = ctx.adapters.payments.parseWebhook(raw, { 'x-demo-signature': signDemoEvent(raw) });
    handlePaymentEvent(ctx, parsed);
    return redirect(res, `${base}?checkout=returned`);
  });

  // ---------- previews (owner/admin only, sandboxed) ----------
  r.get('/preview/:id/:variant/*', (req, res) => {
    const s = getSession(ctx, req);
    if (!canAccessProject(ctx, s, req.params.id)) return html(res, 403, simplePage('Private preview', '<p>This preview is private. <a href="/signin">Sign in</a> to view it.</p>'));
    const p = getProject(ctx, req.params.id);
    const variant = req.params.variant;
    let content: SiteContent | null = null;
    let scope: 'direction' | 'site' = 'direction';
    if (variant === 'a' || variant === 'b') {
      const cur = currentVersion(ctx, p.id);
      if (!cur) return html(res, 404, simplePage('Not ready', '<p>This preview isn’t ready yet.</p>'));
      content = { ...cur.content, variant };
      scope = p.chosen_variant === variant && ['site_ready', 'paid', 'launching', 'live'].includes(p.status) ? 'site' : 'direction';
    } else if (variant.startsWith('v_')) {
      const v = ctx.db.get('SELECT content_json FROM site_versions WHERE id = ? AND project_id = ?', variant.slice(2), p.id);
      if (!v) return html(res, 404, simplePage('Not found', '<p>Version not found.</p>'));
      content = pj<SiteContent>(v.content_json, null as any);
      if (p.chosen_variant) content = { ...content, variant: p.chosen_variant };
      scope = p.chosen_variant ? 'site' : 'direction';
    }
    if (!content) return html(res, 404, simplePage('Not found', '<p>Not found.</p>'));
    const page = (req.params['*'] ?? '').replace(/\/$/, '');
    const out = renderPage(content, {
      page, mode: 'preview', scope,
      link: (slug) => `/preview/${p.id}/${req.params.variant}/${slug}`,
      inquiryAction: '#',
      previewBanner: `Private preview${p.mode === 'demo' ? ' · demo data' : ''}${content.business.photos.length ? '' : ' · illustrations stand in for your photos'}`,
    });
    if (!out) return html(res, 404, simplePage('Not found', '<p>That page isn’t part of this site.</p>'));
    return html(res, 200, out, { 'content-security-policy': PREVIEW_CSP, 'x-robots-tag': 'noindex', 'x-frame-options': 'SAMEORIGIN' });
  });

  // ---------- hosted sites ----------
  r.get('/sites/:slug/*', (req, res) => serveSite(ctx, req, res, req.params.slug, (req.params['*'] ?? '').replace(/\/$/, '')));
  r.get('/sites/:slug', (_req, res) => redirect(res, `/sites/${_req.params.slug}/`, 301));
  r.post('/sites/:slug/inquiry', async (req, res) => {
    limit(req, 'inquiry', 5);
    const p = ctx.db.get(`SELECT id, status FROM projects WHERE live_slug = ?`, req.params.slug);
    if (!p || p.status !== 'live') return html(res, 404, simplePage('Not found', '<p>This site isn’t available.</p>'));
    const f = await readForm(req);
    if (f.get('website_url')) return html(res, 200, simplePage('Thanks', '<p>Thanks, your request was sent.</p>')); // honeypot
    const name = clampText(f.get('name'), 120);
    const phone = normalizePhone(f.get('phone') ?? '') ?? null;
    const email = isEmail(f.get('email') ?? '') ? String(f.get('email')).trim().toLowerCase() : null;
    if (name.length < 1 || (!phone && !email)) {
      return html(res, 422, simplePage('Almost there', '<p>Please add your name and a phone number or email so the business can reply.</p><p><a href="javascript:history.back()">Go back</a></p>'));
    }
    ctx.db.run(`INSERT INTO inquiries (id, project_id, created_at, name, phone, email, service, area, property_details, preferred_timing, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      newId('inq'), p.id, now(), name, phone, email, clampText(f.get('service'), 80) || null, clampText(f.get('area'), 120) || null,
      clampText(f.get('property_details'), 600) || null, clampText(f.get('preferred_timing'), 200) || null, clampText(f.get('message'), 2000) || null);
    return html(res, 200, simplePage('Request sent', `<p>Thanks, ${esc(name)}. Your request was sent. The business will contact you to confirm details and availability.</p><p><a href="/sites/${esc(req.params.slug)}/">Back to the site</a></p>`), { 'content-security-policy': LIVE_SITE_CSP });
  });

  r.get('/files/:pid/:file', (req, res) => {
    const a = ctx.db.get('SELECT a.*, p.status FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.project_id = ? AND a.path = ? AND a.deleted_at IS NULL', req.params.pid, `${req.params.pid}/${req.params.file}`);
    if (!a) return html(res, 404, 'Not found');
    const publicOk = a.status === 'live' && a.kind !== 'attachment';
    if (!publicOk && !canAccessProject(ctx, getSession(ctx, req), req.params.pid)) return html(res, 403, 'Private');
    const full = join(config.dataDir, 'uploads', a.path);
    if (!existsSync(full)) return html(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': a.mime, 'cache-control': publicOk ? 'public, max-age=86400' : 'private, max-age=3600', 'content-security-policy': "default-src 'none'; sandbox" });
    res.end(readFileSync(full));
  });
  r.get('/files/captures/:file', (req, res) => {
    if (!/^[a-z0-9-]+\.jpg$/.test(req.params.file)) return html(res, 404, 'Not found');
    const full = join(config.dataDir, 'uploads', 'captures', req.params.file);
    if (!existsSync(full)) return html(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
    res.end(readFileSync(full));
  });

  // ---------- admin ----------
  r.post('/api/admin/login', async (req, res) => {
    requireMutation(req);
    limit(req, 'admin-login', 5);
    const b = await readJson(req);
    if (!adminLogin(ctx, res, String(b.password ?? ''))) throw new UserError('Incorrect password.', 'forbidden', 403);
    return { ok: true };
  });
  r.post('/api/admin/demo-login', (req, res) => {
    requireMutation(req);
    if (!demoAdminLogin(ctx, res)) throw new UserError('Demo admin is only available in demo mode.', 'forbidden', 403);
    return { ok: true, demo: true };
  });
  r.get('/api/admin/queue', (req) => {
    adminOnly(ctx, req);
    const status = req.query.get('status');
    const rows = status
      ? ctx.db.all('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC LIMIT 200', status)
      : ctx.db.all(`SELECT * FROM projects WHERE status != 'draft' OR updated_at > ? ORDER BY updated_at DESC LIMIT 200`, new Date(Date.now() - 86400_000).toISOString());
    const counts = Object.fromEntries(ctx.db.all('SELECT status, COUNT(*) n FROM projects GROUP BY status').map((c) => [c.status, c.n]));
    const exceptions = {
      failedJobs: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE status = 'failed' AND type != 'notify'`)!.n,
      failedNotifications: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM notifications WHERE status = 'failed'`)!.n,
      openRequests: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM change_requests WHERE status IN ('received','in_progress')`)!.n,
      openTickets: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM tickets WHERE status = 'open'`)!.n,
      billingIssues: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM subscriptions WHERE status IN ('payment_failed','past_due')`)!.n,
      awaitingLaunchReview: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM projects WHERE status = 'paid' AND launch_reviewed_at IS NULL`)!.n,
    };
    return {
      counts, exceptions, settings: getSettings(ctx),
      projects: rows.map((p) => {
        const name = String(ctx.db.get(`SELECT value_json FROM owner_facts WHERE project_id = ? AND key = 'displayName'`, p.id)?.value_json ?? 'null');
        const cand = pj<any>(p.candidate_json, null);
        return {
          id: p.id, status: p.status, mode: p.mode, name: JSON.parse(name) ?? cand?.name ?? p.intake_query, city: cand?.city ?? null,
          updatedAt: p.updated_at, createdAt: p.created_at, manualInterventions: p.manual_interventions, adminMinutes: p.admin_minutes,
          openRequests: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM change_requests WHERE project_id = ? AND status IN ('received','in_progress')`, p.id)!.n,
          failedJobs: ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE project_id = ? AND status = 'failed'`, p.id)!.n,
        };
      }),
    };
  });
  r.get('/api/admin/projects/:id', (req) => {
    adminOnly(ctx, req);
    const id = req.params.id;
    const p = getProject(ctx, id);
    const contact = p.contact_id ? ctx.db.get('SELECT kind, destination, verified_at FROM contacts WHERE id = ?', p.contact_id) : null;
    return {
      view: projectView(ctx, id),
      review: pj(p.review_json, {}),
      reviewNeeded: { preview: p.status === 'in_review', launch: p.status === 'paid' && !p.launch_reviewed_at && getSettings(ctx).requireLaunchReview },
      contact: contact ? { kind: contact.kind, masked: contact.kind === 'email' ? maskEmail(contact.destination) : maskPhone(contact.destination), verified: !!contact.verified_at } : null,
      candidates: pj<any[]>(p.candidates_json, []).map(publicCandidate),
      snapshots: ctx.db.all('SELECT id, kind, label, url, status, fetched_at, summary_json, screenshot_path, error, is_sample FROM source_snapshots WHERE project_id = ? ORDER BY fetched_at', id)
        .map((s) => ({ ...s, summary: pj(s.summary_json, {}), summary_json: undefined })),
      jobs: ctx.db.all('SELECT id, type, status, attempts, max_attempts, error, created_at, finished_at FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50', id),
      events: ctx.db.all('SELECT * FROM job_events WHERE project_id = ? ORDER BY id DESC LIMIT 100', id),
      qa: pj(ctx.db.get(`SELECT qa_json FROM site_versions WHERE project_id = ? AND status = 'current'`, id)?.qa_json, []),
      tickets: tickets(ctx, id),
      notifications: ctx.db.all('SELECT id, channel, template, status, error, created_at FROM notifications WHERE project_id = ? ORDER BY created_at DESC', id),
      payments: ctx.db.all('SELECT id, type, received_at, outcome FROM payment_events WHERE project_id = ? ORDER BY received_at DESC', id),
      audit: ctx.db.all('SELECT actor, action, detail_json, at FROM audit_events WHERE project_id = ? ORDER BY id DESC LIMIT 60', id),
      costs: { costCents: p.cost_cents, adminMinutes: p.admin_minutes, manualInterventions: p.manual_interventions },
    };
  });
  const intervene = (id: string, action: string, detail: unknown = {}) => {
    ctx.db.run('UPDATE projects SET manual_interventions = manual_interventions + 1 WHERE id = ?', id);
    audit(ctx, id, 'admin', action, detail);
  };
  r.post('/api/admin/projects/:id/review', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    ctx.db.run('UPDATE projects SET review_json = ? WHERE id = ?', JSON.stringify(b.checklist ?? {}), req.params.id);
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/approve-preview', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const p = getProject(ctx, req.params.id);
    const checklist = pj<Record<string, boolean>>(p.review_json, {});
    if (REVIEW_ITEMS.some((k) => !checklist[k])) throw new UserError('Complete the review checklist first.', 'checklist', 422);
    if (p.status !== 'in_review') throw new UserError('This project isn’t waiting for review.', 'invalid_state', 409);
    ctx.db.run('UPDATE projects SET preview_approved_at = ? WHERE id = ?', now(), p.id);
    deliverPreview(ctx, p.id);
    intervene(p.id, 'preview_approved');
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/approve-launch', (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const p = getProject(ctx, req.params.id);
    ctx.db.run('UPDATE projects SET launch_reviewed_at = ? WHERE id = ?', now(), p.id);
    intervene(p.id, 'launch_reviewed');
    if (p.status === 'paid') enqueue(ctx, { projectId: p.id, type: 'launch', key: `launch:${p.id}:reviewed` });
    return { ok: true };
  });
  r.post('/api/admin/jobs/:jobId/retry', (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const job = ctx.db.get('SELECT * FROM jobs WHERE id = ?', req.params.jobId);
    if (!job) throw new UserError('Job not found.', 'not_found', 404);
    const p = getProject(ctx, job.project_id);
    if (p.status === 'failed') {
      if (job.type === 'build_site') transition(ctx, p.id, 'site_building', 'admin');
      else transition(ctx, p.id, 'queued', 'admin');
    }
    if (!retryJob(ctx, job.id)) throw new UserError('Only failed jobs can be retried.', 'invalid_state', 409);
    event(ctx, p.id, job.type === 'launch' ? 'launch' : 'gather', 'info', 'Our team restarted the step that failed.');
    intervene(p.id, 'job_retry', { jobId: job.id, type: job.type });
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/time', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    const m = Math.max(0, Math.min(600, Math.round(Number(b.minutes) || 0)));
    ctx.db.run('UPDATE projects SET admin_minutes = admin_minutes + ? WHERE id = ?', m, req.params.id);
    audit(ctx, req.params.id, 'admin', 'time_logged', { minutes: m });
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/change-requests/:cid/propose', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    proposeChange(ctx, req.params.id, req.params.cid, b.patch ?? {}, String(b.response ?? ''));
    intervene(req.params.id, 'change_proposed');
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/change-requests/:cid/status', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    if (!['in_progress', 'done', 'declined'].includes(b.status)) throw new UserError('Invalid status.', 'invalid', 422);
    teamUpdateRequest(ctx, req.params.id, req.params.cid, b.status, String(b.response ?? ''));
    intervene(req.params.id, 'change_status', { status: b.status });
    return { ok: true };
  });
  r.post('/api/admin/projects/:id/tickets/:tid/reply', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    const t = ctx.db.get('SELECT id FROM tickets WHERE id = ? AND project_id = ?', req.params.tid, req.params.id);
    if (!t) throw new UserError('Ticket not found.', 'not_found', 404);
    ctx.db.run('INSERT INTO ticket_replies (id, ticket_id, from_role, body, at) VALUES (?, ?, ?, ?, ?)', newId('tr'), t.id, 'team', clampText(b.body, 4000), now());
    ctx.db.run(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`, b.close ? 'closed' : 'answered', now(), t.id);
    intervene(req.params.id, 'ticket_reply');
    return { ok: true };
  });
  r.post('/api/admin/notifications/:nid/resend', (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const n = ctx.db.get('SELECT * FROM notifications WHERE id = ?', req.params.nid);
    if (!n || n.status !== 'failed') throw new UserError('Only failed notifications can be resent.', 'invalid_state', 409);
    ctx.db.run(`UPDATE notifications SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?`, now(), n.id);
    const pref = ctx.db.get('SELECT contact_id FROM notification_prefs WHERE project_id = ?', n.project_id);
    enqueue(ctx, { projectId: n.project_id, type: 'notify', key: `notify:${n.id}:resend:${Date.now()}`, payload: { notificationId: n.id, contactId: pref?.contact_id } });
    intervene(n.project_id, 'notification_resend');
    return { ok: true };
  });
  r.get('/api/admin/settings', (req) => {
    adminOnly(ctx, req);
    return getSettings(ctx);
  });
  r.post('/api/admin/settings', async (req) => {
    requireMutation(req);
    adminOnly(ctx, req);
    const b = await readJson(req);
    const patch: any = {};
    for (const k of ['requirePreviewReview', 'requireLaunchReview', 'pausedIntake']) if (typeof b[k] === 'boolean') patch[k] = b[k];
    for (const k of ['previewTargetBusinessDays', 'updateTurnaroundBusinessDays']) if (Number.isFinite(b[k])) patch[k] = Math.max(1, Math.min(14, Math.round(b[k])));
    audit(ctx, null, 'admin', 'settings', patch);
    return saveSettings(ctx, patch);
  });
  r.get('/api/admin/metrics', (req) => {
    adminOnly(ctx, req);
    const funnel = ctx.db.all('SELECT name, COUNT(DISTINCT project_id) n FROM analytics_events GROUP BY name');
    const launchTimes = ctx.db.all(`SELECT p.created_at, a.at FROM projects p JOIN analytics_events a ON a.project_id = p.id AND a.name = 'launched'`);
    const avgLaunchHours = launchTimes.length ? launchTimes.reduce((s, r) => s + (Date.parse(r.at) - Date.parse(r.created_at)), 0) / launchTimes.length / 3600_000 : null;
    const cost = ctx.db.get('SELECT COALESCE(SUM(cost_cents),0) c, COALESCE(SUM(admin_minutes),0) m, COALESCE(SUM(manual_interventions),0) i FROM projects')!;
    return { funnel: Object.fromEntries(funnel.map((f) => [f.name, f.n])), avgLaunchHours, providerCostCents: cost.c, adminMinutes: cost.m, manualInterventions: cost.i, costNote: ctx.demo ? 'Demo adapters report no provider cost.' : 'Provider costs are only counted where an adapter reports them.' };
  });

  return r;
}

function tickets(ctx: Ctx, projectId: string) {
  return ctx.db.all('SELECT * FROM tickets WHERE project_id = ? ORDER BY created_at DESC', projectId).map((t) => ({
    id: t.id, createdAt: t.created_at, subject: t.subject, body: t.body, status: t.status,
    replies: ctx.db.all('SELECT from_role, body, at FROM ticket_replies WHERE ticket_id = ? ORDER BY at', t.id).map((r) => ({ at: r.at, from: r.from_role, body: r.body })),
  }));
}

function me(ctx: Ctx, s: Session | null) {
  if (!s) return { signedIn: false, isAdmin: false, contact: null, projects: [] };
  const contact = s.contact_id ? ctx.db.get('SELECT kind, destination FROM contacts WHERE id = ?', s.contact_id) : null;
  const rows = ctx.db.all(`SELECT id FROM projects WHERE (session_id = ? OR (contact_id IS NOT NULL AND contact_id = ?)) AND status != 'cancelled' ORDER BY updated_at DESC LIMIT 20`, s.id, s.contact_id ?? '__none__');
  return {
    signedIn: !!s.contact_id,
    isAdmin: !!s.is_admin,
    contact: contact ? { kind: contact.kind, masked: contact.kind === 'email' ? maskEmail(contact.destination) : maskPhone(contact.destination) } : null,
    projects: rows.map((r) => {
      const v = projectView(ctx, r.id);
      return { id: v.id, name: v.businessName || v.intakeQuery, status: v.status, updatedAt: v.updatedAt };
    }),
  };
}

function serveSite(ctx: Ctx, _req: Req, res: Res, slug: string, page: string) {
  const p = ctx.db.get(`SELECT * FROM projects WHERE live_slug = ?`, slug);
  if (!p || p.status !== 'live') return html(res, 404, simplePage('Site not available', '<p>This website isn’t available.</p>'));
  const cur = currentVersion(ctx, p.id);
  if (!cur || !p.chosen_variant) return html(res, 404, simplePage('Site not available', '<p>This website isn’t available.</p>'));
  const content = { ...cur.content, variant: p.chosen_variant as Variant };
  if (!sitePages(content).some((x) => x.slug === page)) return html(res, 404, simplePage('Page not found', `<p>That page doesn’t exist. <a href="/sites/${esc(slug)}/">Go to the homepage</a>.</p>`));
  const out = renderPage(content, { page, mode: 'live', scope: 'site', link: (s) => `/sites/${slug}/${s}`, inquiryAction: `/sites/${slug}/inquiry` });
  return html(res, 200, out, { 'content-security-policy': LIVE_SITE_CSP, 'cache-control': 'public, max-age=60' });
}

export function hostSiteFor(ctx: Ctx, host: string): string | null {
  const domain = host.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  const d = ctx.db.get(`SELECT p.live_slug FROM domains d JOIN projects p ON p.id = d.project_id WHERE d.domain = ? AND d.status = 'verified' AND p.status = 'live'`, domain);
  return d?.live_slug ?? null;
}
export { serveSite };

export function simplePage(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:17px/1.6 system-ui,sans-serif;margin:0;background:#f7f5f0;color:#0b1b33}main{max-width:560px;margin:0 auto;padding:48px 20px}h1{font-size:28px}a{color:#1652f0}.btn{display:inline-block;background:#0b1b33;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

export function integrationStatus(ctx: Ctx) {
  const a = ctx.adapters;
  const pv = config.providers;
  return {
    lookup: ctx.demo ? 'demo' : pv.googlePlacesKey ? 'live (website + Google Places)' : 'live (website links only; Google Places not configured)',
    research: ctx.demo ? 'demo' : 'live (bounded website crawl)',
    screenshots: ctx.demo ? 'demo samples' : a.screenshots.available() ? 'live (Playwright, if Chromium is installed)' : 'off',
    notifications: ctx.demo ? 'simulated' : `${a.notify.supports('email') ? 'email ✓' : 'email ✗'} / ${a.notify.supports('sms') ? 'SMS ✓' : 'SMS ✗'}`,
    payments: ctx.demo ? 'simulated checkout' : pv.stripeSecretKey && pv.stripeWebhookSecret && pv.stripePriceId ? 'Stripe' : 'not configured',
    domains: ctx.demo ? 'simulated (no DNS check)' : 'live DNS lookups',
    publishing: ctx.demo ? 'demo hosting on this server' : `self-hosted at ${config.publicBaseUrl}`,
  };
}

export { OFFER };
