// Demo fixtures. Every business here is FICTIONAL. Phone numbers use the
// 555-01xx fictional range and domains use the reserved .example TLD.
// Ratings, screenshots and listings are sample data and are labeled as such.
import type { CandidateInternal, SourceResult } from '../server/adapters/types.ts';

const FOUND = '2026-10-01T14:05:00.000Z';

const sundayWebsite: SourceResult = {
  kind: 'website',
  label: 'Sample website (demo data)',
  url: 'https://sundaycleaning.example/',
  status: 'ok',
  isSample: true,
  screenshotPath: '/assets/demo/sunday-website.jpg',
  observations: {
    displayName: 'Sunday Cleaning',
    publicPhone: '+14165550142',
    publicEmail: 'hello@sundaycleaning.example',
    website: 'https://sundaycleaning.example/',
    city: 'Toronto',
    services: ['Recurring cleaning', 'Deep cleaning', 'Move-in / move-out cleaning'],
    areas: ['Toronto', 'East York', 'Leslieville', 'Riverdale'],
    description: 'Sunday Cleaning is a small Toronto team cleaning houses, condos and apartments.',
  },
};

const sundayGoogle: SourceResult = {
  kind: 'google',
  label: 'Sample Google listing (demo data)',
  url: 'https://maps.google.com/?cid=0000000000000000000',
  status: 'ok',
  isSample: true,
  observations: {
    displayName: 'Sunday Cleaning',
    publicPhone: '+14165550178', // deliberately different from website → conflict fixture
    city: 'Toronto',
    areas: ['Toronto', 'The Danforth'],
    hours: 'Mon–Sat 8 a.m.–6 p.m.',
  },
};

const sundayFacebook: SourceResult = {
  kind: 'social',
  label: 'Sample social page (demo data)',
  url: 'https://social.example/sundaycleaning',
  status: 'failed',
  error: 'Source did not respond (simulated timeout).',
  isSample: true,
  observations: {},
};

export const SUNDAY: CandidateInternal = {
  id: 'demo_sunday',
  businessKey: 'demo:sunday-cleaning-toronto',
  name: 'Sunday Cleaning',
  city: 'Toronto, ON',
  address: 'Serves East Toronto (service-area business)',
  phone: '+14165550142',
  website: 'https://sundaycleaning.example/',
  category: 'House cleaning service',
  sourceKind: 'website',
  sourceLabel: 'Sample website (demo data)',
  sourceUrl: 'https://sundaycleaning.example/',
  screenshotUrl: '/assets/demo/sunday-website.jpg',
  screenshotNote: 'Sample screenshot of a fictional website — demo data, not a real capture.',
  imageUrl: null,
  foundAt: FOUND,
  rating: { value: 4.8, count: 37, label: 'Sample rating — demo data' },
  isSample: true,
  confidence: 'exact',
  initialSource: sundayWebsite,
};

export const SUNDAY_RESEARCH: SourceResult[] = [sundayWebsite, sundayGoogle, sundayFacebook];

function sparkle(id: string, name: string, area: string, phone: string, distinguishing: string, website?: string): CandidateInternal {
  const src: SourceResult = {
    kind: 'google',
    label: 'Sample Google listing (demo data)',
    url: `https://maps.google.com/?cid=demo-${id}`,
    status: 'ok',
    isSample: true,
    observations: {
      displayName: name,
      publicPhone: phone,
      city: area,
      areas: [area],
      services: ['Recurring cleaning', 'Deep cleaning'],
      ...(website ? { website } : {}),
    },
  };
  return {
    id: `demo_${id}`,
    businessKey: `demo:${id}`,
    name,
    city: `${area}, ON`,
    address: `${area} (service-area business)`,
    phone,
    website,
    category: 'House cleaning service',
    sourceKind: 'google',
    sourceLabel: 'Sample Google listing (demo data)',
    sourceUrl: src.url,
    screenshotUrl: null,
    screenshotNote: 'No screenshot: we don’t capture Google pages. Showing the listing details instead.',
    foundAt: FOUND,
    rating: null,
    isSample: true,
    confidence: 'possible',
    distinguishing,
    initialSource: src,
  };
}

