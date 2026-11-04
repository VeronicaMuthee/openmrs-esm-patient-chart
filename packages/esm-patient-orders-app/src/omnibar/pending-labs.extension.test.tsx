import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Order, usePatientOrders } from '@openmrs/esm-patient-common-lib';
import { mockPatient } from 'tools';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import PendingLabsOmnibarProvider, { asksForPendingLabs, pendingLabOrders } from './pending-labs.extension';

const mockUsePatientOrders = vi.fn();

vi.mock('@openmrs/esm-patient-common-lib', async (importOriginal) => ({
  ...(await importOriginal()),
  usePatientOrders: (...args: Parameters<typeof usePatientOrders>) => mockUsePatientOrders(...args),
}));

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };
const underPending: OmnibarContext = { ...chartContext, command: { id: 'pending' } };
const ordersPage = { type: 'navigate', to: `\${openmrsSpaBase}/patient/${patientUuid}/chart/orders` };

function labOrder(overrides: Partial<Order>): Order {
  return {
    uuid: 'order',
    type: 'testorder',
    display: 'Complete blood count',
    concept: { display: 'Complete blood count' },
    dateActivated: '2026-09-29T10:00:00.000+0000',
    urgency: 'ROUTINE',
    fulfillerStatus: null,
    ...overrides,
  } as Order;
}

function reportFor(query: string, context: OmnibarContext = underPending) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<PendingLabsOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

describe('asksForPendingLabs', () => {
  it.each([
    ['', true, true],
    ['labs', true, true],
    ['lab orders', true, true],
    ['tests', true, true],
    ['meds', true, false],
    ['pending labs', false, true],
    ['unfilled lab orders', false, true],
    ['outstanding tests', false, true],
    ['labs', false, false],
    ['pending', false, false],
    ['', false, false],
  ])('reads %j (under /pending: %s) as %s', (query, underPendingCommand, expected) => {
    expect(asksForPendingLabs(query, underPendingCommand)).toBe(expected);
  });
});

describe('pendingLabOrders', () => {
  it('keeps lab orders the lab has not completed or declined', () => {
    const orders = [
      labOrder({ uuid: 'none', fulfillerStatus: null }),
      labOrder({ uuid: 'received', fulfillerStatus: 'RECEIVED' }),
      labOrder({ uuid: 'in-progress', fulfillerStatus: 'IN_PROGRESS' }),
      labOrder({ uuid: 'on-hold', fulfillerStatus: 'ON_HOLD' }),
      labOrder({ uuid: 'exception', fulfillerStatus: 'EXCEPTION' }),
      labOrder({ uuid: 'completed', fulfillerStatus: 'COMPLETED' }),
      labOrder({ uuid: 'declined', fulfillerStatus: 'DECLINED' }),
      labOrder({ uuid: 'drug', type: 'drugorder' }),
    ];

    expect(pendingLabOrders(orders).map((order) => order.uuid)).toEqual([
      'none',
      'received',
      'in-progress',
      'on-hold',
      'exception',
    ]);
  });

  it('puts STAT orders first, then the oldest', () => {
    const orders = [
      labOrder({ uuid: 'newer', dateActivated: '2026-10-02T00:00:00.000+0000' }),
      labOrder({ uuid: 'stat', urgency: 'STAT', dateActivated: '2026-10-03T00:00:00.000+0000' }),
      labOrder({ uuid: 'older', dateActivated: '2026-09-01T00:00:00.000+0000' }),
    ];

    expect(pendingLabOrders(orders).map((order) => order.uuid)).toEqual(['stat', 'older', 'newer']);
  });

  it('handles no orders', () => {
    expect(pendingLabOrders(null)).toEqual([]);
  });
});

describe('PendingLabsOmnibarProvider', () => {
  beforeEach(() => {
    mockUsePatientOrders.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it("lists this patient's pending lab orders, each opening the chart's Orders page", () => {
    mockUsePatientOrders.mockReturnValue({
      data: [
        labOrder({ uuid: 'cbc', fulfillerStatus: null }),
        labOrder({ uuid: 'lft', concept: { display: 'Liver function' } as Order['concept'], urgency: 'STAT' }),
        labOrder({ uuid: 'done', fulfillerStatus: 'COMPLETED' }),
      ],
      isLoading: false,
      error: null,
    });

    const report = reportFor('labs');

    expect(mockUsePatientOrders).toHaveBeenLastCalledWith(patientUuid, 'ACTIVE');
    expect(report).toMatchObject({ query: 'labs', title: 'Pending lab orders', status: 'ready' });
    expect(report.results.map((result) => result.title)).toEqual(['Liver function', 'Complete blood count']);
    expect(report.results[0].subtitle).toMatch(/^Ordered .+ · Not yet received · STAT$/);
    expect(report.results[1].subtitle).toMatch(/^Ordered .+ · Not yet received$/);
    report.results.forEach((result) => expect(result.target).toEqual(ordersPage));
  });

  it('labels the lab’s progress', () => {
    mockUsePatientOrders.mockReturnValue({
      data: [labOrder({ fulfillerStatus: 'IN_PROGRESS' })],
      isLoading: false,
      error: null,
    });

    expect(reportFor('').results[0].subtitle).toMatch(/ · In progress$/);
  });

  it('says so when nothing is pending, still opening the Orders page', () => {
    const report = reportFor('');

    expect(report.results).toEqual([
      { id: 'no-pending-labs', title: 'No pending lab orders', subtitle: 'Open the Orders page', target: ordersPage },
    ]);
  });

  it('stays idle, without fetching, for a query not about pending labs', () => {
    expect(reportFor('weight', chartContext)).toEqual({ query: 'weight', title: 'Pending lab orders', status: 'idle' });
    expect(mockUsePatientOrders).toHaveBeenLastCalledWith(null, 'ACTIVE');
  });

  it('reports loading while fetching', () => {
    mockUsePatientOrders.mockReturnValue({ data: null, isLoading: true, error: null });

    expect(reportFor('')).toEqual({ query: '', title: 'Pending lab orders', status: 'loading' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    mockUsePatientOrders.mockReturnValue({
      data: null,
      isLoading: false,
      error: Object.assign(new Error('upstream detail'), { response: { status: 503 } }),
    });

    expect(reportFor('')).toEqual({
      query: '',
      title: 'Pending lab orders',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
