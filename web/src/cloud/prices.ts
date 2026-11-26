// The SelectaDJ plan prices, kept in one place so the landing page and the plan cards always say
// the same thing. Amounts are in pence and match the Stripe catalogue that setup_cloud_catalog.py
// creates (STRIPE_TEST_CATALOG: Standard 699 and 5900, Premium 1299 and 10900, in GBP).
// prices.test.ts reads that file and fails if the two ever drift apart.

export type PlanId = 'free' | 'standard' | 'premium';
export type PaidPlanId = Exclude<PlanId, 'free'>;

export type PlanPrice = {
  id: PlanId;
  name: string;
  /** Pence charged each month; 0 for Free. */
  monthPence: number;
  /** Pence charged each year on the yearly price; 0 for Free. */
  yearPence: number;
  /** The monthly price as the plan cards print it: "£6.99 / month". */
  month: string;
  /** The yearly price as the plan cards print it: "£59 / year". */
  year: string;
};

/** Pence as money: 699 is "£6.99", 5900 is "£59", 23 is "23p" and 0 is "£0". */
export function formatPence(pence: number): string {
  const whole = Math.round(pence);
  if (whole > 0 && whole < 100) return `${whole}p`;
  const pounds = whole / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

function plan(id: PlanId, name: string, monthPence: number, yearPence: number): PlanPrice {
  return {
    id,
    name,
    monthPence,
    yearPence,
    month: `${formatPence(monthPence)} / month`,
    year: `${formatPence(yearPence)} / year`,
  };
}

export const PLAN_PRICES: Readonly<Record<PlanId, PlanPrice>> = {
  free: plan('free', 'Free', 0, 0),
  standard: plan('standard', 'Standard', 699, 5900),
  premium: plan('premium', 'Premium', 1299, 10900),
};

/** The plans in the order they are shown: cheapest first. */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'standard', 'premium'];

/** What the monthly price comes to per day, averaged over a year (12 months over 365 days), in
 * whole pence: Standard is 23 and Premium 43. 0 for Free. */
export function perDayPence(price: PlanPrice): number {
  return Math.round((price.monthPence * 12) / 365);
}

/** The per-day figure in words ("about 23p a day"), always shown beside the monthly price and
 * never instead of it; null for Free, which costs nothing. */
export function perDayWords(price: PlanPrice): string | null {
  const pence = perDayPence(price);
  return pence > 0 ? `about ${formatPence(pence)} a day` : null;
}
