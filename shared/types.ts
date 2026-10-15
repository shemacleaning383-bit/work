// Types shared by server and browser. Only erasable TypeScript here (no enums),
// so the same file can be type-stripped for the browser.

export type Mode = 'demo' | 'live';

export type ProjectStatus =
  | 'draft'            // identifying / confirming business
  | 'queued'           // build requested, waiting for worker
  | 'researching'
  | 'building'
  | 'needs_info'
  | 'in_review'        // waiting for Blue Park review before delivery
  | 'directions_ready' // two homepage directions ready
  | 'site_building'    // full site being assembled after a choice
  | 'site_ready'       // full multi-page preview ready
  | 'paid'
  | 'launching'
  | 'live'
  | 'failed'
  | 'cancelled';

export const SERVICE_CATALOG = [
  'Recurring cleaning',
  'Deep cleaning',
  'Move-in / move-out cleaning',
  'Apartment & condo cleaning',
  'Post-renovation cleaning',
  'Office cleaning',
  'Airbnb turnover cleaning',
  'Window cleaning',
] as const;

export type SourceKind = 'google' | 'website' | 'directory' | 'social' | 'owner' | 'manual';

export interface Candidate {
  id: string;
  name: string;
  city: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceUrl?: string;
  /** Path to a real captured screenshot, or null when none is available. */
  screenshotUrl: string | null;
  screenshotNote: string;
  imageUrl?: string | null;
  imageCredit?: string;
  foundAt: string;
  rating?: { value: number; count: number; label: string } | null;
  isSample: boolean;
  confidence: 'exact' | 'likely' | 'possible';
  distinguishing?: string;
}

export type FactKey =
  | 'displayName' | 'services' | 'areas' | 'publicPhone' | 'publicEmail'
  | 'preferredContact' | 'mainAction' | 'description' | 'differentiator'
  | 'accentColor' | 'bookingUrl' | 'otherLinks' | 'hours' | 'showHours'
  | 'pricing' | 'showPricing' | 'website' | 'city' | 'logoAssetId' | 'photoAssetIds'
  | 'stylePreference';

export interface FactView {
  key: FactKey;
  value: unknown;
  source: 'owner' | 'public' | 'none';
  sourceLabel?: string;
  sourceUrl?: string;
  observedAt?: string;
  needsConfirmation: boolean;
  conflict?: { values: { value: unknown; sourceLabel: string; sourceUrl?: string }[] } | null;
}

export type StageKey = 'confirmed' | 'gather' | 'organize' | 'design' | 'qa' | 'ready';
export type StageState = 'done' | 'current' | 'upcoming' | 'failed' | 'waiting' | 'partial';

export interface StageView {
  key: StageKey;
  label: string;
  state: StageState;
  detail?: string;
}

export interface JobEventView {
  id: number;
  at: string;
  stage: StageKey | 'site' | 'launch' | 'edit';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  simulated: boolean;
}

export interface AssetView {
  id: string;
  url: string;
  kind: 'logo' | 'photo' | 'attachment';
  width?: number;
  height?: number;
  source: 'owner' | 'sample';
  label?: string;
}

export interface NotificationPref {
  channel: 'sms' | 'email' | 'none';
  destinationMasked: string | null;
  verified: boolean;
  marketingOptIn: boolean;
}

export interface NotificationView {
  id: string;
  channel: 'sms' | 'email';
  template: string;
  status: 'simulated' | 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';
  destinationMasked: string;
  createdAt: string;
  error?: string;
}

export interface DesignVariantView {
  key: 'a' | 'b';
  name: string;
  summary: string;
  previewUrl: string;
}

export interface SiteVersionView {
  id: string;
  number: number;
  createdAt: string;
  reason: string;
  author: 'system' | 'owner' | 'team';
  status: 'current' | 'previous' | 'proposed' | 'rejected';
}

export interface ChangeRequestView {
  id: string;
  createdAt: string;
  message: string;
  status: 'received' | 'in_progress' | 'proposed' | 'done' | 'declined';
  kind: 'self_service' | 'team';
  response?: string;
  proposedVersionId?: string | null;
  attachmentUrl?: string | null;
}

export interface SubscriptionView {
  status: 'none' | 'checkout_open' | 'payment_failed' | 'active' | 'past_due' | 'cancel_scheduled' | 'cancelled';
  currentPeriodEnd?: string | null;
  provider: 'stripe' | 'demo' | null;
  simulated: boolean;
  lastError?: string | null;
}

export interface DomainView {
  domain: string | null;
  mode: 'none' | 'subdomain' | 'custom';
  status: 'not_started' | 'awaiting_dns' | 'verifying' | 'verified' | 'failed';
  sslStatus: 'not_started' | 'pending' | 'ready' | 'unknown';
  records: { type: string; host: string; value: string; purpose: string; found: boolean | null }[];
  lastCheckedAt?: string | null;
  note?: string;
  simulated: boolean;
}

export interface InquiryView {
  id: string;
  createdAt: string;
  name: string;
  phone?: string;
  email?: string;
  service?: string;
  area?: string;
  propertyDetails?: string;
  preferredTiming?: string;
  message?: string;
  status: 'new' | 'read' | 'contacted' | 'closed';
  isSample: boolean;
}

export interface TicketView {
  id: string;
  createdAt: string;
  subject: string;
  body: string;
  status: 'open' | 'answered' | 'closed';
  replies: { at: string; from: 'owner' | 'team'; body: string }[];
}

export interface ProjectView {
  id: string;
  status: ProjectStatus;
  mode: Mode;
  businessName: string;
  city: string | null;
  candidate: Candidate | null;
  candidates: Candidate[];
  intakeQuery: string;
  facts: FactView[];
  stages: StageView[];
  events: JobEventView[];
  assets: AssetView[];
  notification: NotificationPref;
  notifications: NotificationView[];
  variants: DesignVariantView[];
  chosenVariant: 'a' | 'b' | null;
  sitePages: { slug: string; title: string }[];
  siteVersions: SiteVersionView[];
  changeRequests: ChangeRequestView[];
  subscription: SubscriptionView;
  domain: DomainView;
  liveUrl: string | null;
  liveIsSimulated: boolean;
  regenerationsLeft: number;
  needsInfo: string[];
  hasSavedAccess: boolean;
  launchApproved: boolean;
  updatedAt: string;
}

export interface ApiError { error: string; code: string; field?: string }
