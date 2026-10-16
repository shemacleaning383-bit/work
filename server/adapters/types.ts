// Provider boundaries. Each adapter has a demo implementation (fixtures,
// clearly labeled, never contacts anyone) and a live implementation that is
// only used when its credentials are configured. Unconfigured live adapters
// report themselves as unavailable instead of falling back to fake data.
import type { Candidate, FactKey, SourceKind } from '../../shared/types.ts';
import type { ClassifiedIdentifier } from '../../shared/validate.ts';

export type Observations = Partial<Record<FactKey, unknown>>;

export interface SourceResult {
  kind: SourceKind;
  label: string;
  url?: string;
  status: 'ok' | 'failed' | 'unavailable';
  error?: string;
  observations: Observations;
  screenshotPath?: string | null;
  isSample: boolean;
}

export interface CandidateInternal extends Candidate {
  /** Stable key used to deduplicate businesses across projects (place id / domain / name+city). */
  businessKey: string;
  initialSource: SourceResult;
}

export interface LookupResult {
  status: 'matches' | 'needs_location' | 'none' | 'unavailable' | 'error';
  candidates: CandidateInternal[];
  message?: string;
}

export interface LookupAdapter {
  name: string;
  simulated: boolean;
  lookup(id: ClassifiedIdentifier): Promise<LookupResult>;
}

export interface ResearchResult {
  sources: SourceResult[];
  costCents: number;
}

export interface ResearchAdapter {
  name: string;
  simulated: boolean;
  research(c: CandidateInternal): Promise<ResearchResult>;
}

export interface ScreenshotAdapter {
  name: string;
  available(): boolean;
  /** Returns a public asset path for a real capture, or null if one cannot be taken. */
  capture(url: string): Promise<string | null>;
}

export interface OutboundMessage {
  channel: 'sms' | 'email';
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  status: 'simulated' | 'queued' | 'sent' | 'failed';
  provider: string;
  providerId?: string;
  error?: string;
}

export interface NotifyAdapter {
  name: string;
  simulated: boolean;
  supports(channel: 'sms' | 'email'): boolean;
  send(m: OutboundMessage): Promise<SendResult>;
}

export interface PaymentEvent {
  id: string;
  type: 'checkout.completed' | 'checkout.expired' | 'payment.failed' | 'invoice.paid' | 'subscription.updated' | 'subscription.deleted' | 'ignored';
  projectId: string | null;
  customerId?: string;
  subscriptionId?: string;
  periodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  status?: string;
  message?: string;
  raw: unknown;
}

export interface PaymentAdapter {
  name: 'stripe' | 'demo';
  simulated: boolean;
  createCheckout(args: { projectId: string; successUrl: string; cancelUrl: string; email?: string | null; idempotencyKey: string }): Promise<{ sessionId: string; url: string }>;
  /** Verify signature and normalize. Throws on bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentEvent;
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  resume(subscriptionId: string): Promise<void>;
}

export interface DnsCheck {
  type: string;
  host: string;
  expected: string;
  found: boolean | null;
  observed: string[];
}

export interface DomainAdapter {
  name: string;
  simulated: boolean;
  check(records: { type: string; host: string; value: string }[]): Promise<DnsCheck[]>;
}

export interface PublishAdapter {
  name: string;
  simulated: boolean;
  publish(args: { projectId: string; slug: string; domain: string | null; pages: Record<string, string> }): Promise<{ url: string }>;
  verify(url: string): Promise<boolean>;
  unpublish(slug: string): Promise<void>;
}

export interface Adapters {
  lookup: LookupAdapter;
  research: ResearchAdapter;
  screenshots: ScreenshotAdapter;
  notify: NotifyAdapter;
  payments: PaymentAdapter;
  domains: DomainAdapter;
  publish: PublishAdapter;
}
