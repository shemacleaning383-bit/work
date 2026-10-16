// Validation helpers used by both the browser (instant feedback) and the
// server (authoritative). Deliberately lenient on formatting: we normalize,
// we don't fight the user's typing.

export type IdentifierKind = 'google_maps' | 'website' | 'name';

export interface ClassifiedIdentifier {
  kind: IdentifierKind;
  url?: string;
  name?: string;
  location?: string;
}

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|g\.page)$/i;

export function classifyIdentifier(raw: string): ClassifiedIdentifier | null {
  const input = raw.trim().replace(/\s+/g, ' ');
  if (input.length < 2 || input.length > 2048) return null;
  // Shared links often arrive with surrounding text ("Check us out https://...").
  const urlMatch = input.match(/\bhttps?:\/\/[^\s<>"']+/i);
  const candidate = urlMatch ? urlMatch[0] : input;
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(candidate) && !candidate.includes(' ');
  if (urlMatch || looksLikeDomain) {
    let u: URL;
    try {
      u = new URL(urlMatch ? candidate : `https://${candidate}`);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (GOOGLE_HOSTS.test(u.hostname) && (u.hostname.includes('goo.gl') || u.hostname === 'g.page' || u.pathname.startsWith('/maps') || u.searchParams.has('cid'))) {
      return { kind: 'google_maps', url: u.toString() };
    }
    return { kind: 'website', url: u.toString() };
  }
  // Name, optionally with a location after a comma or " in ".
  const m = input.match(/^(.*?)(?:,\s*|\s+in\s+)([^,]+(?:,\s*[A-Za-z .]+)?)$/i);
  if (m && m[1].trim().length >= 2) return { kind: 'name', name: m[1].trim(), location: m[2].trim() };
  return { kind: 'name', name: input };
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const d = digits.replace(/^\+/, '');
  if (/^1?\d{10}$/.test(d)) {
    const ten = d.length === 11 ? d.slice(1) : d;
    return `+1${ten}`;
  }
  if (digits.startsWith('+') && /^\d{8,15}$/.test(d)) return `+${d}`;
  return null;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim()) && raw.length <= 254;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export function maskPhone(e164: string): string {
  return `•••-•••-${e164.slice(-4)}`;
}

export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (d.length > 253) return null;
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

export function isHexColor(raw: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(raw);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'site';
}

export function clampText(s: unknown, max: number): string {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
