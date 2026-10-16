import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startTestApp } from './helpers.ts';
import { isPrivateAddress, validateUrlShape, safeFetch } from '../server/security/ssrf.ts';
import { verifyStripeSignature } from '../server/adapters/live/index.ts';
import { canTransition } from '../server/services/projects.ts';
import { handlePaymentEvent } from '../server/services/billing.ts';
import { classifyIdentifier, normalizePhone, normalizeDomain } from '../shared/validate.ts';
import { buildContent, renderPage } from '../server/services/sitegen.ts';
import { checkPage } from '../server/services/quality.ts';
import { sniffImage, imageSize } from '../server/uploads.ts';

let app: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { app = await startTestApp(); });
after(async () => { await app.close(); });

async function readyProject(query = 'Sunday Cleaning', isolate = true) {
  const c = app.client();
  const r = await c.post('/api/intake', { query });
  const id = r.data.projectId;
  await c.post(`/api/projects/${id}/confirm`, { candidateId: r.data.candidates[0].id });
  // Tests share one database; retire earlier previews of the same fixture business so limits don't interfere.
  if (isolate) app.db.run(`UPDATE projects SET status = 'cancelled' WHERE id != ? AND business_key = (SELECT business_key FROM projects WHERE id = ?)`, id, id);
  return { c, id };
}

test('identifier classification accepts links, shared text and names', () => {
  assert.equal(classifyIdentifier('https://maps.app.goo.gl/abc123')?.kind, 'google_maps');
  assert.equal(classifyIdentifier('Check us out! https://www.google.com/maps/place/Sunday+Cleaning/@43,-79')?.kind, 'google_maps');
  assert.equal(classifyIdentifier('sundaycleaning.example')?.kind, 'website');
  assert.deepEqual(classifyIdentifier('Sparkle Clean, North York'), { kind: 'name', name: 'Sparkle Clean', location: 'North York' });
  assert.equal(classifyIdentifier('javascript:alert(1)')?.kind, 'name', 'non-web schemes are never treated as URLs');
  assert.equal(normalizePhone('(416) 555-0142'), '+14165550142');
  assert.equal(normalizePhone('555'), null);
  assert.equal(normalizeDomain('https://WWW.Example.ca/path'), 'example.ca');
  assert.equal(normalizeDomain('not a domain'), null);
});

test('SSRF guard blocks private, local and non-web destinations', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'])
    assert.ok(isPrivateAddress(a), a);
  assert.ok(!isPrivateAddress('8.8.8.8'));
  for (const u of ['file:///etc/passwd', 'ftp://x.com', 'http://localhost/', 'http://169.254.169.254/latest', 'http://user:pw@site.com', 'http://site.com:8080/', 'http://intranet/'])
    assert.throws(() => validateUrlShape(u), u);
  // A hostname that resolves to loopback is rejected at connect time (DNS-rebinding safe).
  await assert.rejects(safeFetch('http://localtest.me/'), /private|ENOTFOUND|EAI_AGAIN/);
});

