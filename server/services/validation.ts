import { UserError } from './projects.ts';

/** Accepts only http(s) URLs (no javascript:, data:, etc.) for links shown on generated sites. */
export function safeHttpUrl(raw: string, field: string): string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UserError('That link doesn’t look right.', 'invalid', 422, field);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UserError('Only web links are allowed.', 'invalid', 422, field);
  return u.toString();
}
