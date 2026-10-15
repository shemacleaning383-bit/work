// Deterministic quality checks on generated pages. Errors block delivery;
// warnings are shown to reviewers.
import type { SiteContent } from './sitegen.ts';

export interface QaResult {
  page: string;
  errors: string[];
  warnings: string[];
  bytes: number;
}

// Claims we never generate. Owner-written text is excluded before checking,
// because an owner may truthfully state these things about their business.
const CLAIMS = /\b(insured|bonded|licensed|certified|guarantee[ds]?|award[- ]winning|#1|number one|best in|top[- ]rated|\d+\+?\s+years|five[- ]star|5[- ]star|satisfaction)\b/i;

export function checkPage(c: SiteContent, page: string, html: string, privateContacts: string[]): QaResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/<meta name="viewport"/.test(html)) errors.push('Missing mobile viewport tag.');
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) errors.push('Page must have exactly one main heading.');
  if (!html.includes(escapeLite(c.business.name))) errors.push('Business name is missing from the page.');
  if (c.business.phone && !html.includes(`href="tel:${c.business.phone}"`)) errors.push('Phone number is not tappable.');
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) errors.push('An image is missing alt text.');
  if (/lorem ipsum/i.test(html)) errors.push('Placeholder text found.');
  for (const pc of privateContacts) {
    if (pc && html.toLowerCase().includes(pc.toLowerCase())) errors.push('A private notification contact appears on the public page.');
  }
  let text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const owned of c.ownerText) text = text.split(escapeLite(owned)).join('');
  const claim = text.replace(/<[^>]+>/g, ' ').match(CLAIMS);
  if (claim) errors.push(`Generated copy contains an unverified claim (“${claim[0]}”).`);
  if (/<form/.test(html) && !/name="name"/.test(html)) errors.push('Quote form is incomplete.');
  const bytes = Buffer.byteLength(html);
  if (bytes > 150_000) warnings.push(`Page is heavy (${Math.round(bytes / 1024)} KB of HTML).`);
  if (!c.business.photos.length) warnings.push('No owner photos yet; using illustrations.');
  if (!c.business.email) warnings.push('No public email address.');
  return { page, errors: [...new Set(errors)], warnings, bytes };
}

function escapeLite(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