test('Stripe webhook signature verification', () => {
  const body = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test'));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, 'other'));
  assert.ok(!verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_test'));
  assert.ok(!verifyStripeSignature(body, `t=${t - 3600},v1=${createHmac('sha256', 'whsec_test').update(`${t - 3600}.${body}`).digest('hex')}`, 'whsec_test'), 'old timestamps rejected');
});

test('state machine rejects illegal transitions', () => {
  assert.ok(canTransition('site_ready', 'paid'));
  assert.ok(!canTransition('draft', 'live'));
  assert.ok(!canTransition('directions_ready', 'paid'), 'cannot pay before a full site exists');
  assert.ok(!canTransition('cancelled', 'queued'));
});

test('authorization: other sessions cannot read or change a project', async () => {
  const { id } = await readyProject();
  const stranger = app.client();
  await stranger.get('/');
  for (const [m, p] of [['GET', `/api/projects/${id}`], ['POST', `/api/projects/${id}/build`], ['PUT', `/api/projects/${id}/details`], ['GET', `/api/projects/${id}/inquiries`], ['POST', `/api/projects/${id}/checkout`]] as const) {
    const r = await stranger.req(m, p, m === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  const admin = await stranger.get('/api/admin/queue');
  assert.equal(admin.status, 403);
});

test('CSRF: mutations require the custom header', async () => {
  const c = app.client();
  const r = await fetch(`${app.base}/api/intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Sunday Cleaning' }) });
  assert.equal(r.status, 403);
  void c;
});

test('wrong match is reversible and leaks no facts into the next match', async () => {
  const c = app.client();
  const r = await c.post('/api/intake', { query: 'Sparkle Clean', location: 'Toronto' });
  assert.equal(r.data.candidates.length, 3, 'similar names shown as distinct candidates');
  const id = r.data.projectId;
  await c.post(`/api/projects/${id}/confirm`, { candidateId: r.data.candidates[0].id });
  await c.put(`/api/projects/${id}/details`, { facts: { differentiator: 'Owner text for the wrong business' } });
  await c.post(`/api/projects/${id}/reject`);
  const again = await c.post('/api/intake', { query: 'Maple Fresh', projectId: id });
  assert.equal(again.data.projectId, id, 'same draft project is reused');
  const v = (await c.post(`/api/projects/${id}/confirm`, { candidateId: again.data.candidates[0].id })).data;
  assert.equal(v.candidate.name, 'Maple Fresh Cleaning');
  const all = JSON.stringify(v.facts);
  assert.doesNotMatch(all, /Sparkle|0111|Owner text for the wrong/);
});

test('ambiguous name asks for location; no-website business still works', async () => {
  const c = app.client();
  const r = await c.post('/api/intake', { query: 'Sparkle Clean' });
  assert.equal(r.data.status, 'needs_location');
  const m = await c.post('/api/intake', { query: 'Maple Fresh' });
  assert.equal(m.data.candidates[0].website, undefined);
  assert.equal(m.data.candidates[0].screenshotUrl, null, 'no fabricated screenshot');
});

test('inaccessible source: partial failure recorded, build continues with verified data', async () => {
  const { c, id } = await readyProject('brightnest.example');
  await c.put(`/api/projects/${id}/details`, { facts: { services: ['Deep cleaning'] } });
  await c.post(`/api/projects/${id}/build`);
  await app.drain();
  const v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'directions_ready');
  assert.equal(v.stages.find((s: any) => s.key === 'gather').state, 'partial');
  assert.ok(v.events.some((e: any) => e.level === 'warn' && /Couldn’t read/.test(e.message)));
  assert.ok(!JSON.stringify(v.events).includes('8 seconds'), 'provider internals are not shown to customers');
});

test('missing essentials → needs_info; owner adds info → build resumes', async () => {
  const c = app.client();
  const v0 = (await c.post('/api/projects/new/manual', { name: 'Fresh Start Cleaning', city: 'Ajax' })).data;
  const id = v0.id;
  const blocked = await c.post(`/api/projects/${id}/build`);
  assert.equal(blocked.status, 422);
  assert.match(blocked.data.error, /service/);
  await c.put(`/api/projects/${id}/details`, { facts: { services: ['Recurring cleaning'], publicPhone: '905 555 0101' } });
  await c.post(`/api/projects/${id}/build`);
  await app.drain();
  assert.equal((await c.get(`/api/projects/${id}`)).data.status, 'directions_ready');
});

test('free preview limits: one active preview per session and per business', async () => {
  const { c, id } = await readyProject('Sunday Cleaning');
  await c.post(`/api/projects/${id}/build`);
  // Same session, another business
  const r2 = await c.post('/api/intake', { query: 'Maple Fresh' });
  await c.post(`/api/projects/${r2.data.projectId}/confirm`, { candidateId: r2.data.candidates[0].id });
  const second = await c.post(`/api/projects/${r2.data.projectId}/build`);
  assert.equal(second.status, 429);
  // Different session, same business
  const other = await readyProject('Sunday Cleaning', false);
  const dup = await other.c.post(`/api/projects/${other.id}/build`);
  assert.equal(dup.status, 429);
  assert.equal(dup.data.code, 'limit_business');
  await app.drain();
});

test('notification failure is recorded and never reported as delivered', async () => {
  const { c, id } = await readyProject('Maple Fresh');
  const pref = await c.post(`/api/projects/${id}/notify-pref`, { channel: 'sms', destination: '416-555-0199' });
  await c.post(`/api/projects/${id}/verify`, { channel: 'sms', destination: '416-555-0199', code: pref.data.demoCode });
  await c.post(`/api/projects/${id}/build`);
  await app.drain();
  const v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'directions_ready', 'a failed message does not fail the build');
  const n = v.notifications[0];
  assert.equal(n.status, 'failed');
  assert.equal(n.destinationMasked, '•••-•••-0199');
});

test('payment webhook idempotency and failure handling', async () => {
  const { c, id } = await readyProject('Sunday Cleaning');
  void c;
  app.db.run(`UPDATE projects SET status = 'site_ready', chosen_variant = 'a', launch_approved_at = ? WHERE id = ?`, new Date().toISOString(), id);
  const evt = { id: `evt_${id}`, type: 'checkout.completed' as const, projectId: id, subscriptionId: 'sub_1', raw: {} };
  assert.equal(handlePaymentEvent(app.ctx, evt), 'processed');
  assert.equal(handlePaymentEvent(app.ctx, evt), 'duplicate');
  assert.equal(app.db.all(`SELECT * FROM jobs WHERE project_id = ? AND type = 'launch'`, id).length, 1, 'duplicate delivery does not launch twice');
  assert.equal(handlePaymentEvent(app.ctx, { id: 'evt_unknown', type: 'checkout.completed', projectId: 'prj_nope', raw: {} }), 'ignored');
  // Forged webhook
  const forged = await fetch(`${app.base}/api/webhooks/payments`, { method: 'POST', headers: { 'x-demo-signature': 'bad' }, body: JSON.stringify(evt) });
  assert.equal(forged.status, 400);
});

test('owner corrections are never overwritten by later research', async () => {
  const { c, id } = await readyProject('Sunday Cleaning');
  await c.put(`/api/projects/${id}/details`, { facts: { publicPhone: '647 555 0123', areas: ['Leslieville'] } });
  // Run research twice (e.g. regenerate) — owner values must stay.
  app.db.run(`UPDATE projects SET status = 'draft', business_key = 'k-' || id WHERE id = ?`, id);
  await c.post(`/api/projects/${id}/build`);
  await app.drain();
  const v = (await c.get(`/api/projects/${id}`)).data;
  const phone = v.facts.find((f: any) => f.key === 'publicPhone');
  assert.equal(phone.value, '+16475550123');
  assert.equal(phone.source, 'owner');
  assert.deepEqual(v.facts.find((f: any) => f.key === 'areas').value, ['Leslieville']);
});

test('preview review gate holds delivery until an admin approves with a full checklist', async () => {
  const { c, id } = await readyProject('Maple Fresh');
  const admin = app.client();
  await admin.post('/api/admin/demo-login');
  await admin.post('/api/admin/settings', { requirePreviewReview: true });
  await c.post(`/api/projects/${id}/build`);
  await app.drain();
  assert.equal((await c.get(`/api/projects/${id}`)).data.status, 'in_review');
  assert.equal((await admin.post(`/api/admin/projects/${id}/approve-preview`)).status, 422);
  await admin.post(`/api/admin/projects/${id}/review`, { checklist: { identity: true, claims: true, contact: true, mobile: true, assets: true } });
  assert.equal((await admin.post(`/api/admin/projects/${id}/approve-preview`)).status, 200);
  assert.equal((await c.get(`/api/projects/${id}`)).data.status, 'directions_ready');
  await admin.post('/api/admin/settings', { requirePreviewReview: false });
});

test('failed stage can be retried in place without a full rebuild', async () => {
  const { c, id } = await readyProject('Maple Fresh');
  const original = app.ctx.adapters.research.research;
  app.ctx.adapters.research.research = async () => { throw new Error('provider down'); };
  await c.post(`/api/projects/${id}/build`);
  for (let i = 0; i < 4; i++) {
    app.db.run(`UPDATE jobs SET run_after = ? WHERE project_id = ?`, new Date(0).toISOString(), id);
    await app.drain();
  }
  let v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'failed');
  assert.ok(!JSON.stringify(v.events).includes('provider down'), 'internal error text is admin-only');
  app.ctx.adapters.research.research = original;
  const admin = app.client();
  await admin.post('/api/admin/demo-login');
  const job = app.db.get(`SELECT id FROM jobs WHERE project_id = ? AND status = 'failed'`, id)!;
  assert.equal((await admin.post(`/api/admin/jobs/${job.id}/retry`)).status, 200);
  await app.drain();
  v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'directions_ready');
  assert.equal(app.db.all(`SELECT * FROM jobs WHERE project_id = ? AND type = 'research'`, id).length, 1, 'retried the same job, no duplicate');
});

test('generated copy never contains unverified claims; QA catches them', () => {
  const facts: any = { displayName: 'Test Co', services: ['Deep cleaning', 'Some custom thing'], areas: ['Toronto'], publicPhone: '+14165550100', city: 'Toronto' };
  for (const variant of ['a', 'b'] as const) {
    const c = buildContent(facts, { variant, assets: [], ownerKeys: new Set() });
    for (const page of ['', 'services', 'areas', 'contact']) {
      const html = renderPage(c, { page, mode: 'live', scope: 'site', link: (s) => `/${s}`, inquiryAction: '/x' });
      if (!html) continue;
      const qa = checkPage(c, page, html, ['owner-private@mail.example']);
      assert.deepEqual(qa.errors, [], `${variant}:${page} ${qa.errors.join(';')}`);
    }
  }
  const c = buildContent(facts, { variant: 'a', assets: [], ownerKeys: new Set(), overrides: { heroTitle: 'Fully insured, 10 years experience' } });
  const html = renderPage(c, { page: '', mode: 'live', scope: 'site', link: (s) => `/${s}`, inquiryAction: '/x' });
  assert.ok(checkPage(c, '', html, []).errors.some((e) => /unverified claim/.test(e)));
  const leak = renderPage({ ...c, business: { ...c.business, email: 'owner-private@mail.example' } }, { page: 'contact', mode: 'live', scope: 'site', link: (s) => `/${s}`, inquiryAction: '/x' });
  assert.ok(checkPage(c, 'contact', leak, ['owner-private@mail.example']).errors.some((e) => /private/.test(e)));
});

test('uploads: magic-byte sniffing rejects disguised files', async () => {
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?>')), null);
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000010000000080806000000', 'hex');
  assert.deepEqual(sniffImage(png), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(imageSize(png, 'image/png'), { width: 16, height: 8 });
  const { c, id } = await readyProject('Maple Fresh');
  const bad = await c.req('POST', `/api/projects/${id}/assets?kind=photo`, '<svg onload=alert(1)>', { 'content-type': 'image/jpeg' });
  assert.equal(bad.status, 415);
});

test('magic link is single-use and expires', async () => {
  const { c, id } = await readyProject('Maple Fresh');
  const pref = await c.post(`/api/projects/${id}/notify-pref`, { channel: 'email', destination: 'a@mail.example' });
  await c.post(`/api/projects/${id}/verify`, { channel: 'email', destination: 'a@mail.example', code: pref.data.demoCode });
  const contact = app.db.get('SELECT contact_id FROM projects WHERE id = ?', id)!.contact_id;
  const { createMagicLink } = await import('../server/services/notify.ts');
  const link = createMagicLink(app.ctx, contact, id);
  const other = app.client();
  const first = await other.get(new URL(link).pathname);
  assert.equal(first.status, 303);
  assert.equal((await other.get(`/api/projects/${id}`)).status, 200, 'magic link grants access on a new device');
  const again = await app.client().get(new URL(link).pathname);
  assert.equal(again.status, 410);
});

test('live mode without credentials reports unavailable instead of using fixtures', async () => {
  const live = await startTestApp({ mode: 'live' });
  try {
  const c = live.client();
  const r = await c.post('/api/intake', { query: 'Sunday Cleaning, Toronto' });
  assert.equal(r.data.status, 'unavailable');
  assert.equal(r.data.candidates.length, 0);
  const cfg = (await c.get('/api/config')).data;
  assert.equal(cfg.integrations.payments, 'not configured');
  assert.equal((await c.post('/api/admin/demo-login')).status, 403, 'no demo admin in live mode');
  } finally {
    await live.close();
  }
});
