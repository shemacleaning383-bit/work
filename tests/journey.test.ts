// Full vertical journey through the HTTP API in demo mode:
// find → confirm → correct → notify → build → choose → preview → edit → subscribe → launch → dashboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { app = await startTestApp(); });
after(async () => { await app.close(); });

test('complete journey for the fictional Sunday Cleaning', async () => {
  const c = app.client();

  // Find
  const found = await c.post('/api/intake', { query: 'Sunday Cleaning' });
  assert.equal(found.status, 200);
  assert.equal(found.data.status, 'matches');
  assert.equal(found.data.candidates.length, 1);
  const cand = found.data.candidates[0];
  assert.equal(cand.isSample, true, 'demo candidates are labeled as sample data');
  assert.equal(cand.businessKey, undefined, 'internal fields are not exposed');
  const id = found.data.projectId;

  // Confirm
  let v = (await c.post(`/api/projects/${id}/confirm`, { candidateId: cand.id })).data;
  assert.equal(v.candidate.name, 'Sunday Cleaning');
  assert.equal(v.facts.find((f: any) => f.key === 'publicPhone').value, '+14165550142');

  // Correct details (owner wins)
  v = (await c.put(`/api/projects/${id}/details`, { facts: { displayName: 'Sunday Cleaning Co.', publicPhone: '(416) 555-0142', services: ['Deep cleaning', 'Recurring cleaning', 'Window cleaning'], areas: ['Toronto', 'Leslieville'], mainAction: 'quote' } })).data;
  assert.equal(v.facts.find((f: any) => f.key === 'displayName').value, 'Sunday Cleaning Co.');
  assert.equal(v.facts.find((f: any) => f.key === 'publicPhone').source, 'owner');

  // Notification: demo code is shown, nothing is sent
  const pref = await c.post(`/api/projects/${id}/notify-pref`, { channel: 'email', destination: 'owner@mail.example' });
  assert.equal(pref.data.delivery, 'simulated');
  assert.match(pref.data.demoCode, /^\d{6}$/);
  const bad = await c.post(`/api/projects/${id}/verify`, { channel: 'email', destination: 'owner@mail.example', code: '000000' === pref.data.demoCode ? '111111' : '000000' });
  assert.equal(bad.status, 422);
  v = (await c.post(`/api/projects/${id}/verify`, { channel: 'email', destination: 'owner@mail.example', code: pref.data.demoCode })).data;
  assert.equal(v.notification.verified, true);
  assert.equal(v.hasSavedAccess, true);
  assert.ok(!JSON.stringify(v).includes('owner@mail.example'), 'notification contact is masked');

  // Build (double tap → one build)
  await c.post(`/api/projects/${id}/build`);
  await c.post(`/api/projects/${id}/build`);
  const jobs = app.db.all(`SELECT * FROM jobs WHERE project_id = ? AND type = 'research'`, id);
  assert.equal(jobs.length, 1, 'repeated taps do not create duplicate jobs');
  await app.drain();
  v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'directions_ready');
  assert.equal(v.stages.find((s: any) => s.key === 'gather').state, 'partial', 'the failed social source is reported, not hidden');
  assert.ok(v.events.every((e: any) => e.simulated), 'demo events are labeled simulated');
  assert.equal(v.variants.length, 2);
  const phone = v.facts.find((f: any) => f.key === 'publicPhone');
  assert.equal(phone.source, 'owner', 'owner correction survives later research');
  assert.equal(phone.value, '+14165550142');
  assert.ok(phone.conflict?.values.some((x: any) => x.value === '+14165550178'), 'the differing listing phone is surfaced, not silently applied');
  const n = v.notifications.find((x: any) => x.template === 'preview_ready');
  assert.equal(n.status, 'simulated', 'demo never claims delivery');

  // Preview is private and sandboxed
  const pv = await c.get(`/preview/${id}/a/`);
  assert.equal(pv.status, 200);
  assert.match(pv.headers.get('content-security-policy')!, /sandbox/);
  assert.match(pv.data, /data-preview="1"/, 'preview forms are preview-only');
  assert.match(pv.data, /Sunday Cleaning Co\./);
  assert.doesNotMatch(pv.data, /owner@mail\.example/, 'private contact never appears on the site');
  const stranger = app.client();
  assert.equal((await stranger.get(`/preview/${id}/a/`)).status, 403);
  assert.equal((await stranger.get(`/api/projects/${id}`)).status, 403);

  // Choose design → full site
  await c.post(`/api/projects/${id}/choose`, { variant: 'b' });
  await app.drain();
  v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.status, 'site_ready');
  assert.ok(v.sitePages.length >= 4 && v.sitePages.length <= 5);
  assert.equal((await c.get(`/preview/${id}/b/contact`)).status, 200);

  // Edit + restore
  const before = v.siteVersions[0].id;
  v = (await c.post(`/api/projects/${id}/edit`, { facts: { accentColor: '#0f7a55' }, overrides: { heroSub: 'Careful home cleaning across East Toronto.' } })).data;
  assert.match(v.siteVersions[0].reason, /colour/);
  assert.match((await c.get(`/preview/${id}/b/`)).data, /Careful home cleaning across East Toronto/);
  v = (await c.post(`/api/projects/${id}/versions/${before}/restore`)).data;
  assert.match(v.siteVersions[0].reason, /Restored/);
  assert.doesNotMatch((await c.get(`/preview/${id}/b/`)).data, /Careful home cleaning across East Toronto/);

  // Change request idempotency
  const cr1 = await c.post(`/api/projects/${id}/change-requests`, { message: 'Please add a FAQ about pets.', idempotencyKey: 'k1' });
  const cr2 = await c.post(`/api/projects/${id}/change-requests`, { message: 'Please add a FAQ about pets.', idempotencyKey: 'k1' });
  assert.equal(cr1.data.id, cr2.data.id);
  assert.equal(cr2.data.duplicate, true);

  // Subscribe: approval required, failed then successful payment
  assert.equal((await c.post(`/api/projects/${id}/checkout`)).status, 422);
  await c.post(`/api/projects/${id}/approve-launch`, { factsConfirmed: true, launchApproved: true });
  const co = await c.post(`/api/projects/${id}/checkout`);
  assert.equal(co.status, 200);
  const co2 = await c.post(`/api/projects/${id}/checkout`);
  assert.equal(co2.data.url, co.data.url, 'repeated taps reuse the open checkout');
  const sid = co.data.url.split('/').pop().split('?')[0];
  const form = (outcome: string) => c.req('POST', `/demo/checkout/${sid}`, `outcome=${outcome}`, { 'content-type': 'application/x-www-form-urlencoded' });
  await form('fail');
  v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.subscription.status, 'payment_failed');
  assert.equal(v.status, 'site_ready');
  const co3 = await c.post(`/api/projects/${id}/checkout`);
  const sid3 = co3.data.url.split('/').pop().split('?')[0];
  assert.notEqual(sid3, sid);
  await c.req('POST', `/demo/checkout/${sid3}`, 'outcome=success', { 'content-type': 'application/x-www-form-urlencoded' });
  await app.drain();
  v = (await c.get(`/api/projects/${id}`)).data;
  assert.equal(v.subscription.status, 'active');
  assert.equal(v.subscription.simulated, true);
  assert.equal(v.status, 'live');
  assert.equal(v.liveIsSimulated, true);

  // Domain: pending in demo, never faked as verified
  v = (await c.post(`/api/projects/${id}/domain`, { mode: 'custom', domain: 'https://www.SundayCleaning.example/' })).data;
  assert.equal(v.domain.domain, 'sundaycleaning.example');
  v = (await c.post(`/api/projects/${id}/domain/check`)).data;
  assert.equal(v.domain.status, 'awaiting_dns');

  // Live site + inquiry → dashboard
  const site = await stranger.get(v.liveUrl);
  assert.equal(site.status, 200);
  assert.doesNotMatch(site.data, /data-preview/);
  const inq = await stranger.req('POST', `${v.liveUrl}inquiry`, 'name=Test+Person&phone=4165550100&service=Deep+cleaning&preferred_timing=Friday', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(inq.status, 200);
  const list = (await c.get(`/api/projects/${id}/inquiries`)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].preferredTiming, 'Friday');

  // Analytics never stores personal info
  const props = app.db.all('SELECT props_json FROM analytics_events').map((r) => r.props_json).join(' ');
  assert.doesNotMatch(props, /@|555/);
  const names = app.db.all('SELECT DISTINCT name FROM analytics_events').map((r) => r.name);
  for (const nme of ['intake_started', 'business_confirmed', 'preview_requested', 'preview_ready', 'design_chosen', 'checkout_started', 'subscribed', 'launched']) assert.ok(names.includes(nme), nme);
});
