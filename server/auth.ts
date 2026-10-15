// Sessions, one-time codes, magic links and admin access.
// - Anonymous session cookie lets someone see a match and start a preview with no account.
// - Saved/private access requires verifying an email or phone with a one-time code.
// - Admin requires ADMIN_PASSWORD (live). The demo admin shortcut exists only in demo mode.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Ctx } from './ctx.ts';
import { now, later, newId } from './db.ts';
import { config } from './config.ts';
import { UserError } from './services/projects.ts';
import { normalizePhone, isEmail, maskEmail, maskPhone } from '../shared/validate.ts';
import { hashToken } from './services/notify.ts';

const COOKIE = 'bp_sid';
const SESSION_TTL = 30 * 86400_000;

export interface Session { id: string; contact_id: string | null; is_admin: number }

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function getSession(ctx: Ctx, req: IncomingMessage): Session | null {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length > 100) return null;
  const s = ctx.db.get<Session & { expires_at: string }>('SELECT * FROM sessions WHERE id = ?', sha(tok));
  if (!s || s.expires_at < now()) return null;
  return s;
}

function setCookie(res: ServerResponse, token: string, maxAgeMs: number) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createSession(ctx: Ctx, res: ServerResponse, contactId: string | null = null, isAdmin = false): Session {
  const token = randomBytes(32).toString('base64url');
  const id = sha(token);
  ctx.db.run('INSERT INTO sessions (id, contact_id, is_admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', id, contactId, isAdmin ? 1 : 0, now(), later(SESSION_TTL));
  setCookie(res, token, SESSION_TTL);
  return { id, contact_id: contactId, is_admin: isAdmin ? 1 : 0 };
}

export function ensureSession(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Session {
  return getSession(ctx, req) ?? createSession(ctx, res);
}

export function signOut(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const s = getSession(ctx, req);
  if (s) ctx.db.run('DELETE FROM sessions WHERE id = ?', s.id);
  setCookie(res, '', 0);
}

export function canAccessProject(ctx: Ctx, s: Session | null, projectId: string): boolean {
  if (!s) return false;
  if (s.is_admin) return true;
  const p = ctx.db.get('SELECT session_id, contact_id FROM projects WHERE id = ?', projectId);
  if (!p) return false;
  return p.session_id === s.id || (!!p.contact_id && p.contact_id === s.contact_id);
}

export function requireProject(ctx: Ctx, s: Session | null, projectId: string) {
  if (!canAccessProject(ctx, s, projectId)) throw new UserError('You don’t have access to this preview. Sign in with the email or phone you used.', 'forbidden', 403);
}

// ---------- one-time codes ----------
function codeHash(code: string, destination: string) {
  return createHmac('sha256', config.sessionSecret || 'dev').update(`${destination}:${code}`).digest('hex');
}

export function normalizeDestination(kind: 'sms' | 'email', raw: string): string {
  if (kind === 'email') {
    const e = String(raw ?? '').trim().toLowerCase();
    if (!isEmail(e)) throw new UserError('Please enter a valid email address.', 'invalid', 422, 'destination');
    return e;
  }
  const p = normalizePhone(String(raw ?? ''));
  if (!p) throw new UserError('Please enter a full mobile number, including area code.', 'invalid', 422, 'destination');
  return p;
}

export async function startOtp(ctx: Ctx, s: Session, kind: 'sms' | 'email', raw: string, purpose: 'save' | 'signin', projectId: string | null) {
  const destination = normalizeDestination(kind, raw);
  const recent = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM otp_codes WHERE destination = ? AND created_at > ?', destination, new Date(Date.now() - 3600_000).toISOString())!.n;
  if (recent >= 5) throw new UserError('Too many codes requested. Please wait a few minutes and try again.', 'rate_limited', 429);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  ctx.db.run('INSERT INTO otp_codes (id, kind, destination, code_hash, project_id, session_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('otp'), kind, destination, codeHash(code, destination), projectId, s.id, purpose, later(10 * 60_000), now());
  const masked = kind === 'email' ? maskEmail(destination) : maskPhone(destination);
  if (ctx.adapters.notify.simulated) {
    return { masked, delivery: 'simulated' as const, demoCode: code };
  }
  if (!ctx.adapters.notify.supports(kind)) throw new UserError(kind === 'sms' ? 'Text messages aren’t available yet. Please use email.' : 'Email isn’t available yet. Please use text.', 'channel_unavailable', 503);
  const r = await ctx.adapters.notify.send({ channel: kind, to: destination, subject: 'Your Blue Park code', text: `Your Blue Park code is ${code}. It expires in 10 minutes.` });
  if (r.status === 'failed') throw new UserError(`We couldn’t send a code to ${masked}. Check it and try again.`, 'send_failed', 502);
  return { masked, delivery: 'sent' as const, demoCode: null };
}

export function verifyOtp(ctx: Ctx, s: Session, kind: 'sms' | 'email', raw: string, code: string): { contactId: string; destination: string } {
  const destination = normalizeDestination(kind, raw);
  const row = ctx.db.get(`SELECT * FROM otp_codes WHERE destination = ? AND session_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, destination, s.id);
  if (!row || row.expires_at < now()) throw new UserError('That code has expired. Request a new one.', 'expired', 422, 'code');
  if (row.attempts >= 5) throw new UserError('Too many attempts. Request a new code.', 'locked', 429, 'code');
  ctx.db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
  const expected = Buffer.from(row.code_hash);
  const got = Buffer.from(codeHash(String(code ?? '').replace(/\D/g, ''), destination));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new UserError('That code isn’t right. Check it and try again.', 'wrong_code', 422, 'code');
  ctx.db.run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', now(), row.id);
  ctx.db.run('INSERT INTO contacts (id, kind, destination, verified_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, destination) DO UPDATE SET verified_at = excluded.verified_at',
    newId('ct'), kind, destination, now(), now());
  const contact = ctx.db.get('SELECT id FROM contacts WHERE kind = ? AND destination = ?', kind, destination)!;
  ctx.db.run('UPDATE sessions SET contact_id = ? WHERE id = ?', contact.id, s.id);
  return { contactId: contact.id, destination };
}

export function consumeMagicLink(ctx: Ctx, res: ServerResponse, token: string): string | null {
  const row = ctx.db.get('SELECT * FROM magic_links WHERE token_hash = ?', hashToken(token));
  if (!row || row.used_at || row.expires_at < now()) return null;
  ctx.db.run('UPDATE magic_links SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
  createSession(ctx, res, row.contact_id);
  return row.project_id;
}

export function adminLogin(ctx: Ctx, res: ServerResponse, password: string): boolean {
  if (!config.adminPassword) return false;
  const a = Buffer.from(sha(password));
  const b = Buffer.from(sha(config.adminPassword));
  if (!timingSafeEqual(a, b)) return false;
  createSession(ctx, res, null, true);
  return true;
}

export function demoAdminLogin(ctx: Ctx, res: ServerResponse): boolean {
  if (!ctx.demo) return false;
  createSession(ctx, res, null, true);
  return true;
}
