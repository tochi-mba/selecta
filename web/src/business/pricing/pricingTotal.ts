// The business price list and its live total (ADR-0441 BZ-0441-05). The figures come from
// `GET /api/business/pricing` (`plan_catalogue.pricing_view` on the server); this file only does
// the sums the server's `billing_catalogue.estimate` does, so the page and the server agree.

export type Interval = 'month' | 'year';
export type Currency = 'GBP' | 'USD' | 'EUR';

export type Pricing = {
  plan: string;
  currency: Currency;
  venue: Record<Interval, number>;
  extra_zone: Record<Interval, number>;
  extra_seat: Record<Interval, number>;
  included_zones: number;
  included_seats: number;
  volume: { min_venues: number; percent_off: number };
  enterprise_min_venues: number;
  trial: { days: number; venues: number; zones: number; card_required: boolean };
  currencies: Currency[];
  sales_form: string;
  vat: 'excluded';
};

export type Quote = {
  enterprise: boolean;
  extraZones: number;
  extraSeats: number;
  lines: { venues: number; zones: number; seats: number };
  subtotal: number;
  percentOff: number;
  discount: number;
  total: number;
};

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** One period's ex-VAT total for `venues` venues with `zones` zones and `seats` staff seats in
 * all (owners and admins are free, so they are not seats). Minor units. */
export function quote(p: Pricing, venues: number, zones: number, seats: number, interval: Interval): Quote {
  const v = whole(venues);
  const extraZones = Math.max(0, whole(zones) - v * p.included_zones);
  const extraSeats = Math.max(0, whole(seats) - v * p.included_seats);
  const enterprise = v >= p.enterprise_min_venues;
  const lines = {
    venues: v * p.venue[interval],
    zones: extraZones * p.extra_zone[interval],
    seats: extraSeats * p.extra_seat[interval],
  };
  const subtotal = lines.venues + lines.zones + lines.seats;
  const percentOff = !enterprise && v >= p.volume.min_venues ? p.volume.percent_off : 0;
  // Integer division like the server's `subtotal * off // 100`.
  const discount = Math.floor((subtotal * percentOff) / 100);
  return { enterprise, extraZones, extraSeats, lines, subtotal, percentOff, discount, total: subtotal - discount };
}

const SYMBOL: Record<Currency, string> = { GBP: '£', USD: '$', EUR: '€' };

/** 7900 GBP -> "£79", 7950 -> "£79.50". */
export function money(minor: number, currency: Currency): string {
  const units = minor / 100;
  const text = Number.isInteger(units) ? units.toLocaleString('en-GB') : units.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency]}${text}`;
}

export const BUSINESS_PRICING_PATH = '/business/pricing';

export function isBusinessPricingPath(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === BUSINESS_PRICING_PATH;
}
