import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Row = Record<string, any>;
type Param = string | number | bigint | null | Uint8Array;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, contact_id TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, destination TEXT NOT NULL,
  verified_at TEXT, opted_out_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(kind, destination)
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, destination TEXT NOT NULL, code_hash TEXT NOT NULL,
  project_id TEXT, session_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY, contact_id TEXT NOT NULL, project_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, session_id TEXT, contact_id TEXT, status TEXT NOT NULL, mode TEXT NOT NULL,
  intake_query TEXT NOT NULL DEFAULT '', intake_kind TEXT, candidates_json TEXT NOT NULL DEFAULT '[]',
  candidate_json TEXT, match_id TEXT, business_key TEXT, chosen_variant TEXT,
  build_no INTEGER NOT NULL DEFAULT 0, regenerations_used INTEGER NOT NULL DEFAULT 0,
  facts_confirmed_at TEXT, preview_approved_at TEXT, launch_approved_at TEXT, launch_reviewed_at TEXT,
  live_url TEXT, live_slug TEXT UNIQUE, needs_info_json TEXT NOT NULL DEFAULT '[]',
  review_json TEXT NOT NULL DEFAULT '{}', manual_interventions INTEGER NOT NULL DEFAULT 0,
  admin_minutes INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS projects_session ON projects(session_id);
CREATE INDEX IF NOT EXISTS projects_contact ON projects(contact_id);
CREATE INDEX IF NOT EXISTS projects_business ON projects(business_key);
CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, url TEXT,
  status TEXT NOT NULL, fetched_at TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}',
  screenshot_path TEXT, error TEXT, is_sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_project ON observations(project_id, match_id);
CREATE TABLE IF NOT EXISTS owner_facts (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL,
  value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, key)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  width INTEGER, height INTEGER, source TEXT NOT NULL, label TEXT, sha256 TEXT,
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, channel TEXT NOT NULL,
  contact_id TEXT, marketing_opt_in INTEGER NOT NULL DEFAULT 0, consent_text TEXT,
  consent_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, channel TEXT NOT NULL, destination TEXT NOT NULL,
  template TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, provider_id TEXT, error TEXT,
  idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT, locked_at TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_after);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, job_id TEXT, stage TEXT NOT NULL,
  level TEXT NOT NULL, message TEXT NOT NULL, internal TEXT, simulated INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_events_project ON job_events(project_id, id);
CREATE TABLE IF NOT EXISTS stage_state (
  project_id TEXT NOT NULL, stage TEXT NOT NULL, state TEXT NOT NULL, detail TEXT,
  updated_at TEXT NOT NULL, PRIMARY KEY(project_id, stage)
);
CREATE TABLE IF NOT EXISTS site_versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, content_json TEXT NOT NULL, reason TEXT NOT NULL, author TEXT NOT NULL,
  status TEXT NOT NULL, qa_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, message TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, response TEXT, proposed_version_id TEXT, attachment_asset_id TEXT, patch_json TEXT,
  idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  project_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider TEXT, provider_customer TEXT,
  provider_subscription TEXT, checkout_session_id TEXT, current_period_end TEXT, last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
  url TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, received_at TEXT NOT NULL,
  processed_at TEXT, outcome TEXT, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  project_id TEXT PRIMARY KEY, domain TEXT, mode TEXT NOT NULL, status TEXT NOT NULL,
  ssl_status TEXT NOT NULL, verify_token TEXT NOT NULL, last_checked_at TEXT,
  records_json TEXT NOT NULL DEFAULT '[]', note TEXT, simulated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, email TEXT, service TEXT, area TEXT, property_details TEXT, preferred_timing TEXT,
  message TEXT, status TEXT NOT NULL DEFAULT 'new', is_sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_replies (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, from_role TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}', at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, project_id TEXT, props_json TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value_json TEXT NOT NULL );
`;

export class Db {
  raw: DatabaseSync;
  private cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec(SCHEMA);
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }

  close() {
    this.raw.close();
  }
}

export function openDb(dataDir: string, filename = 'bluepark.sqlite'): Db {
  if (filename === ':memory:') return new Db(':memory:');
  mkdirSync(dataDir, { recursive: true });
  return new Db(join(dataDir, filename));
}

export const now = () => new Date().toISOString();
export const later = (ms: number) => new Date(Date.now() + ms).toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;
export const j = (v: unknown) => JSON.stringify(v ?? null);
export const pj = <T = any>(s: string | null | undefined, d: T): T => {
  if (s == null) return d;
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
