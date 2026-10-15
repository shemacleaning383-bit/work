// Central commercial configuration. Change the offer here; every screen,
// checkout session and generated document reads from this object.
// Server can override selected values with env vars (see server/config.ts).

export interface OfferConfig {
  planName: string;
  currency: 'CAD';
  monthlyPriceCents: number;
  setupFeeCents: number;
  maxPages: number;
  /** How taxes are handled at checkout. 'provider_automatic' = payment provider computes tax from billing address. */
  taxMode: 'provider_automatic' | 'not_configured';
  taxNote: string;
  renewalNote: string;
  cancellationNote: string;
  cancellationEffect: string;
  domainNote: string;
  included: string[];
  notIncluded: string[];
  /** Supported self-service edits — the honest list of what "edits" means. */
  selfServiceEdits: string[];
  /** Routine update requests handled by the team, with scope. */
  routineUpdates: string[];
  outOfScope: string[];
  /** Initial service targets; operations can change these as capacity changes. */
  previewTargetBusinessDays: number;
  updateTurnaroundBusinessDays: number;
  supportResponseBusinessDays: number;
  limits: {
    activeFreePreviewsPerContact: number;
    activeFreePreviewsPerBusiness: number;
    freeRegenerations: number;
    lookupsPerHourPerIp: number;
    photoUploadsPerProject: number;
    maxUploadBytes: number;
    openChangeRequestsPerProject: number;
  };
}

export const OFFER: OfferConfig = {
  planName: 'Blue Park Website',
  currency: 'CAD',
  monthlyPriceCents: 5900,
  setupFeeCents: 0,
  maxPages: 5,
  taxMode: 'provider_automatic',
  taxNote: 'Plus applicable sales tax (such as GST/HST), calculated at checkout from your billing address.',
  renewalNote: 'Renews automatically every month on the day you subscribe until you cancel.',
  cancellationNote: 'Cancel anytime from your dashboard. Cancellation takes effect at the end of the current paid month; no partial-month refunds.',
  cancellationEffect: 'When a subscription ends, we stop hosting the site and remove our DNS records from your setup instructions. Your domain stays yours. You can request a copy of your site text and the photos you uploaded.',
  domainNote: 'Domains are not included. You buy and renew your own domain with any registrar and keep full ownership. We help you connect it.',
  included: [
    'Up to 5 pages',
    'Hosting and SSL certificate',
    'Quote-request form that sends requests to your dashboard',
    'Mobile-first design with tap-to-call',
    'Supported self-service edits',
    'Routine update requests',
    'Help connecting a domain you own',
    'Email support',
  ],
  notIncluded: [
    'Domain purchase or renewal',
    'Business phone numbers',
    'Paid email inboxes',
    'Online booking or scheduling system',
    'Guaranteed leads, calls or search rankings',
  ],
  selfServiceEdits: [
    'Business name, description and contact details',
    'Services and service areas',
    'Photos and logo',
    'Accent colour',
    'Turning supported sections on or off',
  ],
  routineUpdates: [
    'Text and photo updates you describe in a request',
    'Adding or reorganizing a page within the 5-page limit',
    'Adding a new service or service area',
    'Small layout adjustments within your chosen design',
  ],
  outOfScope: [
    'Custom software, booking engines or online stores',
    'Writing long-form blog content',
    'Paid advertising management',
  ],
  previewTargetBusinessDays: 1,
  updateTurnaroundBusinessDays: 2,
  supportResponseBusinessDays: 1,
  limits: {
    activeFreePreviewsPerContact: 1,
    activeFreePreviewsPerBusiness: 1,
    freeRegenerations: 2,
    lookupsPerHourPerIp: 30,
    photoUploadsPerProject: 12,
    maxUploadBytes: 6 * 1024 * 1024,
    openChangeRequestsPerProject: 5,
  },
};

export function formatMoney(cents: number, currency = 'CAD'): string {
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return currency === 'CAD' ? `CA$${amount}` : `${amount} ${currency}`;
}

export function priceLine(o: OfferConfig = OFFER): string {
  return `${formatMoney(o.monthlyPriceCents, o.currency)}/month`;
}
