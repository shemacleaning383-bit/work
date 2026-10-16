// Operational settings an admin can change at runtime (review gates, service targets).
import type { Ctx } from '../ctx.ts';
import { j, pj } from '../db.ts';
import { config } from '../config.ts';

export interface OpsSettings {
  requirePreviewReview: boolean;
  requireLaunchReview: boolean;
  previewTargetBusinessDays: number;
  updateTurnaroundBusinessDays: number;
  pausedIntake: boolean;
}

export function getSettings(ctx: Ctx): OpsSettings {
  const row = ctx.db.get('SELECT value_json FROM settings WHERE key = ?', 'ops');
  const stored = pj<Partial<OpsSettings>>(row?.value_json, {});
  return {
    requirePreviewReview: config.review.requirePreviewReview,
    requireLaunchReview: config.review.requireLaunchReview,
    previewTargetBusinessDays: config.offer.previewTargetBusinessDays,
    updateTurnaroundBusinessDays: config.offer.updateTurnaroundBusinessDays,
    pausedIntake: false,
    ...stored,
  };
}

export function saveSettings(ctx: Ctx, patch: Partial<OpsSettings>) {
  const next = { ...getSettings(ctx), ...patch };
  ctx.db.run('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', 'ops', j(next));
  return next;
}
