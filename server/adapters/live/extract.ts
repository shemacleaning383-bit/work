// Extracts business facts from fetched HTML. Page content is untrusted data:
// we only pattern-match into short, clamped strings. Nothing from a page is
// ever executed or passed along as instructions.
import { SERVICE_CATALOG } from '../../../shared/types.ts';
import { normalizePhone, isEmail, clampText } from '../../../shared/validate.ts';
import type { Observations } from '../types.ts';
import { GTA_AREAS } from '../../../shared/areas.ts';

export { GTA_AREAS };

const SERVICE_PATTERNS: [string, RegExp][] = [
  ['Recurring cleaning', /\b(recurring|weekly|bi-?weekly|regular|maintenance)\s+clean/i],
  ['Deep cleaning', /\bdeep\s+clean/i],
  ['Move-in / move-out cleaning', /\bmove[\s-]?(in|out)\b/i],
  ['Apartment & condo cleaning', /\b(apartment|condo)s?\b[^.]{0,30}clean|clean[^.]{0,30}\b(apartment|condo)s?\b/i],
  ['Post-renovation cleaning', /\b(post[\s-]?(renovation|construction)|after\s+renovation)/i],
  ['Office cleaning', /\b(office|commercial)\s+clean/i],
  ['Airbnb turnover cleaning', /\b(airbnb|short[\s-]term rental|turnover)/i],
  ['Window cleaning', /\bwindow\s+clean/i],
];
void SERVICE_CATALOG;

export function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
}

export function visibleText(html: string): string {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? clampText(decodeEntities(content), 300) : null;
}

function jsonLdBusinesses(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const it of items) {
        const t = [].concat(it?.['@type'] ?? []).join(' ');
        if (/LocalBusiness|Organization|HouseCleaning|ProfessionalService|CleaningService/i.test(t)) out.push(it);
      }
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return out;
}

export function extractFacts(html: string, pageUrl: string): Observations {
  const obs: Observations = {};
  const text = visibleText(html).slice(0, 200_000);
  const ld = jsonLdBusinesses(html)[0];

  const ogName = meta(html, 'og:site_name');
  const title = clampText(decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 160);
  const name = clampText(ld?.name, 120) || ogName || title.split(/\s[|\-–—:]\s/)[0];
  if (name) obs.displayName = name;

  const phones = new Set<string>();
  if (ld?.telephone) {
    const p = normalizePhone(String(ld.telephone));
    if (p) phones.add(p);
  }
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const p = normalizePhone(decodeURIComponent(m[1]));
    if (p) phones.add(p);
  }
  if (phones.size === 0) {
    const m = text.match(/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
    const p = m ? normalizePhone(m[0]) : null;
    if (p) phones.add(p);
  }
  if (phones.size) obs.publicPhone = [...phones][0];

  const emails = new Set<string>();
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) if (isEmail(m[1])) emails.add(m[1].toLowerCase());
  if (ld?.email && isEmail(String(ld.email).replace(/^mailto:/, ''))) emails.add(String(ld.email).replace(/^mailto:/, '').toLowerCase());
  if (emails.size) obs.publicEmail = [...emails][0];

  const desc = meta(html, 'description') || meta(html, 'og:description') || clampText(ld?.description, 300);
  if (desc) obs.description = desc;

  const services = SERVICE_PATTERNS.filter(([, re]) => re.test(text)).map(([s]) => s);
  if (services.length) obs.services = services;

  const areas = GTA_AREAS.filter((a) => new RegExp(`\\b${a.replace(/ /g, '\\s+')}\\b`, 'i').test(text)).slice(0, 12);
  if (areas.length) obs.areas = areas;
  const city = clampText(ld?.address?.addressLocality, 80) || areas[0];
  if (city) obs.city = city;

  try {
    obs.website = new URL('/', pageUrl).toString();
  } catch {
    /* ignore */
  }
  return obs;
}

export function internalLinks(html: string, baseUrl: string, limit = 4): string[] {
  const base = new URL(baseUrl);
  const wanted = /(service|about|area|contact|pricing|faq)/i;
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
      if (!wanted.test(u.pathname)) continue;
      u.hash = '';
      const s = u.toString();
      if (!out.includes(s) && s !== base.toString()) out.push(s);
      if (out.length >= limit) break;
    } catch {
      /* ignore bad hrefs */
    }
  }
  return out;
}
