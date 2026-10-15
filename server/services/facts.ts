// Facts = raw public observations (per source snapshot, per matched business)
// merged with owner-confirmed values. Owner values always win and are never
// overwritten by later research; disagreements are surfaced, not resolved silently.
import type { Ctx } from '../ctx.ts';
import { now, j, pj } from '../db.ts';
import type { FactKey, FactView } from '../../shared/types.ts';
import { formatPhone } from '../../shared/validate.ts';

export const ESSENTIAL: FactKey[] = ['displayName', 'services', 'areas', 'publicPhone', 'mainAction'];
const ARRAY_KEYS = new Set<FactKey>(['services', 'areas', 'otherLinks', 'photoAssetIds']);
const ALL_KEYS: FactKey[] = [
  'displayName', 'services', 'areas', 'publicPhone', 'publicEmail', 'preferredContact', 'mainAction',
  'description', 'differentiator', 'accentColor', 'bookingUrl', 'otherLinks', 'hours', 'showHours',
  'pricing', 'showPricing', 'website', 'city', 'logoAssetId', 'photoAssetIds', 'stylePreference',
];

interface Obs { value: unknown; label: string; url?: string; at: string; snapshotId: string }

function observations(ctx: Ctx, projectId: string, matchId: string | null): Map<string, Obs[]> {
  const out = new Map<string, Obs[]>();
  if (!matchId) return out;
  const rows = ctx.db.all(
    `SELECT o.key, o.value_json, o.observed_at, s.label, s.url, s.id AS sid FROM observations o
     JOIN source_snapshots s ON s.id = o.snapshot_id
     WHERE o.project_id = ? AND o.match_id = ? ORDER BY o.id`,
    projectId, matchId,
  );
  for (const r of rows) {
    const list = out.get(r.key) ?? [];
    list.push({ value: pj(r.value_json, null), label: r.label, url: r.url ?? undefined, at: r.observed_at, snapshotId: r.sid });
    out.set(r.key, list);
  }
  return out;
}

export function ownerFacts(ctx: Ctx, projectId: string): Map<string, { value: unknown; at: string }> {
  const m = new Map<string, { value: unknown; at: string }>();
  for (const r of ctx.db.all('SELECT key, value_json, updated_at FROM owner_facts WHERE project_id = ?', projectId)) {
    m.set(r.key, { value: pj(r.value_json, null), at: r.updated_at });
  }
  return m;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function factViews(ctx: Ctx, projectId: string): FactView[] {
  const p = ctx.db.get('SELECT match_id FROM projects WHERE id = ?', projectId);
  const obs = observations(ctx, projectId, p?.match_id ?? null);
  const own = ownerFacts(ctx, projectId);
  return ALL_KEYS.map((key): FactView => {
    const o = own.get(key);
    const list = obs.get(key) ?? [];
    if (ARRAY_KEYS.has(key) && !o) {
      const union: string[] = [];
      for (const ob of list) for (const v of (ob.value as string[]) ?? []) if (!union.includes(v)) union.push(v);
      return {
        key,
        value: union.length ? union : null,
        source: union.length ? 'public' : 'none',
        sourceLabel: list.map((l) => l.label).filter((v, i, a) => a.indexOf(v) === i).join(', ') || undefined,
        sourceUrl: list[0]?.url,
        observedAt: list[0]?.at,
        needsConfirmation: ESSENTIAL.includes(key),
        conflict: null,
      };
    }
    const distinct: Obs[] = [];
    for (const ob of list) if (ob.value != null && ob.value !== '' && !distinct.some((d) => same(d.value, ob.value))) distinct.push(ob);
    const value = o ? o.value : distinct[0]?.value ?? null;
    const disagreeing = distinct.filter((d) => !same(d.value, value));
    const conflict = !ARRAY_KEYS.has(key) && disagreeing.length > 0
      ? { values: [...(o ? [] : [distinct[0]]), ...disagreeing].map((d) => ({ value: d.value, sourceLabel: d.label, sourceUrl: d.url })) }
      : null;
    return {
      key,
      value,
      source: o ? 'owner' : distinct.length ? 'public' : 'none',
      sourceLabel: o ? 'You' : distinct[0]?.label,
      sourceUrl: o ? undefined : distinct[0]?.url,
      observedAt: o ? o.at : distinct[0]?.at,
      needsConfirmation: !o && (ESSENTIAL.includes(key) || !!conflict),
      conflict: o ? (conflict && conflict.values.length ? conflict : null) : conflict,
    };
  });
}

export function effectiveFacts(ctx: Ctx, projectId: string): Record<FactKey, any> {
  const out = {} as Record<FactKey, any>;
  for (const f of factViews(ctx, projectId)) out[f.key] = f.value;
  if (!out.mainAction) out.mainAction = 'quote';
  if (!out.preferredContact) out.preferredContact = 'phone';
  return out;
}

export function setOwnerFacts(ctx: Ctx, projectId: string, values: Partial<Record<FactKey, unknown>>) {
  ctx.db.tx(() => {
    for (const [k, v] of Object.entries(values)) {
      if (!ALL_KEYS.includes(k as FactKey)) continue;
      if (v === undefined) continue;
      ctx.db.run(
        `INSERT INTO owner_facts (project_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        projectId, k, j(v), now(),
      );
    }
  });
}

export function missingEssentials(facts: Record<FactKey, any>): string[] {
  const missing: string[] = [];
  if (!facts.displayName) missing.push('Business name');
  if (!facts.services || !facts.services.length) missing.push('At least one service');
  if (!facts.areas || !facts.areas.length) missing.push('At least one service area');
  if (!facts.publicPhone && !facts.publicEmail) missing.push('A public phone number or email for customers');
  return missing;
}

export function describeFact(key: FactKey, value: unknown): string {
  if (value == null) return '';
  if (key === 'publicPhone') return formatPhone(String(value));
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