export const SPARKLE = [
  sparkle('sparkle_ny', 'Sparkle Clean Co.', 'North York', '+14165550111', 'Listed in North York · has a website', 'https://sparkleclean.example/'),
  sparkle('sparkle_eto', 'Sparkle Cleaning Services', 'Etobicoke', '+14165550123', 'Listed in Etobicoke · no website found'),
  sparkle('sparkle_sc', 'Sparkle & Shine Home Cleaning', 'Scarborough', '+14165550135', 'Listed in Scarborough · no website found'),
];

export const BRIGHTNEST: CandidateInternal = {
  id: 'demo_brightnest',
  businessKey: 'demo:brightnest',
  name: 'Bright Nest Cleaning',
  city: 'Mississauga, ON',
  phone: '+19055550164',
  website: 'https://brightnest.example/',
  category: 'Cleaning service',
  sourceKind: 'directory',
  sourceLabel: 'Sample directory listing (demo data)',
  sourceUrl: 'https://directory.example/brightnest',
  screenshotUrl: null,
  screenshotNote: 'Screenshot unavailable: the website did not respond when we tried to load it (simulated).',
  foundAt: FOUND,
  rating: null,
  isSample: true,
  confidence: 'likely',
  initialSource: {
    kind: 'directory',
    label: 'Sample directory listing (demo data)',
    url: 'https://directory.example/brightnest',
    status: 'ok',
    isSample: true,
    observations: {
      displayName: 'Bright Nest Cleaning',
      publicPhone: '+19055550164',
      city: 'Mississauga',
      website: 'https://brightnest.example/',
      areas: ['Mississauga', 'Oakville'],
    },
  },
};

export const BRIGHTNEST_RESEARCH: SourceResult[] = [
  BRIGHTNEST.initialSource,
  {
    kind: 'website',
    label: 'Sample website (demo data)',
    url: 'https://brightnest.example/',
    status: 'failed',
    error: 'The website did not respond within 8 seconds (simulated).',
    isSample: true,
    observations: {},
  },
];

export const MAPLE: CandidateInternal = {
  id: 'demo_maple',
  businessKey: 'demo:maple-fresh',
  name: 'Maple Fresh Cleaning',
  city: 'Markham, ON',
  phone: '+19055550188',
  category: 'House cleaning service',
  sourceKind: 'google',
  sourceLabel: 'Sample Google listing (demo data)',
  sourceUrl: 'https://maps.google.com/?cid=demo-maple',
  screenshotUrl: null,
  screenshotNote: 'No screenshot: we don’t capture Google pages. This business has no website on file.',
  foundAt: FOUND,
  rating: null,
  isSample: true,
  confidence: 'exact',
  initialSource: {
    kind: 'google',
    label: 'Sample Google listing (demo data)',
    url: 'https://maps.google.com/?cid=demo-maple',
    status: 'ok',
    isSample: true,
    observations: {
      displayName: 'Maple Fresh Cleaning',
      publicPhone: '+19055550188',
      city: 'Markham',
      areas: ['Markham', 'Richmond Hill'],
      services: ['Recurring cleaning', 'Apartment & condo cleaning'],
    },
  },
};

export const SAMPLE_INQUIRIES = [
  {
    name: 'Sample: Priya (demo)',
    phone: '+14165550190',
    email: 'priya@mail.example',
    service: 'Deep cleaning',
    area: 'Leslieville',
    property_details: '2-bedroom condo, 1 bathroom',
    preferred_timing: 'A weekday morning next week',
    message: 'Sample inquiry created for the demo. Not a real customer.',
  },
];

/** Demo rule: these destinations simulate a delivery failure. */
export function demoShouldFail(destination: string): boolean {
  return /fail/i.test(destination) || destination.endsWith('0199');
}
