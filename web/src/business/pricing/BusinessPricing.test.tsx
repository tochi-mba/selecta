// BZ-0441-04, -05: the business pricing page, its live total and the product boundary copy.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BOUNDARY_COPY, PRICING_COPY } from '../copy/pricing';
import BusinessPricing from './BusinessPricing';
import { isBusinessPricingPath, money, Pricing, quote } from './pricingTotal';

const PRICING: Pricing = {
  plan: 'business_venue_v1', currency: 'GBP',
  venue: { month: 7900, year: 79000 }, extra_zone: { month: 2500, year: 25000 }, extra_seat: { month: 500, year: 5000 },
  included_zones: 1, included_seats: 3, volume: { min_venues: 10, percent_off: 10 }, enterprise_min_venues: 25,
  trial: { days: 14, venues: 1, zones: 1, card_required: true }, currencies: ['GBP', 'USD', 'EUR'],
  sales_form: '/business/enterprise', vat: 'excluded',
};

describe('quote', () => {
  it('is one venue with its zone and seats included', () => {
    expect(quote(PRICING, 1, 1, 3, 'month')).toMatchObject({ extraZones: 0, extraSeats: 0, total: 7900 });
  });
  it('charges extra zones and seats beyond what each venue includes', () => {
    const q = quote(PRICING, 3, 5, 12, 'month');
    expect(q).toMatchObject({ extraZones: 2, extraSeats: 3, total: 3 * 7900 + 2 * 2500 + 3 * 500 });
  });
  it('takes 10% off from 10 venues with the server rounding', () => {
    const q = quote(PRICING, 12, 20, 40, 'year');
    const subtotal = 12 * 79000 + 8 * 25000 + 4 * 5000;
    expect(q).toMatchObject({ percentOff: 10, subtotal, discount: Math.floor(subtotal / 10), total: subtotal - Math.floor(subtotal / 10) });
  });
  it('sends 25 venues or more to sales rather than pricing them', () => {
    expect(quote(PRICING, 25, 25, 75, 'month').enterprise).toBe(true);
  });
  it('treats nonsense counts as zero', () => {
    const q = quote(PRICING, Number.NaN, -3, 1.7, 'month');
    expect(q).toMatchObject({ extraZones: 0, extraSeats: 1, lines: { venues: 0, zones: 0, seats: 500 } });
  });
  it('formats money and matches the page address', () => {
    expect(money(7900, 'GBP')).toBe('£79');
    expect(money(7950, 'EUR')).toBe('€79.50');
    expect(isBusinessPricingPath('/business/pricing/')).toBe(true);
    expect(isBusinessPricingPath('/business/pricing-x')).toBe(false);
  });
});

describe('BusinessPricing', () => {
  it('shows the price ex VAT, the boundary and a live total', async () => {
    const api = vi.fn().mockResolvedValue({ pricing: PRICING });
    render(<BusinessPricing api={api as never} onLeave={() => undefined} />);
    expect(await screen.findByTestId('pricing-venue')).toHaveTextContent('£79');
    expect(api).toHaveBeenCalledWith('/business/pricing?currency=GBP');
    expect(screen.getByText(PRICING_COPY.exVat)).toBeInTheDocument();
    for (const line of Object.values(BOUNDARY_COPY)) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByTestId('pricing-total')).toHaveTextContent('£79');
    fireEvent.change(screen.getByLabelText(PRICING_COPY.venues), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(PRICING_COPY.zones), { target: { value: '3' } });
    expect(screen.getByTestId('pricing-total')).toHaveTextContent('£183');
    fireEvent.change(screen.getByLabelText(PRICING_COPY.venues), { target: { value: '30' } });
    expect(screen.getByTestId('pricing-enterprise')).toHaveTextContent('Enterprise');
  });

  it('asks again in another currency and offers a retry when prices fail', async () => {
    const api = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ pricing: { ...PRICING, currency: 'USD' } });
    render(<BusinessPricing api={api as never} onLeave={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: PRICING_COPY.retry }));
    await waitFor(() => expect(screen.getByTestId('pricing-venue')).toHaveTextContent('$79'));
    fireEvent.change(screen.getByLabelText(PRICING_COPY.currency), { target: { value: 'EUR' } });
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/business/pricing?currency=EUR'));
  });
});
